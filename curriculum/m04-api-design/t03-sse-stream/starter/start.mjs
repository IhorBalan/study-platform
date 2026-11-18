// Runs the server locally: `node start.mjs`, then in two terminals:
//   curl -N http://127.0.0.1:3000/events
//   curl -X POST http://127.0.0.1:3000/messages -H 'content-type: application/json' -d '{"text":"hello"}'
import { createServer } from './server.mjs';

const port = Number(process.env.PORT ?? 3000);
const server = createServer();

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
