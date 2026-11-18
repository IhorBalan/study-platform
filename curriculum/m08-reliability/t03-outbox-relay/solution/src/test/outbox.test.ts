import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { consume } from '../inbox.js';
import { placeOrder } from '../orders.js';
import { relayOnce } from '../outbox.js';
import { recordingPublisher, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

test('a placed order is published once', async () => {
  const { orderId } = await placeOrder(pool, { customerId: 'cus_1', totalCents: 1000 });
  const { sent, publish } = recordingPublisher();
  assert.equal(await relayOnce(pool, publish), 1);
  assert.deepEqual(sent[0]?.payload, { orderId, customerId: 'cus_1', totalCents: 1000 });
  assert.equal(sent[0]?.topic, 'order.placed');
  assert.equal(await relayOnce(pool, publish), 0);
});

test('a failed publish leaves the message for the next round', async () => {
  await placeOrder(pool, { customerId: 'cus_1', totalCents: 1 });
  const { sent, control, publish } = recordingPublisher();
  control.failNext = 1;
  assert.equal(await relayOnce(pool, publish), 0);
  assert.equal(sent.length, 0);
  assert.equal(await relayOnce(pool, publish), 1);
  assert.equal(sent.length, 1);
});

test('batchSize limits one round', async () => {
  for (let i = 0; i < 7; i++) await placeOrder(pool, { customerId: `c${i}`, totalCents: i });
  const { sent, publish } = recordingPublisher();
  assert.equal(await relayOnce(pool, publish, { batchSize: 3 }), 3);
  assert.deepEqual(sent.map((m) => (m.payload as { customerId: string }).customerId), ['c0', 'c1', 'c2']);
});

test('two relays at once publish every message exactly once', async () => {
  for (let i = 0; i < 60; i++) await placeOrder(pool, { customerId: `c${i}`, totalCents: i });
  const { sent, publish } = recordingPublisher();
  const slowPublish = async (m: Parameters<typeof publish>[0]) => {
    await new Promise((r) => setTimeout(r, 2));
    await publish(m);
  };
  const [a, b] = [testPool(3), testPool(3)];
  const loop = async (p: typeof pool) => {
    while ((await relayOnce(p, slowPublish, { batchSize: 5 })) > 0) {}
  };
  await Promise.all([loop(a), loop(b)]);
  await Promise.all([a.end(), b.end()]);
  assert.equal(sent.length, 60);
  assert.equal(new Set(sent.map((m) => m.id)).size, 60);
});

test('the inbox skips a duplicate message', async () => {
  await pool.query('create table if not exists counter (n int not null); truncate counter; insert into counter values (0)');
  const message = { id: 'm-1', topic: 't', payload: {} };
  const bump = async (client: Parameters<Parameters<typeof consume>[2]>[0]) => {
    await client.query('update counter set n = n + 1');
  };
  assert.equal(await consume(pool, message, bump), 'processed');
  assert.equal(await consume(pool, message, bump), 'duplicate');
  const { rows } = await pool.query('select n from counter');
  assert.equal(rows[0].n, 1);
});

test('a failing handler leaves the message unprocessed', async () => {
  const message = { id: 'm-2', topic: 't', payload: {} };
  await assert.rejects(consume(pool, message, async () => { throw new Error('boom'); }));
  assert.equal(await consume(pool, message, async () => {}), 'processed');
});
