import {
  CreateTopicCommand,
  DeleteTopicCommand,
  ListSubscriptionsByTopicCommand,
  PublishCommand,
  SubscribeCommand,
  UnsubscribeCommand,
  type SNSClient,
} from '@aws-sdk/client-sns';
import {
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SetQueueAttributesCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs';

export type OrderEventType = 'order.placed' | 'order.paid' | 'order.cancelled';

export interface OrderEvent {
  type: OrderEventType;
  orderId: string;
  country: string;
  totalCents: number;
}

export interface Clients {
  sns: Pick<SNSClient, 'send'>;
  sqs: Pick<SQSClient, 'send'>;
}

export interface QueueRef {
  url: string;
  arn: string;
}

export type ConsumerName = 'analytics' | 'email' | 'fraud';

export interface OrderEventsInfra {
  topicArn: string;
  queues: Record<ConsumerName, QueueRef>;
}

/** Fraud review looks at paid orders from 1,000.00 up. */
export const FRAUD_THRESHOLD_CENTS = 100_000;

/**
 * Who gets what. Filters match message attributes, which publishOrderEvent always sets.
 * No filter means every event.
 */
const FILTERS: Record<ConsumerName, Record<string, unknown> | undefined> = {
  analytics: undefined,
  email: { type: ['order.paid', 'order.cancelled'] },
  fraud: { type: ['order.paid'], totalCents: [{ numeric: ['>=', FRAUD_THRESHOLD_CENTS] }] },
};

const CONSUMERS = Object.keys(FILTERS) as ConsumerName[];

const topicName = (prefix: string) => `${prefix}order-events`;
const queueName = (prefix: string, consumer: ConsumerName) => `${prefix}${consumer}`;

/** Only this topic may send to the queue. */
function queuePolicy(queueArn: string, topicArn: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'AllowOrderEventsTopic',
        Effect: 'Allow',
        Principal: { Service: 'sns.amazonaws.com' },
        Action: 'sqs:SendMessage',
        Resource: queueArn,
        Condition: { ArnEquals: { 'aws:SourceArn': topicArn } },
      },
    ],
  });
}

/**
 * Creates the topic, one queue per consumer, the queue policies and the filtered subscriptions.
 * Every call is idempotent: running it again returns the same resources and adds nothing.
 */
export async function provisionOrderEvents({ sns, sqs }: Clients, prefix: string): Promise<OrderEventsInfra> {
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: topicName(prefix) }));
  const topicArn = TopicArn!;

  const queues = {} as Record<ConsumerName, QueueRef>;
  for (const consumer of CONSUMERS) {
    const { QueueUrl } = await sqs.send(new CreateQueueCommand({ QueueName: queueName(prefix, consumer) }));
    const url = QueueUrl!;
    const attrs = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: url, AttributeNames: ['QueueArn'] }));
    const arn = attrs.Attributes!.QueueArn!;
    // Without this policy, real SNS silently fails to deliver. The emulator does not check it.
    await sqs.send(new SetQueueAttributesCommand({ QueueUrl: url, Attributes: { Policy: queuePolicy(arn, topicArn) } }));
    queues[consumer] = { url, arn };
  }

  const existing = await listSubscriptions(sns, topicArn);
  for (const consumer of CONSUMERS) {
    if (existing.some((s) => s.Endpoint === queues[consumer].arn)) continue;
    const filter = FILTERS[consumer];
    await sns.send(
      new SubscribeCommand({
        TopicArn: topicArn,
        Protocol: 'sqs',
        Endpoint: queues[consumer].arn,
        ReturnSubscriptionArn: true,
        Attributes: {
          RawMessageDelivery: 'true',
          ...(filter ? { FilterPolicy: JSON.stringify(filter), FilterPolicyScope: 'MessageAttributes' } : {}),
        },
      }),
    );
  }

  return { topicArn, queues };
}

export async function publishOrderEvent(sns: Pick<SNSClient, 'send'>, topicArn: string, event: OrderEvent): Promise<void> {
  await sns.send(
    new PublishCommand({
      TopicArn: topicArn,
      Message: JSON.stringify(event),
      // The filter policies match these attributes, so they must always be set.
      MessageAttributes: {
        type: { DataType: 'String', StringValue: event.type },
        totalCents: { DataType: 'Number', StringValue: String(event.totalCents) },
      },
    }),
  );
}

/** Removes the subscriptions, the topic and the queues. Safe to call when some are already gone. */
export async function destroyOrderEvents({ sns, sqs }: Clients, prefix: string): Promise<void> {
  // CreateTopic returns the existing topic's ARN, which is the simplest way to find it by name.
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: topicName(prefix) }));
  for (const sub of await listSubscriptions(sns, TopicArn!)) {
    if (sub.SubscriptionArn?.startsWith('arn:')) await sns.send(new UnsubscribeCommand({ SubscriptionArn: sub.SubscriptionArn }));
  }
  await sns.send(new DeleteTopicCommand({ TopicArn }));

  for (const consumer of CONSUMERS) {
    try {
      const { QueueUrl } = await sqs.send(new GetQueueUrlCommand({ QueueName: queueName(prefix, consumer) }));
      await sqs.send(new DeleteQueueCommand({ QueueUrl }));
    } catch (error) {
      if ((error as Error).name !== 'QueueDoesNotExist' && (error as Error).name !== 'AWS.SimpleQueueService.NonExistentQueue') throw error;
    }
  }
}

async function listSubscriptions(sns: Pick<SNSClient, 'send'>, topicArn: string) {
  const all = [];
  let NextToken: string | undefined;
  do {
    const page = await sns.send(new ListSubscriptionsByTopicCommand({ TopicArn: topicArn, NextToken }));
    all.push(...(page.Subscriptions ?? []));
    NextToken = page.NextToken;
  } while (NextToken);
  return all;
}
