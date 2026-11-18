import { CreateTopicCommand, PublishCommand, type SNSClient } from '@aws-sdk/client-sns';
import { type SQSClient } from '@aws-sdk/client-sqs';

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
 * Creates the topic, one queue per consumer, the queue policies and the subscriptions.
 * Must be safe to run again: a second call returns the same resources and adds nothing.
 */
export async function provisionOrderEvents({ sns, sqs }: Clients, prefix: string): Promise<OrderEventsInfra> {
  const { TopicArn } = await sns.send(new CreateTopicCommand({ Name: `${prefix}order-events` }));

  // TODO: create the queues <prefix>analytics, <prefix>email and <prefix>fraud.
  // TODO: give each queue a policy that lets only this topic send to it.
  // TODO: subscribe each queue with raw message delivery and its filter policy.
  void sqs;
  throw new Error(`TODO: finish provisioning for topic ${TopicArn}`);
}

export async function publishOrderEvent(sns: Pick<SNSClient, 'send'>, topicArn: string, event: OrderEvent): Promise<void> {
  // TODO: whatever your filter policies match on must be set here.
  await sns.send(new PublishCommand({ TopicArn: topicArn, Message: JSON.stringify(event) }));
}

/** Removes the subscriptions, the topic and the queues. Safe to call when some are already gone. */
export async function destroyOrderEvents({ sns, sqs }: Clients, prefix: string): Promise<void> {
  // TODO
  void sns;
  void sqs;
  throw new Error(`TODO: remove the resources under ${prefix}`);
}
