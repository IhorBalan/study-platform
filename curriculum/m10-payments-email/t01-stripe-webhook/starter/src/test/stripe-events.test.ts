import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { handleStripeEvent } from '../webhooks/stripe-events.js';
import { FakeStripe, makeEvent, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

test('a paid checkout session marks the order paid', async () => {
  const stripe = new FakeStripe();
  await pool.query(`insert into orders (id, amount_minor, currency) values ('ord_1', 2500, 'eur')`);
  stripe.sessions.set('cs_1', { id: 'cs_1', payment_status: 'paid', client_reference_id: 'ord_1' });

  const result = await handleStripeEvent({ pool, stripe }, makeEvent('checkout.session.completed', { id: 'cs_1' }));

  assert.equal(result, 'processed');
  const { rows } = await pool.query(`select status from orders where id = 'ord_1'`);
  assert.equal(rows[0].status, 'paid');
});

// TODO: duplicates, concurrent copies, unpaid sessions, subscriptions arriving out of order, failures.
