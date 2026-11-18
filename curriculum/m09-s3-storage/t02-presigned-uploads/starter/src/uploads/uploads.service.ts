import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { S3_CLIENT, UPLOADS_BUCKET } from '../storage/storage.module.js';

@Injectable()
export class UploadsService {
  constructor(
    @Inject(S3_CLIENT) private readonly s3: S3Client,
    @Inject(UPLOADS_BUCKET) private readonly bucket: string,
  ) {}

  // TODO: change the parameter types once the controller validates its input.

  async createUpload(userId: string, request: unknown) {
    // TODO: generate a key in the user's namespace, remember it, and presign a PUT for it.
    throw new NotImplementedException();
  }

  async completeUpload(userId: string, request: unknown) {
    // TODO: check ownership, then check what actually arrived in the bucket.
    throw new NotImplementedException();
  }

  async downloadUrl(userId: string, key: unknown) {
    // TODO: a short-lived presigned GET for a completed upload the user owns.
    throw new NotImplementedException();
  }
}
