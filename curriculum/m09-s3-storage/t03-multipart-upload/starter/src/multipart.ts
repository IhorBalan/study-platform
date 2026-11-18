// Multipart upload with the low-level commands, so every step is visible:
// create, upload parts (a few at a time), complete, and abort when anything fails.
import { S3Client } from '@aws-sdk/client-s3';

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

export async function uploadLarge(options: UploadLargeOptions): Promise<UploadLargeResult> {
  // TODO:
  // 1. Validate partSize and concurrency.
  // 2. CreateMultipartUpload.
  // 3. Regroup the body's chunks into parts of exactly partSize bytes (the last may be shorter)
  //    and UploadPart them, at most `concurrency` at a time, reading ahead no further than needed.
  // 4. CompleteMultipartUpload with every part's number and ETag, in order.
  // 5. If anything fails, AbortMultipartUpload and rethrow the original error.
  throw new Error('TODO: uploadLarge');
}
