import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { reconcile } from '../reconcile.js';
import { fixtureCharges, resetSchema, seed, testPool, WINDOW } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

test('a payment that agrees with its charge is matched', async () => {
  await seed(pool, [{ pi: 'pi_001', amount: 4900, currency: 'EUR', status: 'succeeded' }]);
  const charges = fixtureCharges().filter((c) => c.payment_intent === 'pi_001');
  const report = await reconcile(pool, charges, WINDOW);
  assert.equal(report.matched, 1);
});

// TODO: missing, mismatched and orphaned records, failed charges, totals, an async iterable.
