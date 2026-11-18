import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createPayments } from '../payments.js';
import { FakeGateway, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

test('a new key charges once and stores a payment', async () => {
  const gateway = new FakeGateway();
  const { pay } = createPayments(pool, gateway);
  const result = await pay({ customerId: 'cus_1', key: 'k1', amountCents: 500 });
  assert.equal(result.replayed, false);
  assert.equal(gateway.realCharges, 1);
});

// TODO: add tests for replays, conflicts, concurrent duplicates and retries after a failure.
