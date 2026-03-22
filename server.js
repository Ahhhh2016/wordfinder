import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, ".env");
const SAFE_FALLBACK_MODEL = "openai/gpt-4.1-mini";

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);

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
    res.writeHead(302, { Location: "/favicon.svg" });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/favicon.svg") {
    sendFile(res, 200, join(__dirname, "favicon.svg"), "image/svg+xml; charset=utf-8");
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    sendHtml(res, 200, getIndexHtml());
    return;
  }

  if (req.method === "GET" && req.url === "/api/health") {
    const config = getConfig();
    sendJson(res, 200, {
      ok: true,
      model: config.defaultModel,
      hasToken: Boolean(config.githubToken),
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const config = getConfig();

      if (!config.githubToken) {
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

      const preferredModel = body.model || config.defaultModel;
      const payload = {
        model: preferredModel,
        messages,
      };

      if (body.temperature !== undefined) {
        payload.temperature = body.temperature;
      }

      if (body.max_tokens !== undefined) {
        payload.max_tokens = body.max_tokens;
      }

      let result = await requestChatCompletion(config, payload);

      if (
        !result.response.ok &&
        result.data?.error?.code === "unavailable_model" &&
        preferredModel !== SAFE_FALLBACK_MODEL
      ) {
        result = await requestChatCompletion(config, {
          ...payload,
          model: SAFE_FALLBACK_MODEL,
        });
      }

      if (!result.response.ok) {
        const errorMessage =
          result.data?.error?.message ||
          result.data?.message ||
          result.rawText ||
          `GitHub Models request failed with status ${result.response.status}.`;

        sendJson(res, result.response.status, {
          error: errorMessage,
          status: result.response.status,
          retryAfter: result.retryAfter,
          details: result.data,
        });
        return;
      }

      sendJson(res, 200, {
        model: result.data?.model || payload.model,
        content: result.data?.choices?.[0]?.message?.content ?? "",
        raw: result.data,
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

function sendFile(res, statusCode, filePath, contentType) {
  if (!existsSync(filePath)) {
    sendJson(res, 404, { error: "File not found" });
    return;
  }

  res.writeHead(statusCode, { "Content-Type": contentType });
  res.end(readFileSync(filePath));
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

function getConfig() {
  loadEnvFile(ENV_PATH);

  return {
    githubToken: process.env.GITHUB_TOKEN,
    defaultModel: process.env.GITHUB_MODEL || SAFE_FALLBACK_MODEL,
    endpoint:
      process.env.GITHUB_MODELS_ENDPOINT || "https://models.github.ai/inference/chat/completions",
  };
}

async function requestChatCompletion(config, payload) {
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.githubToken}`,
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get("content-type") || "";
  const retryAfter = response.headers.get("retry-after");
  const rawText = await response.text();
  const data = contentType.includes("application/json") ? safeJsonParse(rawText) : null;

  return {
    response,
    retryAfter,
    rawText,
    data,
  };
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getIndexHtml() {
  const filePath = join(__dirname, "index.html");

  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf8");
  }

  return "<h1>GitHub Models Backend</h1>";
}
