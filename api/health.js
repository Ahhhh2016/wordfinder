import { applyCors, createHealthResponse, sendJson } from "../lib/backend.js";

export default function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const result = createHealthResponse();
  sendJson(res, result.status, result.body);
}
