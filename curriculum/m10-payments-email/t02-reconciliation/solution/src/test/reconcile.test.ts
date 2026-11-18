import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { reconcile } from '../reconcile.js';
import { fixtureCharges, resetSchema, seed, testPool, WINDOW } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

test('a clean day reports only matches, with integer totals per currency', async () => {
  await seed(pool, [
    { pi: 'pi_001', amount: 4900, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_002', amount: 12000, currency: 'EUR', status: 'partially_refunded', refunded: 2000 },
    { pi: 'pi_003', amount: 990, currency: 'USD', status: 'succeeded' },
    { pi: 'pi_004', amount: 3500, currency: 'JPY', status: 'succeeded' },
    { pi: 'pi_005', amount: 2500, currency: 'EUR', status: 'refunded', refunded: 2500 },
    { pi: 'pi_006', amount: 1500, currency: 'EUR', status: 'failed' },
  ]);
  const report = await reconcile(pool, fixtureCharges(), WINDOW);
  assert.equal(report.matched, 5);
  assert.deepEqual([report.missing, report.mismatched, report.orphaned], [[], [], []]);
  assert.deepEqual(report.totals, {
    eur: { stripeNetMinor: 14900, localNetMinor: 14900 },
    usd: { stripeNetMinor: 990, localNetMinor: 990 },
    jpy: { stripeNetMinor: 3500, localNetMinor: 3500 },
  });
});

test('missing, mismatched and orphaned records are reported', async () => {
  const [paid, pending, ghost] = await seed(pool, [
    { pi: 'pi_001', amount: 4900, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_002', amount: 12000, currency: 'EUR', status: 'pending' },          // paid in Stripe, not here
    { pi: 'pi_999', amount: 700, currency: 'EUR', status: 'succeeded' },          // Stripe never saw it
    { pi: 'pi_006', amount: 1500, currency: 'EUR', status: 'failed' },            // agrees: no money
  ]);
  const report = await reconcile(pool, fixtureCharges(), WINDOW);
  assert.deepEqual(report.missing.map((m) => m.chargeId), ['ch_003b', 'ch_004', 'ch_005']);
  assert.deepEqual(report.mismatched, [{ paymentId: pending, paymentIntentId: 'pi_002', chargeId: 'ch_002', fields: ['status', 'refunded'] }]);
  assert.deepEqual(report.orphaned, [{ paymentId: ghost, paymentIntentId: 'pi_999' }]);
  assert.equal(report.matched, 1);
  assert.ok(paid);
});

test('a failed charge before the successful one is ignored', async () => {
  await seed(pool, [{ pi: 'pi_003', amount: 990, currency: 'USD', status: 'succeeded' }]);
  const charges = fixtureCharges().filter((c) => c.payment_intent === 'pi_003');
  const report = await reconcile(pool, charges, WINDOW);
  assert.equal(report.matched, 1);
  assert.deepEqual(report.mismatched, []);
});

test('a failed charge with a failed local payment is not a difference', async () => {
  await seed(pool, [{ pi: 'pi_006', amount: 1500, currency: 'EUR', status: 'failed' }]);
  const charges = fixtureCharges().filter((c) => c.payment_intent === 'pi_006');
  const report = await reconcile(pool, charges, WINDOW);
  assert.deepEqual([report.matched, report.missing, report.mismatched, report.orphaned], [0, [], [], []]);
});

test('charges can come from an async iterable', async () => {
  await seed(pool, [{ pi: 'pi_001', amount: 4900, currency: 'EUR', status: 'succeeded' }]);
  async function* pages() {
    yield fixtureCharges()[0]!;
  }
  const report = await reconcile(pool, pages(), WINDOW);
  assert.equal(report.matched, 1);
});
