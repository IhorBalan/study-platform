// Tests for the SQS worker against the lab emulator. Run them with `npm test`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { startWorker, type ReceivedMessage, type Worker } from '../src/worker.ts';

const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
const prefix = `${process.env.AWS_RESOURCE_PREFIX ?? 'dev-'}worker-${randomUUID().slice(0, 8)}-`;
const queues: string[] = [];
const workers: Worker[] = [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

after(async () => {
  for (const worker of workers) await worker.stop();
  for (const url of queues) await sqs.send(new DeleteQueueCommand({ QueueUrl: url }));
  sqs.destroy();
});

async function createQueue(name: string, attributes: Record<string, string> = {}): Promise<{ url: string; arn: string }> {
  const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: prefix + name, Attributes: attributes }));
  queues.push(QueueUrl!);
  const res = await sqs.send(new GetQueueAttributesCommand({ QueueUrl, AttributeNames: ['QueueArn'] }));
  return { url: QueueUrl!, arn: res.Attributes!.QueueArn! };
}

async function messagesLeft(url: string): Promise<number> {
  const res = await sqs.send(
    new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'] }),
  );
  return Number(res.Attributes!.ApproximateNumberOfMessages) + Number(res.Attributes!.ApproximateNumberOfMessagesNotVisible);
}

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(50);
  }
}

function start(options: Parameters<typeof startWorker>[0]): Worker {
  const worker = startWorker({ waitTimeSeconds: 1, ...options });
  workers.push(worker);
  return worker;
}

test('a message is handled once with its parsed body and then deleted', async () => {
  const q = await createQueue('ok');
  const seen: ReceivedMessage[] = [];
  start({ sqs, queueUrl: q.url, handler: async (m) => void seen.push(m) });
  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: JSON.stringify({ orderId: 'o1' }) }));
  await until(() => seen.length === 1);
  assert.deepEqual(seen[0].body, { orderId: 'o1' });
  assert.equal(seen[0].receiveCount, 1);
  await until(async () => (await messagesLeft(q.url)) === 0);
  await sleep(300);
  assert.equal(seen.length, 1);
});

test('a failed message comes back after the retry delay, with a higher receive count', async () => {
  const q = await createQueue('retry', { VisibilityTimeout: '30' });
  const counts: number[] = [];
  start({
    sqs,
    queueUrl: q.url,
    retryBaseSeconds: 1,
    handler: async (m) => {
      counts.push(m.receiveCount);
      if (m.receiveCount < 2) throw new Error('flaky');
    },
  });
  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: '{"n":1}' }));
  await until(() => counts.length === 2);
  assert.deepEqual(counts, [1, 2]);
  await until(async () => (await messagesLeft(q.url)) === 0);
});

test('a message that always fails ends in the dead-letter queue', async () => {
  const dlq = await createQueue('dlq');
  const q = await createQueue('poison', {
    VisibilityTimeout: '30',
    RedrivePolicy: JSON.stringify({ deadLetterTargetArn: dlq.arn, maxReceiveCount: 2 }),
  });
  let calls = 0;
  start({
    sqs,
    queueUrl: q.url,
    retryBaseSeconds: 1,
    maxRetryDelaySeconds: 1,
    handler: async () => {
      calls++;
      throw new Error('always');
    },
  });
  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: '{"bad":true}' }));
  let dead: string | undefined;
  await until(async () => {
    const res = await sqs.send(new ReceiveMessageCommand({ QueueUrl: dlq.url, WaitTimeSeconds: 0 }));
    dead = res.Messages?.[0]?.Body;
    return dead !== undefined;
  });
  assert.equal(dead, '{"bad":true}');
  assert.equal(calls, 2);
});

test('stop() waits for the message in progress and then receives nothing more', async () => {
  const q = await createQueue('stop');
  const done: string[] = [];
  let started = false;
  const worker = start({
    sqs,
    queueUrl: q.url,
    handler: async (m) => {
      started = true;
      await sleep(500);
      done.push(String((m.body as { id: string }).id));
    },
  });
  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: '{"id":"first"}' }));
  await until(() => started);
  await worker.stop();
  assert.deepEqual(done, ['first']);
  assert.equal(await messagesLeft(q.url), 0);

  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: '{"id":"second"}' }));
  await sleep(1200);
  assert.deepEqual(done, ['first']);
});
