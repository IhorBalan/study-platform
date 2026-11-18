// A small storage module over S3. The rest of the app talks to this, never to the SDK,
// so a missing object is one typed error and pagination is one shape everywhere.
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
/** DeleteObjects accepts at most this many keys per request. */
const DELETE_BATCH = 1000;

export class ObjectNotFoundError extends Error {
  readonly key: string;

  constructor(key: string, options?: { cause?: unknown }) {
    super(`No object with key "${key}"`, options);
    this.name = 'ObjectNotFoundError';
    this.key = key;
  }
}

export interface ObjectInfo {
  key: string;
  size: number;
  etag: string;
  lastModified: Date;
}

export interface ObjectHead extends ObjectInfo {
  contentType: string | undefined;
  metadata: Record<string, string>;
}

export interface PutOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ListOptions {
  prefix?: string;
  pageSize?: number;
  cursor?: string;
}

export interface ListPage {
  items: ObjectInfo[];
  nextCursor: string | null;
}

export interface ObjectStore {
  put(key: string, body: string | Uint8Array, options?: PutOptions): Promise<{ etag: string }>;
  head(key: string): Promise<ObjectHead>;
  getStream(key: string): Promise<{ body: Readable; size: number; contentType: string | undefined }>;
  list(options?: ListOptions): Promise<ListPage>;
  listAll(options?: Omit<ListOptions, 'cursor'>): AsyncGenerator<ObjectInfo>;
  delete(key: string): Promise<void>;
  deleteMany(keys: string[]): Promise<void>;
}

/**
 * A client configured from the environment. The SDK reads AWS_REGION, AWS_ENDPOINT_URL and the
 * credentials by itself. Path-style addressing (http://host/bucket/key) is what emulators and
 * most S3-compatible stores expect; AWS itself accepts both.
 */
export function createS3Client(): S3Client {
  return new S3Client({ forcePathStyle: true });
}

/** GetObject says NoSuchKey. HeadObject has no body, so it can only say NotFound with a 404. */
function isMissingKey(error: unknown, viaHead: boolean): boolean {
  if (!(error instanceof S3ServiceException)) return false;
  if (error.name === 'NoSuchKey') return true;
  return viaHead && error.name === 'NotFound' && error.$metadata.httpStatusCode === 404;
}

export function createObjectStore(options: { client: S3Client; bucket: string }): ObjectStore {
  const { client, bucket } = options;

  async function* listAll(opts: Omit<ListOptions, 'cursor'> = {}): AsyncGenerator<ObjectInfo> {
    let cursor: string | undefined;
    do {
      const page = await list({ ...opts, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async function list(opts: ListOptions = {}): Promise<ListPage> {
    const res = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: opts.prefix,
        MaxKeys: opts.pageSize,
        ContinuationToken: opts.cursor,
      }),
    );
    const items = (res.Contents ?? []).map((o) => ({
      key: o.Key ?? '',
      size: o.Size ?? 0,
      etag: o.ETag ?? '',
      lastModified: o.LastModified ?? new Date(0),
    }));
    return { items, nextCursor: res.IsTruncated ? (res.NextContinuationToken ?? null) : null };
  }

  return {
    async put(key, body, opts = {}) {
      const res = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: opts.contentType ?? DEFAULT_CONTENT_TYPE,
          Metadata: opts.metadata,
        }),
      );
      return { etag: res.ETag ?? '' };
    },

    async head(key) {
      try {
        const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          key,
          size: res.ContentLength ?? 0,
          etag: res.ETag ?? '',
          lastModified: res.LastModified ?? new Date(0),
          contentType: res.ContentType,
          metadata: res.Metadata ?? {},
        };
      } catch (error) {
        if (isMissingKey(error, true)) throw new ObjectNotFoundError(key, { cause: error });
        throw error;
      }
    },

    async getStream(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        // In Node the body is an http.IncomingMessage, which is a Readable. The caller must
        // consume or destroy it, or the socket stays checked out of the connection pool.
        if (!(res.Body instanceof Readable)) throw new Error('Expected a Node.js stream body');
        return { body: res.Body, size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (error) {
        if (isMissingKey(error, false)) throw new ObjectNotFoundError(key, { cause: error });
        throw error;
      }
    },

    list,
    listAll,

    async delete(key) {
      // S3 answers 204 whether or not the key existed, so delete is idempotent already.
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async deleteMany(keys) {
      for (let i = 0; i < keys.length; i += DELETE_BATCH) {
        const chunk = keys.slice(i, i + DELETE_BATCH);
        const res = await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        // A 200 response can still carry per-key failures.
        if (res.Errors && res.Errors.length > 0) {
          const first = res.Errors[0];
          throw new Error(`Could not delete ${res.Errors.length} object(s), first: ${first?.Key} (${first?.Code})`);
        }
      }
    },
  };
}
