import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
// How long to keep serving, with readiness failing, before closing the listener.
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS ?? 0);
// Hard limit for the whole shutdown, counted from the signal.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (req.method === 'GET' && url.pathname === '/healthz/live') {
    return sendJson(res, 200, { status: 'ok' });
  }
  if (req.method === 'GET' && url.pathname === '/healthz/ready') {
    // TODO: fail readiness once shutdown has started.
    return sendJson(res, 200, { status: 'ready' });
  }
  if (req.method === 'GET' && url.pathname === '/work') {
    // Simulates a slow request, such as a report or an upstream call.
    const ms = Math.min(Number(url.searchParams.get('ms') ?? 100), 60_000);
    await sleep(ms);
    return sendJson(res, 200, { done: true, ms });
  }
  return sendJson(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    log({ msg: 'request failed', error: String(error) });
    if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log({ msg: 'listening', port: server.address().port });
});

// TODO: graceful shutdown on SIGTERM and SIGINT.
//   1. Fail readiness at once, but keep serving for SHUTDOWN_DELAY_MS.
//   2. Then stop accepting new connections and close idle keep-alive connections.
//   3. Let in-flight requests finish, then exit with code 0.
//   4. If all of this takes longer than SHUTDOWN_TIMEOUT_MS, exit with code 1.
