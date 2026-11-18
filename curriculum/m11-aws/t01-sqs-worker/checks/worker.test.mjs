// Checks for "A reliable SQS worker". Node built-ins only; the AWS SDK comes from the
// submission's node_modules. Node runs src/worker.ts directly by stripping its types.
// Every queue starts with AWS_RESOURCE_PREFIX and is deleted in after().
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const PREFIX = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}t01-${randomUUID().slice(0, 6)}-`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));

let sdk;
let sqs;
const queues = [];
const workers = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

after(async () => {
  for (const worker of workers) {
    await Promise.race([Promise.resolve().then(() => worker.stop()).catch(() => undefined), sleep(5000)]);
  }
  if (sqs) {
    const listed = await sqs.send(new sdk.ListQueuesCommand({ QueueNamePrefix: PREFIX })).catch(() => ({}));
    const urls = new Set([...queues, ...(listed.QueueUrls ?? [])]);
    for (const url of urls) await sqs.send(new sdk.DeleteQueueCommand({ QueueUrl: url })).catch(() => undefined);
    sqs.destroy();
  }
});

let loaded;
async function load() {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set for the check run. Start the emulator with `pnpm lab up aws`.');
  const file = path.join(dir, 'src', 'worker.ts');
  assert.ok(existsSync(file), 'src/worker.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  assert.equal(typeof mod.startWorker, 'function', 'src/worker.ts must export a function named startWorker.');
  if (!sqs) {
    sdk = requireFromSubmission('@aws-sdk/client-sqs');
    sqs = new sdk.SQSClient({ useQueueUrlAsEndpoint: false });
  }
  return mod;
}

let counter = 0;
async function createQueue(attributes = {}) {
  const name = `${PREFIX}${++counter}`;
  const { QueueUrl } = await sqs.send(new sdk.CreateQueueCommand({ QueueName: name, Attributes: attributes }));
  queues.push(QueueUrl);
  const res = await sqs.send(new sdk.GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
  return { url: QueueUrl, arn: res.Attributes.QueueArn };
}

async function send(url, body) {
  await sqs.send(new sdk.SendMessageCommand({ QueueUrl: url, MessageBody: JSON.stringify(body) }));
}

async function messagesLeft(url) {
  const res = await sqs.send(
    new sdk.GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }),
  );
  return Number(res.Attributes.ApproximateNumberOfMessages) + Number(res.Attributes.ApproximateNumberOfMessagesNotVisible);
}

async function until(condition, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await condition()) return true;
    if (Date.now() > deadline) return false;
    await sleep(50);
  }
}

/** A client that records every command it sends, and forwards it (with its options) to the real one. */
function recordingClient() {
  const sent = [];
  return {
    sent,
    client: {
      send(command, options) {
        sent.push({ name: command?.constructor?.name, input: command?.input, at: Date.now() });
        return sqs.send(command, options);
      },
    },
  };
}

function start(mod, options) {
  const worker = mod.startWorker(options);
  assert.equal(typeof worker?.stop, 'function', 'startWorker must return an object with a stop() method.');
  workers.push(worker);
  return worker;
}

async function stopWithin(worker, ms) {
  const started = Date.now();
  const result = await Promise.race([Promise.resolve(worker.stop()).then(() => 'stopped'), sleep(ms).then(() => 'timeout')]);
  return { result, took: Date.now() - started };
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('long-polling: ReceiveMessage long-polls for up to 10 messages and asks for the receive count', async () => {
  const mod = await load();
  const q = await createQueue();
  const rec = recordingClient();
  const worker = start(mod, { sqs: rec.client, queueUrl: q.url, handler: async () => undefined });
  await until(() => rec.sent.some((c) => c.name === 'ReceiveMessageCommand'), 3000);
  await stopWithin(worker, 5000);
  const receive = rec.sent.find((c) => c.name === 'ReceiveMessageCommand');
  assert.ok(receive, 'The worker never sent a ReceiveMessageCommand through the sqs client it was given.');
  assert.equal(receive.input.QueueUrl, q.url, 'ReceiveMessage should use the queueUrl option.');
  assert.equal(receive.input.WaitTimeSeconds, 20, `With no waitTimeSeconds option, WaitTimeSeconds should be 20. Found ${receive.input.WaitTimeSeconds}.`);
  assert.equal(receive.input.MaxNumberOfMessages, 10, `With no maxMessages option, MaxNumberOfMessages should be 10. Found ${receive.input.MaxNumberOfMessages}.`);
  const asked = [...(receive.input.MessageSystemAttributeNames ?? []), ...(receive.input.AttributeNames ?? [])];
  assert.ok(
    asked.includes('ApproximateReceiveCount') || asked.includes('All'),
    `ReceiveMessage should request the ApproximateReceiveCount attribute. Requested: ${JSON.stringify(asked)}.`,
  );
});

test('deletes-on-success: each message reaches the handler once, parsed, and is deleted after success', async () => {
  const mod = await load();
  const q = await createQueue();
  const seen = [];
  start(mod, { sqs, queueUrl: q.url, waitTimeSeconds: 1, handler: async (m) => void seen.push(m) });
  for (let i = 1; i <= 5; i++) await send(q.url, { orderId: `o${i}`, total: i * 100 });
  const all = await until(() => seen.length >= 5, 8000);
  assert.ok(all, `Expected the handler to receive 5 messages, it received ${seen.length}.`);
  const bodies = seen.map((m) => m.body?.orderId).sort();
  assert.deepEqual(bodies, ['o1', 'o2', 'o3', 'o4', 'o5'], 'The handler should receive each message body parsed from JSON.');
  assert.ok(seen.every((m) => typeof m.messageId === 'string' && m.messageId.length > 0), 'Each message passed to the handler needs its messageId.');
  assert.ok(seen.every((m) => m.receiveCount === 1), `First deliveries should have receiveCount 1. Found ${JSON.stringify(seen.map((m) => m.receiveCount))}.`);
  const empty = await until(async () => (await messagesLeft(q.url)) === 0, 4000);
  assert.ok(empty, 'Handled messages should be deleted from the queue.');
  await sleep(500);
  assert.equal(seen.length, 5, `Each message should be handled once. The handler ran ${seen.length} times for 5 messages.`);
});

test('retry-backoff: a failed message is not deleted and comes back after a doubling delay', async () => {
  const mod = await load();
  // A long visibility timeout: only the worker's own retry delay can bring the message back quickly.
  const q = await createQueue({ VisibilityTimeout: '30' });
  const calls = [];
  start(mod, {
    sqs,
    queueUrl: q.url,
    waitTimeSeconds: 1,
    retryBaseSeconds: 1,
    handler: async (m) => {
      calls.push({ at: Date.now(), receiveCount: m.receiveCount });
      if (calls.length < 3) throw new Error('downstream timeout');
    },
  });
  await send(q.url, { orderId: 'flaky' });
  const third = await until(() => calls.length >= 3, 12_000);
  assert.ok(
    third,
    `Expected 3 attempts within 12 s (failures retried after 1 s and then 2 s). The handler ran ${calls.length} time(s). Set the visibility of a failed message to the retry delay with ChangeMessageVisibility.`,
  );
  assert.deepEqual(calls.map((c) => c.receiveCount), [1, 2, 3], 'receiveCount should be 1, 2, 3 across the attempts.');
  const gap1 = calls[1].at - calls[0].at;
  const gap2 = calls[2].at - calls[1].at;
  assert.ok(gap1 >= 800, `The first retry came ${gap1} ms after the failure. With retryBaseSeconds 1 it should wait about 1 s.`);
  assert.ok(gap2 >= 1700, `The second retry came ${gap2} ms after the failure. The delay should double to about 2 s.`);
  const empty = await until(async () => (await messagesLeft(q.url)) === 0, 4000);
  assert.ok(empty, 'After the third attempt succeeded, the message should be deleted.');
});

test('dead-letter: a message that always fails is moved to the DLQ by the redrive policy', async () => {
  const mod = await load();
  const dlq = await createQueue();
  const q = await createQueue({
    VisibilityTimeout: '30',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 3 }),
  });
  const counts = [];
  start(mod, {
    sqs,
    queueUrl: q.url,
    waitTimeSeconds: 1,
    retryBaseSeconds: 1,
    maxRetryDelaySeconds: 1,
    handler: async (m) => {
      counts.push(m.receiveCount);
      throw new Error('cannot process');
    },
  });
  await send(q.url, { orderId: 'poison' });
  let dead;
  const moved = await until(async () => {
    const res = await sqs.send(new sdk.ReceiveMessageCommand({ QueueUrl: dlq.url, WaitTimeSeconds: 0 }));
    dead = res.Messages?.[0];
    return Boolean(dead);
  }, 15_000);
  assert.ok(
    moved,
    `The message did not reach the dead-letter queue within 15 s. The handler ran ${counts.length} time(s). Failed messages must not be deleted, and maxRetryDelaySeconds must cap the delay.`,
  );
  assert.deepEqual(JSON.parse(dead.Body), { orderId: 'poison' }, 'The DLQ should hold the original message.');
  assert.deepEqual(counts, [1, 2, 3], `With maxReceiveCount 3, the handler should run three times. Receive counts seen: ${JSON.stringify(counts)}.`);
});

test('heartbeat: a slow handler keeps its message hidden, so a second worker does not run it again', async () => {
  const mod = await load();
  const q = await createQueue({ VisibilityTimeout: '2' });
  let calls = 0;
  const handler = async () => {
    calls++;
    await sleep(5000);
  };
  const options = { sqs, queueUrl: q.url, waitTimeSeconds: 1, visibilityTimeoutSeconds: 2, retryBaseSeconds: 1, handler };
  start(mod, options);
  start(mod, options);
  await send(q.url, { report: 'slow' });
  const began = await until(() => calls >= 1, 4000);
  assert.ok(began, 'The handler was not called.');
  const done = await until(async () => (await messagesLeft(q.url)) === 0 && calls >= 1, 9000);
  await sleep(800);
  assert.equal(
    calls,
    1,
    `The handler takes 5 s and the visibility timeout is 2 s. It ran ${calls} times across two workers. Extend the visibility with ChangeMessageVisibility while the handler runs.`,
  );
  assert.ok(done, 'The slow message should be deleted once the handler finishes.');
});

test('graceful-stop: stop() ends an idle long poll quickly and waits for the message in progress', async () => {
  const mod = await load();
  const idleQueue = await createQueue();
  const idle = start(mod, { sqs, queueUrl: idleQueue.url, handler: async () => undefined });
  await sleep(500);
  const idleStop = await stopWithin(idle, 6000);
  assert.equal(idleStop.result, 'stopped', 'stop() did not resolve within 6 s on an idle worker.');
  assert.ok(
    idleStop.took < 2500,
    `stop() took ${idleStop.took} ms on an idle worker with the default 20 s long poll. Abort the pending ReceiveMessage (abortSignal).`,
  );

  const q = await createQueue();
  const finished = [];
  let started = 0;
  const worker = start(mod, {
    sqs,
    queueUrl: q.url,
    waitTimeSeconds: 1,
    handler: async (m) => {
      started++;
      await sleep(1500);
      finished.push(m.body?.id);
    },
  });
  await send(q.url, { id: 'in-progress' });
  const began = await until(() => started === 1, 4000);
  assert.ok(began, 'The handler was not called.');
  const busyStop = await stopWithin(worker, 6000);
  assert.equal(busyStop.result, 'stopped', 'stop() did not resolve within 6 s.');
  assert.deepEqual(finished, ['in-progress'], 'stop() resolved before the message in progress was finished.');
  assert.equal(await messagesLeft(q.url), 0, 'The message finished during stop() should be deleted before stop() resolves.');

  await send(q.url, { id: 'after-stop' });
  await sleep(2000);
  assert.equal(started, 1, 'After stop() resolved, the worker still received and handled a new message.');
});
