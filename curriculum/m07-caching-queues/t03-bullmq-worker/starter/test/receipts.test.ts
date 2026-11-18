// Tests for the receipt queue and worker against a real Valkey. Run them with `npm test`.
// Give each test a prefix of its own, and close every queue and worker in after().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import type { Queue } from 'bullmq';
import { createReceiptQueue, enqueueReceipt, startReceiptWorker, type ReceiptData, type ReceiptMessage, type ReceiptWorker } from '../src/receipts.ts';

const redisUrl = process.env.VALKEY_URL ?? 'redis://localhost:56379';
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}receipts-test-${randomUUID()}:`;
const open: Array<Queue<ReceiptData> | ReceiptWorker> = [];

after(async () => {
  for (const item of open.reverse()) await item.close();
  // TODO: delete every key under runPrefix.
});

test('a receipt is sent', async () => {
  const sent: ReceiptMessage[] = [];
  const prefix = `${runPrefix}${randomUUID()}:`;
  const queue = createReceiptQueue({ redisUrl, prefix });
  const worker = startReceiptWorker({ redisUrl, prefix, mailer: { send: async (m) => void sent.push(m) } });
  open.push(queue, worker);

  const job = await enqueueReceipt(queue, { orderId: randomUUID(), email: 'ada@example.test', amountCents: 4200 });
  for (let i = 0; i < 100 && (await job.getState()) !== 'completed'; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(sent.length, 1);
});

// TODO: enqueueing the same order twice gives one job.
// TODO: transient failures are retried with growing delays.
// TODO: a permanent failure is not retried.
// TODO: two jobs for the same order send one email.
// TODO: close() waits for the running job.
