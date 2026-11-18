// Runs the server locally: `node start.mjs`, then try `curl -v http://127.0.0.1:3000/notes`.
import { createServer } from './server.mjs';

const port = Number(process.env.PORT ?? 3000);
const server = createServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
