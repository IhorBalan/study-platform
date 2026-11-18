// Multipart upload with the low-level commands, so every step is visible:
// create, upload parts (a few at a time), complete, and abort when anything fails.
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';

/** S3 rejects a part under 5 MiB unless it is the last one. */
export const MIN_PART_SIZE = 5 * 1024 * 1024;
export const DEFAULT_PART_SIZE = 8 * 1024 * 1024;
export const DEFAULT_CONCURRENCY = 4;

export interface UploadLargeOptions {
  client: S3Client;
  bucket: string;
  key: string;
  body: AsyncIterable<Uint8Array>;
  partSize?: number;
  concurrency?: number;
  contentType?: string;
}

export interface UploadLargeResult {
  etag: string;
  parts: number;
  size: number;
}

/** Regroups chunks of any size into parts of exactly `partSize` bytes; the last may be shorter. */
async function* toParts(body: AsyncIterable<Uint8Array>, partSize: number): AsyncGenerator<Buffer> {
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  for await (const chunk of body) {
    let rest = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    while (pendingBytes + rest.length >= partSize) {
      const take = partSize - pendingBytes;
      pending.push(rest.subarray(0, take));
      yield Buffer.concat(pending, partSize);
      rest = rest.subarray(take);
      pending = [];
      pendingBytes = 0;
    }
    if (rest.length > 0) {
      // Copy: the producer may reuse its buffer for the next chunk.
      pending.push(Buffer.from(rest));
      pendingBytes += rest.length;
    }
  }
  if (pendingBytes > 0) yield Buffer.concat(pending, pendingBytes);
}

export async function uploadLarge(options: UploadLargeOptions): Promise<UploadLargeResult> {
  const { client, bucket, key, body } = options;
  const partSize = options.partSize ?? DEFAULT_PART_SIZE;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isInteger(partSize) || partSize < MIN_PART_SIZE) {
    throw new RangeError(`partSize must be an integer of at least ${MIN_PART_SIZE} bytes`);
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }

  const created = await client.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: options.contentType }),
  );
  const uploadId = created.UploadId;
  if (!uploadId) throw new Error('CreateMultipartUpload returned no UploadId');

  const completed: { PartNumber: number; ETag: string }[] = [];
  const inFlight = new Set<Promise<void>>();
  let failure: { error: unknown } | undefined;
  let partNumber = 0;
  let size = 0;

  // A function, so TypeScript does not assume `failure` is still undefined after an await.
  const rethrowPartFailure = () => {
    if (failure) throw failure.error;
  };

  const launch = (bytes: Buffer, number: number) => {
    const task: Promise<void> = client
      .send(new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: number, Body: bytes }))
      .then(
        (res) => {
          if (!res.ETag) throw new Error(`Part ${number} returned no ETag`);
          completed.push({ PartNumber: number, ETag: res.ETag });
        },
        // Remember the first failure; the loop below notices it before reading more input.
        (error: unknown) => {
          failure ??= { error };
        },
      )
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  try {
    for await (const part of toParts(body, partSize)) {
      rethrowPartFailure();
      // Back-pressure: do not read the next part from the source until a slot is free.
      while (inFlight.size >= concurrency) await Promise.race(inFlight);
      rethrowPartFailure();
      partNumber += 1;
      size += part.length;
      launch(part, partNumber);
    }
    // S3 needs at least one part, which may be empty when it is the only one.
    if (partNumber === 0) {
      partNumber = 1;
      launch(Buffer.alloc(0), 1);
    }
    await Promise.all(inFlight);
    rethrowPartFailure();

    const done = await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        // Parts finish in any order, but Complete needs them in ascending order.
        MultipartUpload: { Parts: completed.sort((a, b) => a.PartNumber - b.PartNumber) },
      }),
    );
    return { etag: done.ETag ?? '', parts: partNumber, size };
  } catch (error) {
    // Let running parts finish first, or a part could land after the abort and be stored again.
    await Promise.allSettled(inFlight);
    try {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    } catch {
      // The lifecycle rule for incomplete uploads is the safety net if this fails too.
    }
    throw error;
  }
}
