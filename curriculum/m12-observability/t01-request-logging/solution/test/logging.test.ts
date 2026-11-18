// Tests for the request logging. Run them with `npm test`.
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

const linesFor = (reqId: string) => lines.filter((line) => line.reqId === reqId);

test('reuses a safe incoming request id and puts it on every line of that request', async () => {
  const res = await fetch(`${base}/orders/7`, { headers: { 'x-request-id': 'test-123' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-request-id'), 'test-123');
  const messages = linesFor('test-123').map((line) => line.msg);
  assert.deepEqual(messages, ['loading order', 'order loaded', 'request completed']);
});

test('creates an id when the incoming one is unsafe', async () => {
  const res = await fetch(`${base}/health`, { headers: { 'x-request-id': 'x'.repeat(500) } });
  const id = res.headers.get('x-request-id');
  assert.ok(id && id.length <= 64, `expected a fresh short id, got ${id}`);
});

test('concurrent requests keep their own ids', async () => {
  const ids = Array.from({ length: 10 }, (_, i) => `concurrent-${i}`);
  await Promise.all(ids.map((id, i) => fetch(`${base}/orders/${i + 1}`, { headers: { 'x-request-id': id } })));
  for (const [i, id] of ids.entries()) {
    const own = linesFor(id);
    assert.equal(own.length, 3, `${id}: expected 3 lines, got ${own.length}`);
    assert.ok(own.every((line) => line.orderId === undefined || line.orderId === String(i + 1)));
  }
});

test('the summary line has the route template and a level that fits the status', async () => {
  await fetch(`${base}/orders/99`, { headers: { 'x-request-id': 'route-1' } });
  await fetch(`${base}/no/such/path`, { headers: { 'x-request-id': 'route-2' } });
  await fetch(`${base}/boom`, { headers: { 'x-request-id': 'route-3' } });
  const summary = (id: string) => linesFor(id).find((line) => line.msg === 'request completed');
  assert.equal(summary('route-1')?.route, '/orders/:id');
  assert.equal(summary('route-1')?.level, 30);
  assert.equal(summary('route-2')?.route, 'unmatched');
  assert.equal(summary('route-2')?.level, 40);
  assert.equal(summary('route-3')?.level, 50);
  assert.equal(typeof summary('route-3')?.durationMs, 'number');
});

test('secrets never reach the log', async () => {
  await fetch(`${base}/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-request-id': 'secret-1' },
    body: JSON.stringify({ email: 'ada@example.com', password: 'correct-horse-42' }),
  });
  await fetch(`${base}/boom`, {
    headers: { authorization: 'Bearer token-abc-987', cookie: 'sid=cookie-xyz-654', 'x-request-id': 'secret-2' },
  });
  assert.ok(linesFor('secret-1').some((line) => line.msg === 'user signed up'));
  assert.ok(linesFor('secret-2').some((line) => line.msg === 'unhandled error'));
  const all = JSON.stringify(lines);
  for (const secret of ['correct-horse-42', 'token-abc-987', 'cookie-xyz-654']) {
    assert.ok(!all.includes(secret), `${secret} was logged`);
  }
});
