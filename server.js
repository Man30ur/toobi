const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 8000);
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "http://127.0.0.1:5678/webhook/toobi";
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 90000);
const POSTGRES_HOST = process.env.POSTGRES_HOST || "127.0.0.1";
const POSTGRES_PORT = Number(process.env.POSTGRES_PORT || 5432);
const POSTGRES_DB = process.env.POSTGRES_DB || "appdb";
const POSTGRES_USER = process.env.POSTGRES_USER || "appuser";
const POSTGRES_PASSWORD = process.env.POSTGRES_PASSWORD || "yu9YmZH8nWrww0fVWMyi9s7o";
const AUTH_SECRET = process.env.AUTH_SECRET || "change-this-auth-secret-in-production";
const SMS_PROVIDER = process.env.SMS_PROVIDER || "demo";
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 3);
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
const IS_PRODUCTION = process.env.NODE_ENV === "production";

const pool = new Pool({
  host: POSTGRES_HOST,
  port: POSTGRES_PORT,
  database: POSTGRES_DB,
  user: POSTGRES_USER,
  password: POSTGRES_PASSWORD,
  ssl: false,
  max: 5,
});

const publicFiles = new Set(["/index.html", "/styles.css", "/script.js"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const assetFiles = ["styles.css", "script.js"];
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://127.0.0.1:8000,http://localhost:8000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function resolveAllowedOrigin(req) {
  const origin = req.headers.origin;

  if (!origin) {
    return null;
  }

  try {
    const originUrl = new URL(origin);
    const requestHost = req.headers.host;

    if (requestHost && originUrl.host === requestHost) {
      return origin;
    }
  } catch {
    return "";
  }

  if (allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
    return origin;
  }

  return "";
}

function setCorsHeaders(req, res) {
  const allowedOrigin = resolveAllowedOrigin(req);
  res.setHeader("Vary", "Origin");

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getCacheHeader(filePath) {
  if (filePath.endsWith(".html")) {
    return "no-cache, no-store, must-revalidate";
  }

  return "public, max-age=31536000, immutable";
}

function getFileTag(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return `${Math.floor(stats.mtimeMs)}-${stats.size}`;
  } catch {
    return String(Date.now());
  }
}

function getAssetsVersion() {
  return assetFiles
    .map((fileName) => getFileTag(path.join(__dirname, fileName)))
    .join("_");
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(data));
}

function createId(prefix = "id") {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`;
}

function hmac(value) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(String(value)).digest("hex");
}

function hashOtp(phone, code) {
  return hmac(`${phone}:${code}`);
}

function hashSessionToken(token) {
  return hmac(`session:${token}`);
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function makeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];

  if (IS_PRODUCTION) {
    parts.push("Secure");
  }

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  return parts.join("; ");
}

function normalizePhone(input) {
  const raw = String(input || "").trim();
  const normalizedDigits = raw
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[^\d+]/g, "");

  if (/^09\d{9}$/.test(normalizedDigits)) {
    return `+98${normalizedDigits.slice(1)}`;
  }

  if (/^989\d{9}$/.test(normalizedDigits)) {
    return `+${normalizedDigits}`;
  }

  if (/^\+989\d{9}$/.test(normalizedDigits)) {
    return normalizedDigits;
  }

  return null;
}

function formatPhoneForDisplay(phone) {
  if (/^\+989\d{9}$/.test(phone)) {
    return `0${phone.slice(3)}`;
  }

  return phone;
}

async function ensureAuthTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      "passwordHash" TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',
      "isBanned" BOOLEAN NOT NULL DEFAULT FALSE,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "phoneVerified" BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "displayName" TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS users_phone_key ON users(phone) WHERE phone IS NOT NULL;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS otp_codes (
      id BIGSERIAL PRIMARY KEY,
      phone TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      used_at TIMESTAMPTZ,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS otp_codes_phone_created_idx ON otp_codes (phone, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}
async function ensureChatTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL DEFAULT 'گفتگوی تازه',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_message_at TIMESTAMPTZ
    );
  `);

  await pool.query(`ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS user_id TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      message_id TEXT UNIQUE NOT NULL,
      conversation_id TEXT,
      user_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS chat_sessions_user_updated_idx ON chat_sessions (user_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS chat_messages_conversation_idx ON chat_messages (conversation_id, created_at ASC);`);
}

async function saveChatMessage({ messageId, conversationId, userId, role, content, createdAt }) {
  await pool.query(
    `
      INSERT INTO chat_messages (message_id, conversation_id, user_id, role, content, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (message_id) DO NOTHING
    `,
    [messageId, conversationId, userId, role, content, createdAt]
  );
}

async function upsertChatSession({ chatId, userId, title, messageAt }) {
  await pool.query(
    `
      INSERT INTO chat_sessions (id, user_id, title, created_at, updated_at, last_message_at)
      VALUES ($1, $2, $3, $4, $4, $4)
      ON CONFLICT (id) DO UPDATE SET
        user_id = COALESCE(EXCLUDED.user_id, chat_sessions.user_id),
        title = CASE
          WHEN chat_sessions.title = 'گفتگوی تازه' AND EXCLUDED.title <> '' THEN EXCLUDED.title
          ELSE chat_sessions.title
        END,
        updated_at = EXCLUDED.updated_at,
        last_message_at = EXCLUDED.last_message_at
    `,
    [chatId, userId, title || 'گفتگوی تازه', messageAt]
  );
}

async function listChatSessions(userId) {
  const result = await pool.query(
    `
      SELECT
        s.id,
        s.title,
        s.created_at,
        s.updated_at,
        s.last_message_at,
        COALESCE(
          json_agg(
            json_build_object(
              'id', m.message_id,
              'role', CASE WHEN m.role = 'assistant' THEN 'bot' ELSE m.role END,
              'kind', 'normal',
              'content', m.content,
              'time', to_char(m.created_at, 'HH24:MI'),
              'createdAt', EXTRACT(EPOCH FROM m.created_at) * 1000,
              'pending', false
            )
            ORDER BY m.created_at ASC
          ) FILTER (WHERE m.message_id IS NOT NULL),
          '[]'::json
        ) AS messages
      FROM chat_sessions s
      LEFT JOIN chat_messages m ON m.conversation_id = s.id
      WHERE s.user_id = $1
      GROUP BY s.id
      ORDER BY COALESCE(s.last_message_at, s.updated_at) DESC
    `,
    [userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    pinned: false,
    messages: Array.isArray(row.messages) ? row.messages : [],
  }));
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "";
}

async function getCurrentUser(req) {
  await ensureAuthTables();
  const token = parseCookies(req).toobi_session;

  if (!token) {
    return null;
  }

  const result = await pool.query(
    `
      SELECT users.id,
             users.phone,
             users."phoneVerified" AS "phoneVerified",
             users."displayName" AS "displayName",
             users."avatarUrl" AS "avatarUrl",
             users.role,
             users."isBanned" AS "isBanned",
             users."createdAt" AS "createdAt",
             users."updatedAt" AS "updatedAt",
             users."lastLoginAt" AS "lastLoginAt"
      FROM user_sessions
      JOIN users ON users.id = user_sessions.user_id
      WHERE user_sessions.token_hash = $1
        AND user_sessions.revoked_at IS NULL
        AND user_sessions.expires_at > NOW()
      LIMIT 1
    `,
    [hashSessionToken(token)]
  );

  return result.rows[0] || null;
}
function publicUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    phone: row.phone ? formatPhoneForDisplay(row.phone) : "",
    phoneVerified: Boolean(row.phoneVerified),
    displayName: row.displayName || "",
    avatarUrl: row.avatarUrl || "",
    role: row.role,
    isBanned: Boolean(row.isBanned),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
  };
}
async function sendSmsOtp(phone, code) {
  if (SMS_PROVIDER === "demo") {
    console.log(`[demo sms] ${formatPhoneForDisplay(phone)} -> ${code}`);
    return { provider: "demo", delivered: true };
  }

  // Provider integration point: keep API keys on the server only.
  throw new Error("SMS_PROVIDER هنوز تنظیم نشده است.");
}

async function handleRequestOtp(req, res) {
  try {
    await ensureAuthTables();
    const body = await readJsonBody(req);
    const phone = normalizePhone(body.phone);

    if (!phone) {
      sendJson(res, 400, { error: "شماره موبایل معتبر نیست." });
      return;
    }

    const recent = await pool.query(
      `SELECT COUNT(*)::int AS count FROM otp_codes WHERE phone = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
      [phone]
    );

    if (recent.rows[0]?.count >= 5) {
      sendJson(res, 429, { error: "درخواست کد بیش از حد مجاز است. چند دقیقه دیگر تلاش کن." });
      return;
    }

    const code = String(crypto.randomInt(100000, 999999));
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString();
    await pool.query(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)`,
      [phone, hashOtp(phone, code), expiresAt, getClientIp(req)]
    );

    await sendSmsOtp(phone, code);

    sendJson(res, 200, {
      ok: true,
      expiresIn: OTP_TTL_MINUTES * 60,
      demoCode: SMS_PROVIDER === "demo" ? code : undefined,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "ارسال کد تایید انجام نشد." });
  }
}

async function handleVerifyOtp(req, res) {
  try {
    await ensureAuthTables();
    const body = await readJsonBody(req);
    const phone = normalizePhone(body.phone);
    const code = String(body.code || "").trim();
    const displayName = String(body.displayName || "").trim().slice(0, 80);

    if (!phone || !/^\d{6}$/.test(code)) {
      sendJson(res, 400, { error: "شماره یا کد تایید معتبر نیست." });
      return;
    }

    const otp = await pool.query(
      `
        SELECT id, code_hash, attempts
        FROM otp_codes
        WHERE phone = $1 AND used_at IS NULL AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      `,
      [phone]
    );

    if (!otp.rows[0]) {
      sendJson(res, 400, { error: "کد تایید منقضی شده یا وجود ندارد." });
      return;
    }

    if (otp.rows[0].attempts >= 5) {
      sendJson(res, 429, { error: "تعداد تلاش برای این کد تمام شده است." });
      return;
    }

    if (otp.rows[0].code_hash !== hashOtp(phone, code)) {
      await pool.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1`, [otp.rows[0].id]);
      sendJson(res, 400, { error: "کد تایید اشتباه است." });
      return;
    }

    await pool.query(`UPDATE otp_codes SET used_at = NOW() WHERE id = $1`, [otp.rows[0].id]);

    let userResult = await pool.query(
      `
        SELECT id, phone, "phoneVerified", "displayName", "avatarUrl", role, "isBanned", "createdAt", "updatedAt", "lastLoginAt"
        FROM users
        WHERE phone = $1
        LIMIT 1
      `,
      [phone]
    );

    if (userResult.rows[0]) {
      userResult = await pool.query(
        `
          UPDATE users
          SET "phoneVerified" = TRUE,
              "displayName" = COALESCE(NULLIF($2, ''), "displayName"),
              "lastLoginAt" = NOW(),
              "updatedAt" = NOW()
          WHERE phone = $1
          RETURNING id, phone, "phoneVerified", "displayName", "avatarUrl", role, "isBanned", "createdAt", "updatedAt", "lastLoginAt"
        `,
        [phone, displayName]
      );
    } else {
      const userId = createId("user");
      const syntheticEmail = (phone.replace("+", "") || "user") + "@phone.toobi.local";
      userResult = await pool.query(
        `
          INSERT INTO users (id, email, "passwordHash", role, "isBanned", phone, "phoneVerified", "displayName", "lastLoginAt", "updatedAt")
          VALUES ($1, $2, $3, 'USER', FALSE, $4, TRUE, NULLIF($5, ''), NOW(), NOW())
          RETURNING id, phone, "phoneVerified", "displayName", "avatarUrl", role, "isBanned", "createdAt", "updatedAt", "lastLoginAt"
        `,
        [userId, syntheticEmail, "", phone, displayName]
      );
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const sessionId = createId("session");
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400000).toISOString();

    await pool.query(
      `
        INSERT INTO user_sessions (id, user_id, token_hash, user_agent, ip_address, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [sessionId, userResult.rows[0].id, hashSessionToken(token), req.headers["user-agent"] || "", getClientIp(req), expiresAt]
    );

    sendJson(res, 200, { ok: true, user: publicUser(userResult.rows[0]) }, {
      "Set-Cookie": makeCookie("toobi_session", token, { maxAge: SESSION_TTL_DAYS * 86400 }),
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "تایید ورود انجام نشد." });
  }
}

async function handleMe(req, res) {
  const user = await getCurrentUser(req);
  sendJson(res, 200, { user: publicUser(user) });
}

async function handleProfile(req, res) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      sendJson(res, 401, { error: "برای ویرایش پروفایل باید وارد شوید." });
      return;
    }

    const body = await readJsonBody(req);
    const displayName = String(body.displayName || "").trim().slice(0, 80);
    const avatarUrl = String(body.avatarUrl || "").trim().slice(0, 500);
    const result = await pool.query(
      `
        UPDATE users
        SET "displayName" = NULLIF($1, ''), "avatarUrl" = NULLIF($2, ''), "updatedAt" = NOW()
        WHERE id = $3
        RETURNING *
      `,
      [displayName, avatarUrl, user.id]
    );

    sendJson(res, 200, { ok: true, user: publicUser(result.rows[0]) });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "پروفایل ذخیره نشد." });
  }
}

async function handleLogout(req, res) {
  try {
    const token = parseCookies(req).toobi_session;
    if (token) {
      await ensureAuthTables();
      await pool.query(`UPDATE user_sessions SET revoked_at = NOW() WHERE token_hash = $1`, [hashSessionToken(token)]);
    }

    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": makeCookie("toobi_session", "", { maxAge: 0 }),
    });
  } catch {
    sendJson(res, 200, { ok: true }, {
      "Set-Cookie": makeCookie("toobi_session", "", { maxAge: 0 }),
    });
  }
}

function postJson(url, payload, headers) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const transport = parsedUrl.protocol === "http:" ? http : https;
    const body = JSON.stringify(payload);
    const request = transport.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || undefined,
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: "POST",
        headers: {
          ...headers,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks = [];

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
      request.destroy(new Error("Upstream request timeout"));
    });
    request.write(body);
    request.end();
  });
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);
    const user = await getCurrentUser(req);
    const lastUserMessage = Array.isArray(body.messages)
      ? [...body.messages].reverse().find((message) => message?.role === "user")?.content
      : body.message;
    const message = String(lastUserMessage || "").trim();
    const conversationId = String(body.conversationId || body.sessionId || body.chatId || "").trim() || null;
    const messageId = String(body.messageId || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const createdAt = new Date().toISOString();

    if (!message) {
      sendJson(res, 400, { error: "پیامی برای ارسال وجود ندارد." });
      return;
    }

    if (user?.isBanned) {
      sendJson(res, 403, { error: "حساب کاربری شما مسدود شده است." });
      return;
    }

    await ensureChatTable();
    const chatId = conversationId || messageId;
    await upsertChatSession({
      chatId,
      userId: user?.id || null,
      title: message.slice(0, 48),
      messageAt: createdAt,
    });
    await saveChatMessage({
      messageId,
      conversationId: chatId,
      userId: user?.id || null,
      role: "user",
      content: message,
      createdAt,
    });

    const apiResponse = await postJson(
      N8N_WEBHOOK_URL,
      {
        message,
        user: user ? { id: user.id, phone: user.phone, displayName: user.displayName || "" } : null,
      },
      { "Content-Type": "application/json" }
    );

    const responseText = apiResponse.text;

    if (!apiResponse.ok) {
      sendJson(res, apiResponse.status, { error: responseText || `خطای n8n با کد ${apiResponse.status}` });
      return;
    }

    const data = JSON.parse(responseText);
    const assistantText = data?.reply ?? data?.message;

    if (data?.error) {
      sendJson(res, 502, { error: data.error });
      return;
    }

    if (!assistantText) {
      sendJson(res, 502, { error: "پاسخ خالی از سمت n8n دریافت شد." });
      return;
    }

    const assistantMessageId = `${messageId}-assistant`;
    const assistantCreatedAt = new Date().toISOString();
    await upsertChatSession({
      chatId: conversationId || messageId,
      userId: user?.id || null,
      title: message.slice(0, 48),
      messageAt: assistantCreatedAt,
    });
    await saveChatMessage({
      messageId: assistantMessageId,
      conversationId: conversationId || messageId,
      userId: user?.id || null,
      role: "assistant",
      content: assistantText,
      createdAt: assistantCreatedAt,
    });

    sendJson(res, 200, { reply: assistantText, raw: data.raw || data });
  } catch (error) {
    if (error && error.message === "Upstream request timeout") {
      sendJson(res, 504, { error: "پاسخ n8n به زمان مجاز نرسید." });
      return;
    }

    sendJson(res, 500, { error: error.message || "خطای داخلی سرور رخ داد." });
  }
}

async function handleChats(req, res) {
  try {
    const user = await getCurrentUser(req);

    if (!user) {
      sendJson(res, 401, { error: "برای مشاهده تاریخچه باید وارد شوید." });
      return;
    }

    await ensureChatTable();
    const chats = await listChatSessions(user.id);
    sendJson(res, 200, { chats });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "دریافت تاریخچه انجام نشد." });
  }
}

function serveFile(req, res) {
  const requestedPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);

  if (!publicFiles.has(requestedPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const filePath = path.normalize(path.join(__dirname, requestedPath));

  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, requestedPath === "/index.html" ? "utf8" : null, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const type = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    const etagValue = getFileTag(filePath);
    const responseBody =
      requestedPath === "/index.html"
        ? content.replace(/((?:href|src)="[^"]+\?v=)[^"]+(")/g, `$1${getAssetsVersion()}$2`)
        : content;

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": getCacheHeader(filePath),
      ETag: `"${etagValue}-${path.basename(filePath)}"`,
    });
    res.end(req.method === "HEAD" ? undefined : responseBody);
  });
}

function isProtectedApi(pathname) {
  return pathname.startsWith("/api/");
}

const routes = {
  "POST /api/auth/request-otp": handleRequestOtp,
  "POST /api/auth/verify-otp": handleVerifyOtp,
  "GET /api/auth/me": handleMe,
  "POST /api/auth/profile": handleProfile,
  "POST /api/auth/logout": handleLogout,
  "GET /api/chats": handleChats,
  "POST /api/chat": handleChat,
};

const server = http.createServer((req, res) => {
  setCorsHeaders(req, res);
  const allowedOrigin = resolveAllowedOrigin(req);
  const pathname = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`).pathname;

  if (req.method === "OPTIONS") {
    if (isProtectedApi(pathname) && req.headers.origin && !allowedOrigin) {
      res.writeHead(403);
      res.end("Origin not allowed");
      return;
    }

    res.writeHead(204);
    res.end();
    return;
  }

  if (isProtectedApi(pathname) && req.headers.origin && !allowedOrigin) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "Origin not allowed" }));
    return;
  }

  const route = routes[`${req.method} ${pathname}`];
  if (route) {
    route(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveFile(req, res);
    return;
  }

  res.writeHead(405);
  res.end("Method not allowed");
});

server.listen(PORT, () => {
  console.log(`Server running on http://127.0.0.1:${PORT}`);
});
