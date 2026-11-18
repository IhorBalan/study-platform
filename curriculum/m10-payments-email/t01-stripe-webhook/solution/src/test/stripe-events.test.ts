import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { handleStripeEvent } from '../webhooks/stripe-events.js';
import { FakeStripe, makeEvent, makeSubscription, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

async function order(id: string) {
  await pool.query(`insert into orders (id, amount_minor, currency) values ($1, 2500, 'eur')`, [id]);
}
const fulfilments = async (orderId: string) =>
  (await pool.query('select count(*)::int as n from fulfilments where order_id = $1', [orderId])).rows[0].n as number;

test('a paid checkout session fulfils the order once', async () => {
  const stripe = new FakeStripe();
  await order('ord_1');
  stripe.sessions.set('cs_1', { id: 'cs_1', payment_status: 'paid', client_reference_id: 'ord_1' });
  const event = makeEvent('checkout.session.completed', { id: 'cs_1' });

  assert.equal(await handleStripeEvent({ pool, stripe }, event), 'processed');
  assert.equal(await handleStripeEvent({ pool, stripe }, event), 'duplicate');
  assert.equal(await fulfilments('ord_1'), 1);
  const { rows } = await pool.query('select status from orders where id = $1', ['ord_1']);
  assert.equal(rows[0].status, 'paid');
});

test('concurrent copies of one event are processed once', async () => {
  const stripe = new FakeStripe();
  await order('ord_2');
  stripe.sessions.set('cs_2', { id: 'cs_2', payment_status: 'paid', client_reference_id: 'ord_2' });
  const event = makeEvent('checkout.session.completed', { id: 'cs_2' });
  const results = await Promise.all(Array.from({ length: 5 }, () => handleStripeEvent({ pool, stripe }, event)));
  assert.deepEqual(results.filter((r) => r === 'processed').length, 1);
  assert.equal(await fulfilments('ord_2'), 1);
});

test('an unpaid session waits for async_payment_succeeded', async () => {
  const stripe = new FakeStripe();
  await order('ord_3');
  stripe.sessions.set('cs_3', { id: 'cs_3', payment_status: 'unpaid', client_reference_id: 'ord_3' });
  await handleStripeEvent({ pool, stripe }, makeEvent('checkout.session.completed', { id: 'cs_3' }));
  assert.equal(await fulfilments('ord_3'), 0);
  stripe.sessions.set('cs_3', { id: 'cs_3', payment_status: 'paid', client_reference_id: 'ord_3' });
  await handleStripeEvent({ pool, stripe }, makeEvent('checkout.session.async_payment_succeeded', { id: 'cs_3' }));
  assert.equal(await fulfilments('ord_3'), 1);
});

test('a late created event does not roll a subscription back', async () => {
  const stripe = new FakeStripe();
  stripe.subs.set('sub_1', makeSubscription('sub_1', 'active'));
  await handleStripeEvent({ pool, stripe }, makeEvent('customer.subscription.updated', { id: 'sub_1', status: 'active' }));
  await handleStripeEvent({ pool, stripe }, makeEvent('customer.subscription.created', { id: 'sub_1', status: 'incomplete' }));
  const { rows } = await pool.query('select status from subscriptions where stripe_subscription_id = $1', ['sub_1']);
  assert.equal(rows[0].status, 'active');
});

test('a failure stores nothing, so a retry processes the event', async () => {
  const stripe = new FakeStripe();
  await order('ord_4');
  stripe.sessions.set('cs_4', { id: 'cs_4', payment_status: 'paid', client_reference_id: 'ord_4' });
  const event = makeEvent('checkout.session.completed', { id: 'cs_4' });
  stripe.failing = true;
  await assert.rejects(handleStripeEvent({ pool, stripe }, event));
  stripe.failing = false;
  assert.equal(await handleStripeEvent({ pool, stripe }, event), 'processed');
  assert.equal(await fulfilments('ord_4'), 1);
});
