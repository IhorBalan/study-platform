import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
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
  assert.equal(await relayOnce(pool, publish), 0);
});

// TODO: add tests for a failing publish, batch sizes, two relays at once and the inbox.
