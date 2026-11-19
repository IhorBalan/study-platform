import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { sampleTickets } from '../seed.mjs';
import { createApp } from '../server.mjs';

let server;
let base;

before(async () => {
  server = createApp(sampleTickets(25));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /tickets pages through the list with the cursor from the previous answer', async () => {
  const first = await (await fetch(`${base}/tickets?limit=20`)).json();
  assert.equal(first.items.length, 20);
  const next = await fetch(`${base}/tickets?limit=20&cursor=${encodeURIComponent(first.nextCursor)}`);
  const second = await next.json();
  assert.equal(second.items.length, 5);
  assert.equal(second.nextCursor, null);
});

test('GET /tickets answers invalid input with a 400 problem document', async () => {
  for (const query of ['limit=10abc', 'limit=0', 'status=done', 'sort=title', 'cursor=nope']) {
    const res = await fetch(`${base}/tickets?${query}`);
    assert.equal(res.status, 400, query);
    assert.match(res.headers.get('content-type'), /^application\/problem\+json/);
    assert.equal((await res.json()).status, 400);
  }
});
