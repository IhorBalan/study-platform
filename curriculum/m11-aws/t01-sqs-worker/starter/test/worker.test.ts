// Tests for the SQS worker against the lab emulator. Run them with `npm test`.
// Every queue name starts with AWS_RESOURCE_PREFIX, and every queue is deleted in after().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { startWorker, type ReceivedMessage, type Worker } from '../src/worker.ts';

// The emulator returns queue URLs with "localhost" in them; this makes the SDK use AWS_ENDPOINT_URL.
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

async function until(condition: () => boolean | Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await sleep(50);
  }
}

test('a message reaches the handler with its parsed body', async () => {
  const q = await createQueue('ok');
  const seen: ReceivedMessage[] = [];
  // A short long poll keeps stop() fast in tests.
  const worker = startWorker({ sqs, queueUrl: q.url, waitTimeSeconds: 1, handler: async (m) => void seen.push(m) });
  workers.push(worker);
  await sqs.send(new SendMessageCommand({ QueueUrl: q.url, MessageBody: JSON.stringify({ orderId: 'o1' }) }));
  await until(() => seen.length === 1);
  assert.deepEqual(seen[0].body, { orderId: 'o1' });
});

// TODO: a handled message is deleted, and handled only once.
// TODO: a failed message comes back with receiveCount 2 (use retryBaseSeconds: 1).
// TODO: a message that always fails reaches a dead-letter queue (RedrivePolicy on the queue).
// TODO: stop() waits for the message in progress.
