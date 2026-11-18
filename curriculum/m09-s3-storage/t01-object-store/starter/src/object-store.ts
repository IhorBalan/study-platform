// A small storage module over S3. The rest of the app talks to this, never to the SDK,
// so a missing object is one typed error and pagination is one shape everywhere.
import type { Readable } from 'node:stream';
import { S3Client } from '@aws-sdk/client-s3';

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

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

/** A client configured from the environment, ready for the lab emulator. */
export function createS3Client(): S3Client {
  // TODO: the SDK reads the region, endpoint and credentials from the environment by itself.
  // What else does it need to talk to the emulator?
  throw new Error('TODO: createS3Client');
}

export function createObjectStore(options: { client: S3Client; bucket: string }): ObjectStore {
  const { client, bucket } = options;
  void client;
  void bucket;

  return {
    async put(key, body, opts = {}) {
      // TODO: PutObject with the content type (default DEFAULT_CONTENT_TYPE) and metadata.
      throw new Error('TODO: put');
    },

    async head(key) {
      // TODO: HeadObject. A missing key becomes ObjectNotFoundError.
      throw new Error('TODO: head');
    },

    async getStream(key) {
      // TODO: GetObject, returning the body as a Node.js Readable without buffering it.
      throw new Error('TODO: getStream');
    },

    async list(opts = {}) {
      // TODO: one page of ListObjectsV2.
      throw new Error('TODO: list');
    },

    async *listAll(opts = {}) {
      // TODO: every object under the prefix, one page at a time.
      throw new Error('TODO: listAll');
    },

    async delete(key) {
      // TODO
      throw new Error('TODO: delete');
    },

    async deleteMany(keys) {
      // TODO: DeleteObjects takes at most 1000 keys per request.
      throw new Error('TODO: deleteMany');
    },
  };
}
