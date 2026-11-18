// Checks for "A reliable receipt worker with BullMQ". Node built-ins only; bullmq and
// ioredis come from the submission's node_modules. Node runs src/receipts.ts directly
// by stripping its types. Every check uses a prefix of its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const VALKEY_URL = process.env.VALKEY_URL;
const ROOT = `${process.env.VALKEY_KEY_PREFIX ?? 'check_local:'}t03:${randomUUID().slice(0, 8)}:`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));

const toClose = [];
let admin;

after(async () => {
  for (const item of toClose.reverse()) {
    await Promise.race([item.close().catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (admin) {
    let cursor = '0';
    do {
      const [next, keys] = await admin.scan(cursor, 'MATCH', `${ROOT}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await admin.del(...keys);
    } while (cursor !== '0');
    await admin.quit();
  }
});

let loaded;
async function load() {
  assert.ok(VALKEY_URL, 'VALKEY_URL is not set for the check run. Start the lab Valkey with `pnpm lab up valkey`.');
  const file = path.join(dir, 'src', 'receipts.ts');
  assert.ok(existsSync(file), 'src/receipts.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  for (const name of ['createReceiptQueue', 'enqueueReceipt', 'startReceiptWorker']) {
    assert.equal(typeof mod[name], 'function', `src/receipts.ts must export a function named ${name}.`);
  }
  if (!admin) {
    const { Redis } = requireFromSubmission('ioredis');
    admin = new Redis(VALKEY_URL, { maxRetriesPerRequest: 2 });
  }
  return mod;
}

let counter = 0;
const freshPrefix = () => `${ROOT}${++counter}:`;
const order = (n = randomUUID().slice(0, 8)) => ({ orderId: `o${n}`, email: `buyer-${n}@example.test`, amountCents: 4200 });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A fake mailer. `plan(orderId, attemptIndex)` returns 'ok', 'fail' (an ordinary error),
 * 'permanent' (an error with retryable: false) or a number of milliseconds to take.
 */
function fakeMailer(plan = () => 'ok') {
  const calls = [];
  const sent = [];
  const mailer = {
    async send(message) {
      const orderId = String(message?.idempotencyKey ?? '').replace(/^receipt-/, '');
      const attempt = calls.filter((c) => c.orderId === orderId).length;
      calls.push({ orderId, at: Date.now(), message });
      const outcome = plan(orderId, attempt);
      if (outcome === 'fail') throw new Error('smtp timeout');
      if (outcome === 'permanent') throw Object.assign(new Error('mailbox does not exist'), { retryable: false });
      if (typeof outcome === 'number') await sleep(outcome);
      sent.push({ orderId, at: Date.now(), message });
    },
  };
  return { mailer, calls, sent };
}

async function setup({ mailer, backoffDelayMs = 100, worker = true } = {}) {
  const mod = await load();
  const prefix = freshPrefix();
  const queue = mod.createReceiptQueue({ redisUrl: VALKEY_URL, prefix, backoffDelayMs });
  toClose.push(queue);
  assert.equal(
    queue.opts?.prefix,
    `${prefix}bull`,
    `createReceiptQueue should pass prefix: \`\${prefix}bull\` to BullMQ, so every key stays under the given prefix. Found ${JSON.stringify(queue.opts?.prefix)}.`,
  );
  let handle;
  if (worker) {
    handle = mod.startReceiptWorker({ redisUrl: VALKEY_URL, prefix, mailer, backoffDelayMs });
    assert.equal(typeof handle?.close, 'function', 'startReceiptWorker must return an object with a close() method.');
    toClose.push(handle);
    assert.equal(
      handle.worker?.opts?.prefix,
      `${prefix}bull`,
      `startReceiptWorker should pass prefix: \`\${prefix}bull\` to the BullMQ Worker. Found ${JSON.stringify(handle.worker?.opts?.prefix)}.`,
    );
  }
  return { mod, prefix, queue, handle };
}

async function settle(queue, id, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = await queue.getJobState(id);
    if (state === 'completed' || state === 'failed' || Date.now() > deadline) {
      // Read the job after its state is final, so attemptsMade and failedReason are final too.
      return { state, job: await queue.getJob(id) };
    }
    await sleep(25);
  }
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('enqueue: one job per order in the receipts queue, with 5 attempts and exponential backoff', async () => {
  const { mod, prefix, queue } = await setup({ worker: false, backoffDelayMs: 250 });
  assert.equal(queue.name, 'receipts', `The queue should be named "receipts", it is "${queue.name}".`);
  const data = order('1');
  const job = await mod.enqueueReceipt(queue, data);
  assert.equal(job.id, 'receipt-o1', `The job id should be "receipt-<orderId>", got "${job.id}".`);
  assert.equal(job.name, 'receipt', `The job name should be "receipt", got "${job.name}".`);
  const again = await mod.enqueueReceipt(queue, data);
  assert.equal(again.id, 'receipt-o1');
  assert.equal(await queue.getWaitingCount(), 1, 'Enqueueing the same order twice should leave one job waiting.');

  const stored = await queue.getJob('receipt-o1');
  assert.equal(stored?.opts?.attempts, 5, `Jobs should have 5 attempts, found ${stored?.opts?.attempts}.`);
  const backoff = stored?.opts?.backoff;
  assert.equal(backoff?.type, 'exponential', `Jobs should use exponential backoff, found ${JSON.stringify(backoff)}.`);
  assert.equal(backoff?.delay, 250, `The backoff delay should be backoffDelayMs (250), found ${backoff?.delay}.`);

  const [, keys] = await admin.scan('0', 'MATCH', `${prefix}bull:receipts:*`, 'COUNT', 1000);
  assert.ok(keys.length > 0, 'Expected the queue\'s keys under "<prefix>bull:receipts:". Pass prefix: `${prefix}bull` to BullMQ.');
});

test('delayed: sendAt delays the job until that time', async () => {
  const fake = fakeMailer();
  const { mod, queue } = await setup({ mailer: fake.mailer });
  const enqueuedAt = Date.now();
  const job = await mod.enqueueReceipt(queue, order(), { sendAt: new Date(enqueuedAt + 500) });
  assert.equal(await job.getState(), 'delayed', 'A job with sendAt in the future should be delayed.');
  const { state } = await settle(queue, job.id);
  assert.equal(state, 'completed', `The delayed job should complete, it is ${state}.`);
  assert.equal(fake.sent.length, 1);
  assert.ok(fake.sent[0].at - enqueuedAt >= 450, `The email went out ${fake.sent[0].at - enqueuedAt} ms after enqueue, before sendAt (500 ms).`);
});

test('retries-backoff: transient failures are retried with exponential delays, and exhausted jobs stay failed', async () => {
  const fake = fakeMailer((orderId, attempt) => (orderId === 'oflaky' ? (attempt < 2 ? 'fail' : 'ok') : 'fail'));
  const { mod, queue } = await setup({ mailer: fake.mailer, backoffDelayMs: 100 });

  const flaky = await mod.enqueueReceipt(queue, order('flaky'));
  const { state, job } = await settle(queue, flaky.id);
  assert.equal(state, 'completed', `A mailer that fails twice and then works should end in completed, the job is ${state}.`);
  const times = fake.calls.filter((c) => c.orderId === 'oflaky').map((c) => c.at);
  assert.equal(times.length, 3, `Expected 3 attempts, the mailer was called ${times.length} times.`);
  assert.equal(job.attemptsMade, 3, `attemptsMade should be 3, it is ${job.attemptsMade}.`);
  assert.ok(times[1] - times[0] >= 45, `The first retry came ${times[1] - times[0]} ms after the failure. Expected a backoff of about 100 ms.`);
  assert.ok(times[2] - times[1] >= 95, `The second retry came ${times[2] - times[1]} ms after the failure. Expected about 200 ms.`);

  const doomed = await mod.enqueueReceipt(queue, order('doomed'));
  const end = await settle(queue, doomed.id, 8000);
  assert.equal(end.state, 'failed', `A mailer that always fails should leave the job in failed, it is ${end.state}.`);
  assert.equal(fake.calls.filter((c) => c.orderId === 'odoomed').length, 5, 'A job that keeps failing should be tried 5 times.');
  assert.match(end.job.failedReason ?? '', /smtp timeout/, 'The failed job should keep the last error as failedReason.');
});

test('permanent-failure: an error with retryable false fails the job at once', async () => {
  const fake = fakeMailer(() => 'permanent');
  const { queue } = await setup({ mailer: fake.mailer, backoffDelayMs: 50 });
  // Added with retries allowed, so only the handler can stop them.
  const job = await queue.add('receipt', order(), { jobId: 'perm-1', attempts: 5, backoff: { type: 'fixed', delay: 50 } });
  const { state, job: done } = await settle(queue, job.id);
  assert.equal(state, 'failed', `The job should be failed, it is ${state}.`);
  await sleep(400);
  assert.equal(fake.calls.length, 1, `A permanent error should not be retried, the mailer was called ${fake.calls.length} times.`);
  assert.match(done.failedReason ?? '', /mailbox does not exist/, 'failedReason should carry the mailer\'s message.');
});

test('idempotent: the same order in several jobs sends one email, with the idempotency key', async () => {
  const fake = fakeMailer(() => 80);
  const { queue } = await setup({ mailer: fake.mailer, backoffDelayMs: 50 });
  const data = order('dup');
  const opts = { attempts: 5, backoff: { type: 'exponential', delay: 50 } };
  // At-least-once delivery: duplicates arrive as separate jobs, at the same time and later.
  await Promise.all([queue.add('receipt', data, { ...opts, jobId: 'dup-1' }), queue.add('receipt', data, { ...opts, jobId: 'dup-2' })]);
  for (const id of ['dup-1', 'dup-2']) {
    const { state } = await settle(queue, id);
    assert.equal(state, 'completed', `Job ${id} should complete, it is ${state}.`);
  }
  await queue.add('receipt', data, { ...opts, jobId: 'dup-3' });
  const { state } = await settle(queue, 'dup-3');
  assert.equal(state, 'completed', `A later duplicate should complete without sending, it is ${state}.`);
  assert.equal(fake.sent.length, 1, `Three jobs for one order sent ${fake.sent.length} emails. Expected 1.`);
  const m = fake.sent[0].message;
  assert.equal(m.idempotencyKey, 'receipt-odup', `The idempotency key should be "receipt-<orderId>", got "${m.idempotencyKey}".`);
  assert.equal(m.to, data.email, 'The email should go to the order\'s address.');
});

test('graceful-shutdown: close() waits for the running job and then stops taking jobs', async () => {
  let started;
  const running = new Promise((resolve) => (started = resolve));
  const fake = fakeMailer();
  const slow = {
    async send(message) {
      started();
      await sleep(600);
      await fake.mailer.send(message);
    },
  };
  const { mod, queue, handle } = await setup({ mailer: slow });
  const job = await mod.enqueueReceipt(queue, order());
  await Promise.race([running, sleep(5000)]);
  assert.equal(fake.sent.length, 0);
  const timeout = sleep(5000).then(() => 'timeout');
  const closed = await Promise.race([handle.close().then(() => 'closed'), timeout]);
  assert.equal(closed, 'closed', 'close() did not resolve within 5 s.');
  assert.equal(fake.sent.length, 1, 'close() resolved before the running job had finished sending.');
  assert.equal(await job.getState(), 'completed', 'The running job should be completed after close(), not left active or stalled.');

  const later = await mod.enqueueReceipt(queue, order());
  await sleep(300);
  assert.equal(await later.getState(), 'waiting', 'After close() the worker should not take new jobs.');
});
