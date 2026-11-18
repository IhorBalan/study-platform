// HTTP layer: parse, call the core, map errors to status codes. Keep business rules out of here.
import { createServer } from 'node:http';

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function sendProblem(res, status, title, detail, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/problem+json', ...headers });
  res.end(JSON.stringify({ type: 'about:blank', title, status, detail }));
}

/** Reads the request body as a string. Parsing and limits are up to you. */
async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export function createApp(shortener) {
  return createServer(async (req, res) => {
    // TODO: POST /links, GET /:code and GET /links/:code/stats as described in task.md.
    // Map ValidationError, ConflictError and RateLimitError to status codes in one place.
    sendProblem(res, 501, 'Not Implemented', 'TODO');
  });
}
