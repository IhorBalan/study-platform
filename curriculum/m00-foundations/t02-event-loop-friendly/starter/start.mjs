// Runs the server locally: `node start.mjs`.
// Terminal 1: curl 'http://127.0.0.1:3000/hash?input=abc&rounds=5000000'
// Terminal 2: curl -w '%{time_total}s\n' http://127.0.0.1:3000/health
import { createServer } from './server.mjs';

const port = Number(process.env.PORT ?? 3000);
const server = createServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
