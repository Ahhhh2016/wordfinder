import { applyCors, createChatResponse, parseJsonBody, sendJson } from "../lib/backend.js";

export default async function handler(req, res) {
  applyCors(res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const result = await createChatResponse(body);
    sendJson(res, result.status, result.body);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Unknown server error.",
    });
  }
}
