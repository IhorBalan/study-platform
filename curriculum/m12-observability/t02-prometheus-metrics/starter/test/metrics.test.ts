// Tests for the metrics. Run them with `npm test`.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
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

// TODO: a test that two requests to /orders/:id add exactly 2 to the right counter series.
// TODO: a test that no route label contains a raw id or an unknown path.
