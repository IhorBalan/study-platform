import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../server.mjs';
import { createShortener } from '../shortener.mjs';

let server;
let base;

before(async () => {
  server = createApp(createShortener({ rateLimit: { capacity: 2, refillPerSecond: 0.001 } }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => new Promise((resolve) => server.close(resolve)));

const post = (body, clientId = 'http-test') =>
  fetch(`${base}/links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-client-id': clientId },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

test('create, redirect and 404', async () => {
  const created = await post({ url: 'https://example.com/x' });
  assert.equal(created.status, 201);
  const { code } = await created.json();
  const redirect = await fetch(`${base}/${code}`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://example.com/x');
  assert.equal((await fetch(`${base}/nope123`)).status, 404);
});

test('invalid input is a 400 problem document and the limit is a 429', async () => {
  const bad = await post({ url: 'javascript:alert(1)' }, 'other');
  assert.equal(bad.status, 400);
  assert.match(bad.headers.get('content-type'), /application\/problem\+json/);
  assert.equal((await post('{not json', 'third')).status, 400);
  await post({ url: 'https://example.com/1' }, 'limited');
  await post({ url: 'https://example.com/2' }, 'limited');
  const limited = await post({ url: 'https://example.com/3' }, 'limited');
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) >= 1);
});
