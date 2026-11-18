import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.env.PORT ?? 3000);

// Written by `npm run build`. Missing when the source is run directly.
let build = { version: 'dev', builtAt: null };
try {
  build = JSON.parse(readFileSync(new URL('./build-info.json', import.meta.url), 'utf8'));
} catch {
  // keep the defaults
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('content-type', 'application/json');

  if (url.pathname === '/healthz') {
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url.pathname === '/hello') {
    const name = url.searchParams.get('name') ?? 'world';
    res.end(JSON.stringify({ message: `Hello, ${name}!`, version: build.version }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, () => {
  console.log(`greeter listening on port ${port}`);
});

// Finish in-flight requests, then exit. Only works if this process receives the signal.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
  });
}
