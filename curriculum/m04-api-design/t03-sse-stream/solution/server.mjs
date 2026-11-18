import http from 'node:http';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_HISTORY = 1000;

/**
 * A message board that pushes new messages to every open GET /events stream.
 * Each call returns an independent server with its own history.
 */
export function createServer({ heartbeatMs = 15_000 } = {}) {
  /** @type {{ id: number, text: string }[]} */
  const history = [];
  /** @type {Set<http.ServerResponse>} */
  const subscribers = new Set();
  let nextId = 1;

  function formatEvent(message) {
    // One field per line, a blank line ends the event. JSON.stringify never
    // emits a raw newline, so the data fits on one "data:" line.
    return `id: ${message.id}\nevent: message\ndata: ${JSON.stringify({ id: String(message.id), text: message.text })}\n\n`;
  }

  function publish(text) {
    const message = { id: nextId++, text };
    history.push(message);
    if (history.length > MAX_HISTORY) history.shift();
    const frame = formatEvent(message);
    for (const res of subscribers) res.write(frame);
    return message;
  }

  function openStream(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      // Stops proxies such as nginx from buffering the stream.
      'x-accel-buffering': 'no',
    });
    // Tell EventSource how long to wait before reconnecting.
    res.write('retry: 3000\n\n');

    // Replay what the client missed, then go live. Both happen synchronously,
    // so no message can slip in between the replay and the subscription.
    const lastId = Number(req.headers['last-event-id']);
    if (Number.isInteger(lastId) && lastId >= 0) {
      for (const message of history) if (message.id > lastId) res.write(formatEvent(message));
    }
    subscribers.add(res);

    // A comment line keeps idle connections from being closed by proxies.
    const heartbeat = setInterval(() => res.write(': ping\n\n'), heartbeatMs);
    res.on('close', () => {
      clearInterval(heartbeat);
      subscribers.delete(res);
    });
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
      if (pathname === '/events' || pathname === '/messages') {
        res.setHeader('allow', pathname === '/events' ? 'GET' : 'POST');
        return sendProblem(res, 405, 'Method Not Allowed', `${req.method} is not supported here.`);
      }
      return sendProblem(res, 404, 'Not Found', `No route for ${pathname}.`);
    } catch {
      if (!res.headersSent) sendProblem(res, 500, 'Internal Server Error', 'Something went wrong.');
      else res.destroy();
    }
  });
}
