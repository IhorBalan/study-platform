import { sampleTickets } from './seed.mjs';
import { createApp } from './server.mjs';

const port = Number(process.env.PORT ?? 3000);
createApp(sampleTickets()).listen(port, '127.0.0.1', () => {
  console.log(`Listening on http://127.0.0.1:${port}/tickets`);
});
