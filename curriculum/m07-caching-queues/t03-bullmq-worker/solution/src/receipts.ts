// Receipt emails as BullMQ jobs: retries with exponential backoff, permanent
// failures that stop retrying, an idempotent handler, and a graceful shutdown.
import { Queue, UnrecoverableError, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

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

const SENT_TTL_SECONDS = 30 * 24 * 3600;
const CLAIM_TTL_MS = 60_000;

export function createReceiptQueue(options: ReceiptsOptions): Queue<ReceiptData> {
  return new Queue<ReceiptData>(QUEUE_NAME, {
    connection: { url: options.redisUrl },
    prefix: `${options.prefix}bull`,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: options.backoffDelayMs ?? 1000 },
      // Keep finished jobs for a day so they can be inspected, and so the
      // jobId still deduplicates a second enqueue during that time.
      removeOnComplete: { age: 24 * 3600 },
      // Failed jobs are the dead-letter list: keep them until someone looks.
      removeOnFail: false,
    },
  });
}

export async function enqueueReceipt(
  queue: Queue<ReceiptData>,
  data: ReceiptData,
  options: { sendAt?: Date } = {},
): Promise<Job<ReceiptData>> {
  const delay = options.sendAt ? Math.max(0, options.sendAt.getTime() - Date.now()) : 0;
  // One job per order: adding the same jobId again is a no-op.
  return queue.add('receipt', data, { jobId: `receipt-${data.orderId}`, delay });
}

export function startReceiptWorker(options: WorkerOptions): ReceiptWorker {
  const { prefix, mailer } = options;
  const redis = new Redis(options.redisUrl);

  async function handle(job: Job<ReceiptData>): Promise<string> {
    const { orderId, email, amountCents } = job.data;
    const sentKey = `${prefix}receipt-sent:${orderId}`;
    const claimKey = `${prefix}receipt-claim:${orderId}`;

    // The queue delivers at least once, and the same order can arrive in two jobs.
    if (await redis.exists(sentKey)) return 'already-sent';

    // Only one worker sends for an order at a time. The claim expires, so a
    // crashed worker cannot block the order forever.
    const claimed = await redis.set(claimKey, job.id ?? 'job', 'PX', CLAIM_TTL_MS, 'NX');
    if (claimed !== 'OK') throw new Error(`receipt for ${orderId} is being sent by another job`);

    try {
      await mailer.send({
        to: email,
        subject: `Your receipt for order ${orderId}`,
        text: `We received ${(amountCents / 100).toFixed(2)}. Thank you.`,
        // If we crash after sending and before recording it, the retry sends
        // again; the provider drops it because the key is the same.
        idempotencyKey: `receipt-${orderId}`,
      });
      await redis.set(sentKey, '1', 'EX', SENT_TTL_SECONDS);
      return 'sent';
    } catch (error) {
      if ((error as { retryable?: boolean }).retryable === false) {
        throw new UnrecoverableError((error as Error).message);
      }
      throw error;
    } finally {
      await redis.del(claimKey);
    }
  }

  const worker = new Worker<ReceiptData>(QUEUE_NAME, handle, {
    connection: { url: options.redisUrl },
    prefix: `${prefix}bull`,
    concurrency: options.concurrency ?? 5,
  });
  // Without a listener, an 'error' event would crash the process.
  worker.on('error', (error) => console.error('receipt worker error', error));

  return {
    worker,
    async close() {
      await worker.close();
      await redis.quit();
    },
  };
}
