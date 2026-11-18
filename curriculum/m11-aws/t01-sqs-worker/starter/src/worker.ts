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

export function startWorker(options: WorkerOptions): Worker {
  const { sqs, queueUrl, handler, waitTimeSeconds = 20, maxMessages = 10 } = options;
  let stopping = false;

  async function processOne(message: Message): Promise<void> {
    // TODO: parse the body, call the handler with messageId, body and receiveCount.
    // TODO: while the handler runs, extend the message's visibility (heartbeat).
    // TODO: delete after success; after a failure, set the retry delay and leave the message.
    void message;
    void handler;
  }

  async function loop(): Promise<void> {
    while (!stopping) {
      // TODO: long-poll, ask for ApproximateReceiveCount, and make the call abortable.
      const res = await sqs.send(new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: maxMessages, WaitTimeSeconds: waitTimeSeconds }));
      await Promise.all((res.Messages ?? []).map(processOne));
    }
  }

  const running = loop();

  return {
    async stop() {
      // TODO: stop receiving, end the pending long poll at once, and wait for messages in progress.
      stopping = true;
      await running;
    },
  };
}
