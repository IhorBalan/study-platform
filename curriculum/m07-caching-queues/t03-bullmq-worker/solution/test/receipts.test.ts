// Tests for the receipt queue and worker against a real Valkey. Each test gets
// its own prefix, so its queue and keys are its own; after() deletes them all.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { Redis } from 'ioredis';
import type { Job, Queue } from 'bullmq';
import {
  createReceiptQueue,
  enqueueReceipt,
  startReceiptWorker,
  type Mailer,
  type ReceiptData,
  type ReceiptMessage,
  type ReceiptWorker,
} from '../src/receipts.ts';

const redisUrl = process.env.VALKEY_URL ?? 'redis://localhost:56379';
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}receipts-test-${randomUUID()}:`;
const open: Array<Queue<ReceiptData> | ReceiptWorker> = [];

after(async () => {
  for (const item of open.reverse()) await item.close();
  const redis = new Redis(redisUrl);
  const keys = await redis.keys(`${runPrefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await redis.quit();
});

/** A mailer whose behaviour per call is scripted: 'ok', 'fail' or 'permanent'. */
function fakeMailer(script: string[] = []) {
  const sent: Array<ReceiptMessage & { at: number }> = [];
  const attempts: number[] = [];
  const mailer: Mailer = {
    async send(message) {
      attempts.push(Date.now());
      const outcome = script.shift() ?? 'ok';
      if (outcome === 'fail') throw new Error('smtp timeout');
      if (outcome === 'permanent') throw Object.assign(new Error('mailbox does not exist'), { retryable: false });
      sent.push({ ...message, at: Date.now() });
    },
  };
  return { mailer, sent, attempts };
}

function setup(mailer: Mailer) {
  const prefix = `${runPrefix}${randomUUID()}:`;
  const queue = createReceiptQueue({ redisUrl, prefix, backoffDelayMs: 50 });
  const worker = startReceiptWorker({ redisUrl, prefix, mailer, backoffDelayMs: 50 });
  open.push(queue, worker);
  return { queue, worker };
}

async function settled(job: Job<ReceiptData>, timeoutMs = 5000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await job.getState();
    if (state === 'completed' || state === 'failed') return state;
    if (Date.now() > deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const order = (): ReceiptData => ({ orderId: randomUUID(), email: 'ada@example.test', amountCents: 4200 });

test('a receipt is sent once with an idempotency key', async () => {
  const { mailer, sent } = fakeMailer();
  const { queue } = setup(mailer);
  const data = order();
  const job = await enqueueReceipt(queue, data);
  assert.equal(await settled(job), 'completed');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotencyKey, `receipt-${data.orderId}`);
});

test('enqueueing the same order twice gives one job', async () => {
  const { mailer } = fakeMailer();
  const { queue } = setup(mailer);
  const data = order();
  const a = await enqueueReceipt(queue, data, { sendAt: new Date(Date.now() + 60_000) });
  const b = await enqueueReceipt(queue, data, { sendAt: new Date(Date.now() + 60_000) });
  assert.equal(a.id, b.id);
  assert.equal(await queue.getDelayedCount(), 1);
});

test('transient failures are retried with growing delays', async () => {
  const { mailer, sent, attempts } = fakeMailer(['fail', 'fail', 'ok']);
  const { queue } = setup(mailer);
  const job = await enqueueReceipt(queue, order());
  assert.equal(await settled(job), 'completed');
  assert.equal(attempts.length, 3);
  assert.equal(sent.length, 1);
  assert.ok(attempts[1] - attempts[0] >= 40, 'first retry waits about one base delay');
  assert.ok(attempts[2] - attempts[1] >= 80, 'second retry waits about two base delays');
});

test('a permanent failure is not retried and the job stays in failed', async () => {
  const { mailer, attempts } = fakeMailer(['permanent']);
  const { queue } = setup(mailer);
  const job = await enqueueReceipt(queue, order());
  assert.equal(await settled(job), 'failed');
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(attempts.length, 1);
  assert.equal((await queue.getJob(job.id!))?.failedReason, 'mailbox does not exist');
});

test('two jobs for the same order send one email', async () => {
  const { mailer, sent } = fakeMailer();
  const { queue } = setup(mailer);
  const data = order();
  const opts = { attempts: 5, backoff: { type: 'exponential', delay: 50 } };
  const jobs = await Promise.all([queue.add('receipt', data, { ...opts, jobId: 'dup-1' }), queue.add('receipt', data, { ...opts, jobId: 'dup-2' })]);
  for (const job of jobs) assert.equal(await settled(job), 'completed');
  assert.equal(sent.length, 1);
});

test('close waits for the running job', async () => {
  let finished = false;
  const prefix = `${runPrefix}${randomUUID()}:`;
  const queue = createReceiptQueue({ redisUrl, prefix });
  open.push(queue);
  let started!: () => void;
  const running = new Promise<void>((resolve) => (started = resolve));
  const worker = startReceiptWorker({
    redisUrl,
    prefix,
    mailer: {
      async send() {
        started();
        await new Promise((resolve) => setTimeout(resolve, 300));
        finished = true;
      },
    },
  });
  const job = await enqueueReceipt(queue, order());
  await running;
  await worker.close();
  assert.equal(finished, true);
  assert.equal(await job.getState(), 'completed');
});
