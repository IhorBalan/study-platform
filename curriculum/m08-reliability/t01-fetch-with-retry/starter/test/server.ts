// A tiny scripted HTTP server for tests. Each request takes the next step of the script;
// the last step repeats. A step is a status code, 'hang' (never answer) or 'reset' (drop the connection).
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Step = number | 'hang' | 'reset' | { status: number; headers?: Record<string, string> };

export interface ScriptedServer {
  url: string;
  /** How many requests arrived so far. */
  hits: () => number;
  close: () => Promise<void>;
}

export async function startServer(script: Step[]): Promise<ScriptedServer> {
  let count = 0;
  const server = http.createServer((req, res) => {
    const step = script[Math.min(count, script.length - 1)];
    count++;
    req.resume();
    if (step === 'hang') return;
    if (step === 'reset') return void req.socket.destroy();
    const { status, headers = {} } = typeof step === 'number' ? { status: step } : step;
    res.writeHead(status, { 'content-type': 'text/plain', ...headers });
    res.end(`status ${status}`);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    hits: () => count,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
