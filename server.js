import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = join(__filename, "..");

loadEnvFile(join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3000);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const DEFAULT_MODEL = process.env.GITHUB_MODEL || "openai/gpt-5-mini";
const GITHUB_MODELS_ENDPOINT =
  process.env.GITHUB_MODELS_ENDPOINT || "https://models.github.ai/inference/chat/completions";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const server = createServer(async (req, res) => {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    sendHtml(res, 200, getIndexHtml());
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      model: DEFAULT_MODEL,
      hasToken: Boolean(GITHUB_TOKEN),
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      if (!GITHUB_TOKEN) {
        sendJson(res, 500, {
          error: "Missing GITHUB_TOKEN. Add it to your environment or .env file.",
        });
        return;
      }

      const rawBody = await readRequestBody(req);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const messages = buildMessages(body);

      if (messages.length === 0) {
        sendJson(res, 400, {
          error: "Request must include either a prompt string or a messages array.",
        });
        return;
      }

      const payload = {
        model: body.model || DEFAULT_MODEL,
        messages,
      };

      if (body.temperature !== undefined) {
        payload.temperature = body.temperature;
      }

      if (body.max_tokens !== undefined) {
        payload.max_tokens = body.max_tokens;
      }

      const response = await fetch(GITHUB_MODELS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${GITHUB_TOKEN}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        sendJson(res, response.status, {
          error: data?.error?.message || data?.message || "GitHub Models request failed.",
          details: data,
        });
        return;
      }

      sendJson(res, 200, {
        model: payload.model,
        content: data?.choices?.[0]?.message?.content ?? "",
        raw: data,
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : "Unknown server error.",
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

function applyCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendHtml(res, statusCode, html) {
  res.writeHead(statusCode, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      resolve(body);
    });

    req.on("error", reject);
  });
}

function buildMessages(body) {
  if (Array.isArray(body.messages) && body.messages.length > 0) {
    return body.messages;
  }

  if (typeof body.prompt === "string" && body.prompt.trim()) {
    const messages = [];

    if (typeof body.systemPrompt === "string" && body.systemPrompt.trim()) {
      messages.push({
        role: "system",
        content: body.systemPrompt.trim(),
      });
    }

    messages.push({
      role: "user",
      content: body.prompt.trim(),
    });

    return messages;
  }

  return [];
}

function loadEnvFile(envPath) {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getIndexHtml() {
  const filePath = join(__dirname, "index.html");

  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf8");
  }

  return "<h1>GitHub Models Backend</h1>";
}
