import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createPayments, IdempotencyConflictError, RequestInProgressError } from '../payments.js';
import { FakeGateway, resetSchema, testPool } from './helpers.js';

const pool = testPool();
beforeEach(() => resetSchema(pool));
after(() => pool.end());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test('a new key charges once and stores a payment', async () => {
  const gateway = new FakeGateway();
  const { pay } = createPayments(pool, gateway);
  const result = await pay({ customerId: 'cus_1', key: 'k1', amountCents: 500 });
  assert.equal(result.replayed, false);
  assert.equal(gateway.realCharges, 1);
  const { rows } = await pool.query('select id from payments');
  assert.deepEqual(rows.map((r) => r.id), [result.paymentId]);
});

test('a retry with the same key replays without calling the gateway', async () => {
  const gateway = new FakeGateway();
  const { pay } = createPayments(pool, gateway);
  const first = await pay({ customerId: 'cus_1', key: 'k1', amountCents: 500 });
  const second = await pay({ customerId: 'cus_1', key: 'k1', amountCents: 500 });
  assert.deepEqual(second, { ...first, replayed: true });
  assert.equal(gateway.calls.length, 1);
});

test('the same key with another amount is a conflict', async () => {
  const { pay } = createPayments(pool, new FakeGateway());
  await pay({ customerId: 'cus_1', key: 'k1', amountCents: 500 });
  await assert.rejects(pay({ customerId: 'cus_1', key: 'k1', amountCents: 900 }), IdempotencyConflictError);
});

test('keys belong to one customer', async () => {
  const gateway = new FakeGateway();
  const { pay } = createPayments(pool, gateway);
  const a = await pay({ customerId: 'cus_a', key: 'same', amountCents: 100 });
  const b = await pay({ customerId: 'cus_b', key: 'same', amountCents: 100 });
  assert.notEqual(a.paymentId, b.paymentId);
  assert.equal(gateway.realCharges, 2);
});

test('concurrent duplicates charge once', async () => {
  const gateway = new FakeGateway(100);
  const { pay } = createPayments(pool, gateway);
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => pay({ customerId: 'cus_1', key: 'race', amountCents: 300 })),
  );
  const ok = results.filter((r) => r.status === 'fulfilled');
  const busy = results.filter((r) => r.status === 'rejected' && r.reason instanceof RequestInProgressError);
  assert.equal(ok.length + busy.length, 5);
  assert.equal(gateway.realCharges, 1);
});

test('a lost gateway response is retried after the lease without a second charge', async () => {
  const gateway = new FakeGateway();
  let lose = true;
  const flaky = {
    async charge(request: Parameters<FakeGateway['charge']>[0]) {
      const result = await gateway.charge(request);
      if (lose) {
        lose = false;
        throw new Error('socket hang up');
      }
      return result;
    },
  };
  const { pay } = createPayments(pool, flaky, { leaseMs: 100 });
  await assert.rejects(pay({ customerId: 'cus_1', key: 'k1', amountCents: 700 }));
  await sleep(150);
  const result = await pay({ customerId: 'cus_1', key: 'k1', amountCents: 700 });
  assert.equal(result.replayed, false);
  assert.equal(gateway.realCharges, 1);
});
