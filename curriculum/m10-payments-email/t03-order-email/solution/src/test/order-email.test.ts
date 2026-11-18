import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { formatMoney, renderOrderConfirmation, sendOrderConfirmation, type OrderEmail } from '../order-email.js';
import { failingTransport, recordingTransport, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

const order = (orderId: string): OrderEmail => ({
  orderId,
  to: 'ada@example.test',
  customerName: 'Ada <b>Lovelace</b>',
  currency: 'eur',
  items: [
    { name: 'Mug', quantity: 2, unitAmountMinor: 1250 },
    { name: 'Sticker', quantity: 1, unitAmountMinor: 199 },
  ],
});

test('money is formatted from minor units with the currency digits', () => {
  assert.equal(formatMoney(2699, 'eur'), '€26.99');
  assert.equal(formatMoney(2699, 'JPY'), '¥2,699');
});

test('the html escapes the customer name and the text keeps it', () => {
  const email = renderOrderConfirmation(order('ord_1'));
  assert.ok(email.html.includes('Ada &lt;b&gt;Lovelace&lt;/b&gt;'));
  assert.ok(!email.html.includes('<b>Lovelace'));
  assert.ok(email.text.includes('Ada <b>Lovelace</b>'));
  assert.ok(email.text.includes('Total: €26.99'));
});

test('a second call for the same order sends nothing', async () => {
  const { transport, sent } = recordingTransport();
  assert.equal(await sendOrderConfirmation({ pool, transport }, order('ord_2')), 'sent');
  assert.equal(await sendOrderConfirmation({ pool, transport }, order('ord_2')), 'skipped');
  assert.equal(sent.length, 1);
});

test('concurrent calls send once', async () => {
  const { transport, sent } = recordingTransport();
  const results = await Promise.all(Array.from({ length: 5 }, () => sendOrderConfirmation({ pool, transport }, order('ord_3'))));
  assert.equal(results.filter((r) => r === 'sent').length, 1);
  assert.equal(sent.length, 1);
});

test('a failed send can be retried', async () => {
  await assert.rejects(sendOrderConfirmation({ pool, transport: failingTransport() }, order('ord_4')));
  const { transport, sent } = recordingTransport();
  assert.equal(await sendOrderConfirmation({ pool, transport }, order('ord_4')), 'sent');
  assert.equal(sent.length, 1);
});
