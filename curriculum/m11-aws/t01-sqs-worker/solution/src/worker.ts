import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  type Message,
  type SQSClient,
} from '@aws-sdk/client-sqs';

/** The worker only ever calls `send`, so tests can pass a recording wrapper. */
export type SqsSender = Pick<SQSClient, 'send'>;

export interface ReceivedMessage {
  messageId: string;
  /** The message body, parsed as JSON. */
  body: unknown;
  /** How many times SQS has handed out this message, including this time. */
  receiveCount: number;
}

export type MessageHandler = (message: ReceivedMessage) => Promise<void>;

export interface WorkerOptions {
  sqs: SqsSender;
  queueUrl: string;
  handler: MessageHandler;
  /** Long-poll wait per ReceiveMessage call. Default 20. */
  waitTimeSeconds?: number;
  /** Messages per ReceiveMessage call, 1 to 10. Default 10. */
  maxMessages?: number;
  /** The queue's visibility timeout. The heartbeat extends by this much every half of it. Default 30. */
  visibilityTimeoutSeconds?: number;
  /** First retry delay after a failure; doubles with each receive. Default 5. */
  retryBaseSeconds?: number;
  /** Upper bound for the retry delay. Default 900. */
  maxRetryDelaySeconds?: number;
}

export interface Worker {
  /** Stops receiving, waits for messages in progress, then resolves. */
  stop(): Promise<void>;
}

export function retryDelaySeconds(receiveCount: number, baseSeconds: number, maxSeconds: number): number {
  const delay = baseSeconds * 2 ** Math.max(0, receiveCount - 1);
  return Math.min(Math.round(delay), maxSeconds);
}

export function startWorker(options: WorkerOptions): Worker {
  const {
    sqs,
    queueUrl,
    handler,
    waitTimeSeconds = 20,
    maxMessages = 10,
    visibilityTimeoutSeconds = 30,
    retryBaseSeconds = 5,
    maxRetryDelaySeconds = 900,
  } = options;

  const abort = new AbortController();
  let stopping = false;

  async function processOne(message: Message): Promise<void> {
    const receiptHandle = message.ReceiptHandle!;
    const receiveCount = Number(message.Attributes?.ApproximateReceiveCount ?? '1');

    // Heartbeat: keep the message hidden while the handler runs, however long it takes.
    const heartbeat = setInterval(() => {
      sqs
        .send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: visibilityTimeoutSeconds }))
        .catch((error: unknown) => console.warn('heartbeat failed', message.MessageId, error));
    }, (visibilityTimeoutSeconds * 1000) / 2);

    try {
      const body: unknown = JSON.parse(message.Body ?? '');
      await handler({ messageId: message.MessageId!, body, receiveCount });
    } catch (error) {
      clearInterval(heartbeat);
      // Not deleted: SQS hands it out again after the backoff delay, and the
      // queue's redrive policy moves it to the DLQ after maxReceiveCount receives.
      console.warn('message failed, it will be retried', message.MessageId, receiveCount, error);
      const delay = retryDelaySeconds(receiveCount, retryBaseSeconds, maxRetryDelaySeconds);
      await sqs
        .send(new ChangeMessageVisibilityCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle, VisibilityTimeout: delay }))
        .catch((e: unknown) => console.warn('could not set retry delay', message.MessageId, e));
      return;
    }
    clearInterval(heartbeat);

    try {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
    } catch (error) {
      // The work is done but the message will come back: the handler must be idempotent.
      console.error('delete failed, the message will be delivered again', message.MessageId, error);
    }
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      let messages: Message[];
      try {
        const res = await sqs.send(
          new ReceiveMessageCommand({
            QueueUrl: queueUrl,
            MaxNumberOfMessages: maxMessages,
            WaitTimeSeconds: waitTimeSeconds,
            MessageSystemAttributeNames: ['ApproximateReceiveCount'],
          }),
          { abortSignal: abort.signal },
        );
        messages = res.Messages ?? [];
      } catch (error) {
        if (stopping) break;
        console.error('receive failed, retrying in 1 s', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      await Promise.all(messages.map(processOne));
    }
  }

  const running = loop();

  return {
    async stop() {
      stopping = true;
      abort.abort();
      await running;
    },
  };
}
