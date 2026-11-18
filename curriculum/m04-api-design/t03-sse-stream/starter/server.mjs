import http from 'node:http';

const MAX_BODY_BYTES = 16 * 1024;

/**
 * A message board that should push new messages to every open GET /events stream.
 * Each call returns an independent server with its own history.
 */
export function createServer({ heartbeatMs = 15_000 } = {}) {
  /** @type {{ id: number, text: string }[]} */
  const history = [];
  let nextId = 1;

  function publish(text) {
    const message = { id: nextId++, text };
    history.push(message);
    // TODO: send the message to every connected stream.
    return message;
  }

  function openStream(req, res) {
    // TODO: answer with an SSE stream as the brief describes: headers,
    // replay after Last-Event-ID, live messages, heartbeats, cleanup on close.
    sendProblem(res, 501, 'Not Implemented', 'The event stream is not built yet.');
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  }

  function sendProblem(res, status, title, detail) {
    res
      .writeHead(status, { 'content-type': 'application/problem+json' })
      .end(JSON.stringify({ type: 'about:blank', title, status, detail }));
  }

  async function readJson(req) {
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    }
    if (size > MAX_BODY_BYTES) return undefined;
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (pathname === '/events' && req.method === 'GET') return openStream(req, res);
      if (pathname === '/messages' && req.method === 'POST') {
        const body = await readJson(req);
        if (typeof body?.text !== 'string' || body.text.length === 0 || body.text.length > 1000) {
          return sendProblem(res, 400, 'Bad Request', 'Send a JSON object with a "text" string of 1 to 1000 characters.');
        }
        const message = publish(body.text);
        return sendJson(res, 201, { id: String(message.id), text: message.text });
      }
      return sendProblem(res, 404, 'Not Found', `No route for ${pathname}.`);
    } catch {
      if (!res.headersSent) sendProblem(res, 500, 'Internal Server Error', 'Something went wrong.');
      else res.destroy();
    }
  });
}
