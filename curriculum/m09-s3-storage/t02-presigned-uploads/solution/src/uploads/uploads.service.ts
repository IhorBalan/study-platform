import { randomUUID } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { S3_CLIENT, UPLOADS_BUCKET } from '../storage/storage.module.js';
import { FILE_TYPES, startsWith } from './file-types.js';

const UPLOAD_URL_SECONDS = 300;
const DOWNLOAD_URL_SECONDS = 60;

interface UploadRecord {
  userId: string;
  key: string;
  contentType: string;
  size: number;
  status: 'pending' | 'ready' | 'rejected';
}

@Injectable()
export class UploadsService {
  /** Stands in for a `files` table. */
  private readonly records = new Map<string, UploadRecord>();

  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(UPLOADS_BUCKET) private readonly bucket: string,
  ) {}

  async createUpload(userId: string, contentType: string, size: number) {
    const type = FILE_TYPES[contentType];
    if (!type) throw new Error(`Unexpected content type ${contentType}`);
    // The server picks the key. Nothing from the client (file name, path) ends up in it.
    const key = `${namespace(userId)}${randomUUID()}.${type.extension}`;
    this.records.set(key, { userId, key, contentType, size, status: 'pending' });

    const uploadUrl = await getSignedUrl(
      this.s3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType, ContentLength: size }),
      {
        expiresIn: UPLOAD_URL_SECONDS,
        // Without this the SDK leaves content-type out of the signature, and the client could
        // upload any type to this URL. content-length is signed because ContentLength is set.
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );
    return {
      key,
      uploadUrl,
      method: 'PUT',
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + UPLOAD_URL_SECONDS * 1000).toISOString(),
    };
  }

  async completeUpload(userId: string, key: string) {
    const record = this.ownedRecord(userId, key);
    if (record.status === 'ready') return view(record);
    if (record.status === 'rejected') throw new NotFoundException('That upload was rejected');

    let head;
    try {
      head = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (error) {
      if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
        throw new NotFoundException('Nothing has been uploaded for that key yet');
      }
      throw error;
    }

    // The emulator does not enforce the signature, and older clients may not either. Check what
    // actually arrived instead of trusting what the client declared.
    if (head.ContentLength !== record.size) {
      return this.reject(record, `Expected ${record.size} bytes, received ${head.ContentLength}`);
    }
    if (head.ContentType !== record.contentType) {
      return this.reject(record, `Expected ${record.contentType}, received ${head.ContentType}`);
    }
    const signature = FILE_TYPES[record.contentType]!.signature;
    const first = await this.s3.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${signature.length - 1}` }),
    );
    const bytes = first.Body ? await first.Body.transformToByteArray() : new Uint8Array();
    if (!startsWith(bytes, signature)) {
      return this.reject(record, `The file content is not ${record.contentType}`);
    }

    // A malware scan would run here, or on an S3 event, before the file is marked ready.
    record.status = 'ready';
    return view(record);
  }

  async downloadUrl(userId: string, key: string) {
    const record = this.ownedRecord(userId, key);
    if (record.status !== 'ready') throw new NotFoundException('No finished upload with that key');
    const url = await getSignedUrl(
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentDisposition: 'attachment' }),
      { expiresIn: DOWNLOAD_URL_SECONDS },
    );
    return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_SECONDS * 1000).toISOString() };
  }

  /** 403 for a key outside the caller's namespace, 404 for one we never issued to them. */
  private ownedRecord(userId: string, key: string): UploadRecord {
    if (!key.startsWith(namespace(userId))) throw new ForbiddenException('That key belongs to someone else');
    const record = this.records.get(key);
    if (!record || record.userId !== userId) throw new NotFoundException('Unknown upload');
    return record;
  }

  private async reject(record: UploadRecord, reason: string): Promise<never> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: record.key }));
    record.status = 'rejected';
    throw new UnprocessableEntityException(reason);
  }
}

function namespace(userId: string): string {
  return `users/${userId}/`;
}

function view(record: UploadRecord) {
  return { key: record.key, size: record.size, contentType: record.contentType };
}
