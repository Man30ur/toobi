const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8000);
const API_ENDPOINT =
  "https://arvancloudai.ir/gateway/models/Kimi-K2.5/hyJZtEau4DyS3vJ22uLV_sxSvt-8V4tAtXBeOgxf9BHmh1nRLH0AxeFpgQf4fZ-sq-HEltGgKCwuLnpQz7O8Y12c2Yu4_EYY29hTWLJX4wPAnOXCWFP4YfwHAbzc4VOPLdV2OQ9TmQS8rvXipjlFa4SlaK_nY_HkXL6L3VSjsajctFk9sYB36p1-zm0jXM88fjFQNjeaQGgQynvPmPrPgvxVjcZD616HD9TtMxHquY7qQ4QnzRcZUw/v1/chat/completions";
const API_KEY = process.env.ARVAN_API_KEY || "659af3c6-d42b-578f-ad17-8ebccd4b6e50";
const MODEL = "Kimi-K2-5-vdkki";
const publicFiles = new Set(["/index.html", "/styles.css", "/script.js"]);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

const BUILD_ID = String(Date.now());

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function getCacheHeader(filePath) {
  if (filePath.endsWith(".html")) {
    return "no-cache, no-store, must-revalidate";
  }

  return "public, max-age=31536000, immutable";
}

function sendJson(res, statusCode, data) {
  setCorsHeaders(res);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: parsedUrl.hostname,
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
    request.write(body);
    request.end();
  });
}

async function handleChat(req, res) {
  try {
    const body = await readJsonBody(req);

    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      sendJson(res, 400, { error: "پیامی برای ارسال وجود ندارد." });
      return;
    }

    const apiResponse = await postJson(
      API_ENDPOINT,
      {
        model: MODEL,
        messages: body.messages,
        max_tokens: 3000,
        temperature: 0.7,
      },
      {
        Authorization: `apikey ${API_KEY}`,
        "Content-Type": "application/json",
      }
    );

    const responseText = apiResponse.text;

    if (apiResponse.status === 401) {
      sendJson(res, 401, { error: "کلید API نامعتبر است یا دسترسی ندارد." });
      return;
    }

    if (apiResponse.status === 429) {
      sendJson(res, 429, { error: "تعداد درخواست‌ها زیاد شده است. کمی بعد دوباره تلاش کن." });
      return;
    }

    if (!apiResponse.ok) {
      sendJson(res, apiResponse.status, { error: responseText || `خطای سرور با کد ${apiResponse.status}` });
      return;
    }

    const data = JSON.parse(responseText);
    const assistantText = data?.choices?.[0]?.message?.content;

    if (!assistantText) {
      sendJson(res, 502, { error: "پاسخ خالی از سمت هوش مصنوعی دریافت شد." });
      return;
    }

    sendJson(res, 200, { reply: assistantText });
  } catch (error) {
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
    const responseBody =
      requestedPath === "/index.html"
        ? content.replace(/((?:href|src)="[^"]+\?v=)[^"]+(")/g, `$1${BUILD_ID}$2`)
        : content;

    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": getCacheHeader(filePath),
      ETag: `"${BUILD_ID}-${path.basename(filePath)}"`,
    });
    res.end(req.method === "HEAD" ? undefined : responseBody);
  });
}

const server = http.createServer((req, res) => {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url === "/api/chat" && req.method === "POST") {
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
  console.log(`Build ID: ${BUILD_ID}`);
});
