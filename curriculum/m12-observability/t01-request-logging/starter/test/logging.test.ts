// Tests for the request logging. Run them with `npm test`.
// Pass your own destination to createApp() and read back what was written.
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';

type Line = Record<string, unknown>;
const lines: Line[] = [];
let server: Server;
let base: string;

before(async () => {
  const app = createApp({ destination: { write: (chunk: string) => void lines.push(JSON.parse(chunk)) } });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

test('health answers', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
});

// TODO: a test that every line written during one request carries that request's id.
// TODO: a test that a password sent to /signup never appears in `lines`.
