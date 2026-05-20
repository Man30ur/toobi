const http = require("node:http");
const https = require("node:https");
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function ensureChatTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY,
      message_id TEXT UNIQUE NOT NULL,
      conversation_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function saveChatMessage({ messageId, conversationId, role, content, createdAt }) {
  await pool.query(
    `
      INSERT INTO chat_messages (message_id, conversation_id, role, content, created_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (message_id) DO NOTHING
    `,
    [messageId, conversationId, role, content, createdAt]
  );
}

async function readJsonBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
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

    await ensureChatTable();
    await saveChatMessage({
      messageId,
      conversationId,
      role: "user",
      content: message,
      createdAt,
    });

    const apiResponse = await postJson(N8N_WEBHOOK_URL, { message }, { "Content-Type": "application/json" });

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
    await saveChatMessage({
      messageId: assistantMessageId,
      conversationId,
      role: "assistant",
      content: assistantText,
      createdAt: new Date().toISOString(),
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

const server = http.createServer((req, res) => {
  setCorsHeaders(req, res);
  const allowedOrigin = resolveAllowedOrigin(req);

  if (req.method === "OPTIONS") {
    if (req.url === "/api/chat" && req.headers.origin && !allowedOrigin) {
      res.writeHead(403);
      res.end("Origin not allowed");
      return;
    }

    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
    if (req.headers.origin && !allowedOrigin) {
      res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Origin not allowed" }));
      return;
    }

    handleChat(req, res);
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
