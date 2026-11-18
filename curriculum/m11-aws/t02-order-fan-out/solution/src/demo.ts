// Provisions the fan-out, publishes one event of each kind, shows what each queue received,
// then removes everything. Run with `npm run demo` against the emulator.
import { SNSClient } from '@aws-sdk/client-sns';
import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { destroyOrderEvents, provisionOrderEvents, publishOrderEvent, type OrderEvent } from './order-events.ts';

const sns = new SNSClient({});
const sqs = new SQSClient({ useQueueUrlAsEndpoint: false });
const prefix = `${process.env.AWS_RESOURCE_PREFIX ?? 'dev-'}demo-`;

const infra = await provisionOrderEvents({ sns, sqs }, prefix);
try {
  const events: OrderEvent[] = [
    { type: 'order.placed', orderId: 'o1', country: 'DE', totalCents: 4_200 },
    { type: 'order.paid', orderId: 'o1', country: 'DE', totalCents: 4_200 },
    { type: 'order.paid', orderId: 'o2', country: 'US', totalCents: 250_000 },
    { type: 'order.cancelled', orderId: 'o3', country: 'FR', totalCents: 9_900 },
  ];
  for (const event of events) await publishOrderEvent(sns, infra.topicArn, event);

  for (const [name, queue] of Object.entries(infra.queues)) {
    const res = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queue.url, MaxNumberOfMessages: 10, WaitTimeSeconds: 2 }));
    console.log(name, (res.Messages ?? []).map((m) => m.Body));
    for (const m of res.Messages ?? []) await sqs.send(new DeleteMessageCommand({ QueueUrl: queue.url, ReceiptHandle: m.ReceiptHandle }));
  }
} finally {
  await destroyOrderEvents({ sns, sqs }, prefix);
}
