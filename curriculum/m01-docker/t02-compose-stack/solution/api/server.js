// A stand-in API. It does not speak the PostgreSQL protocol; /healthz only checks
// that the host and port in DATABASE_URL accept a TCP connection.
import { createServer } from 'node:http';
import { connect } from 'node:net';

const port = Number(process.env.PORT ?? 3000);
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = new URL(databaseUrl);

function databaseReachable() {
  return new Promise((resolve) => {
    const socket = connect({ host: db.hostname, port: Number(db.port || 5432), timeout: 1000 });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

const server = createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url === '/healthz') {
    const ok = await databaseReachable();
    res.statusCode = ok ? 200 : 503;
    res.end(JSON.stringify({ database: ok ? 'reachable' : 'unreachable', host: db.hostname }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => console.log(`orders-api listening on port ${port}`));

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
