import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { sendOrderConfirmation, type OrderEmail } from '../order-email.js';
import { recordingTransport, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

const order = (orderId: string): OrderEmail => ({
  orderId,
  to: 'ada@example.test',
  customerName: 'Ada Lovelace',
  currency: 'eur',
  items: [{ name: 'Mug', quantity: 2, unitAmountMinor: 1250 }],
});

test('a new order is sent', async () => {
  const { transport, sent } = recordingTransport();
  assert.equal(await sendOrderConfirmation({ pool, transport }, order('ord_1')), 'sent');
  assert.equal(sent.length, 1);
});

// TODO: money formatting, escaping, a second call, concurrent calls, a failed send followed by a retry.
