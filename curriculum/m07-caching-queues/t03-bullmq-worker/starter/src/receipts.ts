// Receipt emails as BullMQ jobs. This first version sends the email and hopes
// for the best. Keep the exported names and types; read the brief for the rules.
import { Queue, Worker, type Job } from 'bullmq';

export const QUEUE_NAME = 'receipts';

export interface ReceiptData {
  orderId: string;
  email: string;
  amountCents: number;
}

export interface ReceiptMessage {
  to: string;
  subject: string;
  text: string;
  /** The provider drops a second message with the same key. */
  idempotencyKey: string;
}

export interface Mailer {
  /** Rejects on failure. An error with `retryable: false` will never succeed. */
  send(message: ReceiptMessage): Promise<void>;
}

export interface ReceiptsOptions {
  redisUrl: string;
  /** Every key starts with this. BullMQ's own prefix is `${prefix}bull`. */
  prefix: string;
  /** Base delay of the exponential backoff. Default 1000. */
  backoffDelayMs?: number;
}

export interface WorkerOptions extends ReceiptsOptions {
  mailer: Mailer;
  concurrency?: number;
}

export interface ReceiptWorker {
  worker: Worker<ReceiptData>;
  /** Stops taking new jobs, waits for running ones, then closes connections. */
  close(): Promise<void>;
}

export function createReceiptQueue(options: ReceiptsOptions): Queue<ReceiptData> {
  // TODO: attempts, backoff, and how long to keep finished and failed jobs.
  return new Queue<ReceiptData>(QUEUE_NAME, { connection: { url: options.redisUrl }, prefix: `${options.prefix}bull` });
}

export async function enqueueReceipt(
  queue: Queue<ReceiptData>,
  data: ReceiptData,
  options: { sendAt?: Date } = {},
): Promise<Job<ReceiptData>> {
  // TODO: one job per order, and sendAt.
  void options;
  return queue.add('receipt', data);
}

export function startReceiptWorker(options: WorkerOptions): ReceiptWorker {
  const { mailer } = options;

  async function handle(job: Job<ReceiptData>): Promise<string> {
    const { orderId, email, amountCents } = job.data;
    // TODO: the same order may arrive more than once. Send one email.
    // TODO: an error with retryable: false must not be retried.
    await mailer.send({
      to: email,
      subject: `Your receipt for order ${orderId}`,
      text: `We received ${(amountCents / 100).toFixed(2)}. Thank you.`,
      idempotencyKey: `receipt-${orderId}`,
    });
    return 'sent';
  }

  // TODO: concurrency, and what happens to an 'error' event nobody listens to.
  const worker = new Worker<ReceiptData>(QUEUE_NAME, handle, { connection: { url: options.redisUrl }, prefix: `${options.prefix}bull` });

  return {
    worker,
    async close() {
      // TODO: shut down gracefully.
      await worker.close(true);
    },
  };
}
