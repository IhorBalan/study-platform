import { Global, Module } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';

export const S3_CLIENT = Symbol('S3_CLIENT');
export const UPLOADS_BUCKET = Symbol('UPLOADS_BUCKET');

@Global()
@Module({
  providers: [
    {
      provide: S3_CLIENT,
      // Region, endpoint and credentials come from the environment.
      // TODO: read the lesson on presigned URLs. One more option is needed before this client
      // can presign PUT URLs that real S3 accepts.
      useFactory: () => new S3Client({ forcePathStyle: true }),
    },
    {
      provide: UPLOADS_BUCKET,
      useFactory: () => {
        const bucket = process.env.UPLOADS_BUCKET;
        if (!bucket) throw new Error('UPLOADS_BUCKET is not set');
        return bucket;
      },
    },
  ],
  exports: [S3_CLIENT, UPLOADS_BUCKET],
})
export class StorageModule {}
