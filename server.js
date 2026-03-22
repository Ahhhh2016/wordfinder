import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyCors,
  createChatResponse,
  createHealthResponse,
  loadEnvFile,
  parseJsonBody,
  sendJson,
} from "./lib/backend.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENV_PATH = join(__dirname, ".env");

loadEnvFile(ENV_PATH);

const PORT = Number(process.env.PORT || 3000);

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
    const result = createHealthResponse(ENV_PATH);
    sendJson(res, result.status, result.body);
    return;
  }

  if (req.method === "POST" && req.url === "/api/chat") {
    try {
      const body = await parseJsonBody(req);
      const result = await createChatResponse(body, ENV_PATH);
      sendJson(res, result.status, result.body);
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

function getIndexHtml() {
  const filePath = join(__dirname, "index.html");

  if (existsSync(filePath)) {
    return readFileSync(filePath, "utf8");
  }

  return "<h1>GitHub Models Backend</h1>";
}
