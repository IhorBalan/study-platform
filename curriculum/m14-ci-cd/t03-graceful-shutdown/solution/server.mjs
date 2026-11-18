import http from 'node:http';

const PORT = Number(process.env.PORT ?? 3000);
// How long to keep serving, with readiness failing, before closing the listener.
const SHUTDOWN_DELAY_MS = Number(process.env.SHUTDOWN_DELAY_MS ?? 0);
// Hard limit for the whole shutdown, counted from the signal.
const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

let shuttingDown = false;

function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

function sendJson(res, status, body) {
  // While draining, ask keep-alive clients to open their next request elsewhere.
  if (shuttingDown) res.setHeader('connection', 'close');
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
    if (shuttingDown) return sendJson(res, 503, { status: 'shutting down' });
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

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log({ msg: 'shutdown started', signal, delayMs: SHUTDOWN_DELAY_MS, timeoutMs: SHUTDOWN_TIMEOUT_MS });

  // The deadline covers the whole shutdown. unref() so the timer alone never keeps the process alive.
  setTimeout(() => {
    log({ msg: 'shutdown deadline reached, closing open connections' });
    server.closeAllConnections();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  // Keep accepting during the delay so the load balancer can notice readiness failing.
  setTimeout(() => {
    server.close((error) => {
      log({ msg: 'shutdown complete', error: error ? String(error) : undefined });
      process.exit(error ? 1 : 0);
    });
    server.closeIdleConnections();
  }, SHUTDOWN_DELAY_MS);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
