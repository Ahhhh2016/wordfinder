import { existsSync, readFileSync } from "node:fs";

export const SAFE_FALLBACK_MODEL = "openai/gpt-4.1-mini";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function applyCors(res) {
  for (const [key, value] of Object.entries(corsHeaders)) {
    res.setHeader(key, value);
  }
}

export function sendJson(res, statusCode, data) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(statusCode).json(data);
    return;
  }

  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  const rawBody = await readRequestBody(req);
  return rawBody ? JSON.parse(rawBody) : {};
}

export function readRequestBody(req) {
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

export function createHealthResponse(envPath) {
  const config = getConfig(envPath);

  return {
    status: 200,
    body: {
      ok: true,
      model: config.defaultModel,
      hasToken: Boolean(config.githubToken),
    },
  };
}

export async function createChatResponse(body, envPath) {
  const config = getConfig(envPath);

  if (!config.githubToken) {
    return {
      status: 500,
      body: {
        error: "Missing GITHUB_TOKEN. Add it to your environment or .env file.",
      },
    };
  }

  const messages = buildMessages(body);

  if (messages.length === 0) {
    return {
      status: 400,
      body: {
        error: "Request must include either a prompt string or a messages array.",
      },
    };
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

    return {
      status: result.response.status,
      body: {
        error: errorMessage,
        status: result.response.status,
        retryAfter: result.retryAfter,
        details: result.data,
      },
    };
  }

  return {
    status: 200,
    body: {
      model: result.data?.model || payload.model,
      content: result.data?.choices?.[0]?.message?.content ?? "",
      raw: result.data,
    },
  };
}

export function loadEnvFile(envPath) {
  if (!envPath || !existsSync(envPath)) {
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

export function getConfig(envPath) {
  loadEnvFile(envPath);

  return {
    githubToken: process.env.GITHUB_TOKEN,
    defaultModel: process.env.GITHUB_MODEL || SAFE_FALLBACK_MODEL,
    endpoint:
      process.env.GITHUB_MODELS_ENDPOINT || "https://models.github.ai/inference/chat/completions",
  };
}

export function buildMessages(body) {
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
