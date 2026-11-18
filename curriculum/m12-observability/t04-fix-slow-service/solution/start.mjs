import { createServer } from './server.mjs';

const port = Number(process.env.PORT ?? 3000);
createServer().listen(port, () => {
  console.log(`listening on http://localhost:${port}`);
});

// Exit normally on Ctrl+C or SIGTERM. Without this the signal kills the process
// and --cpu-prof never writes its .cpuprofile file.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
