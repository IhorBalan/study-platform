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
      // requestChecksumCalculation: since early 2025 the SDK adds a CRC32 checksum to every
      // upload it can. When presigning, it can only checksum the empty body it has, and S3
      // then rejects the browser's real upload. WHEN_REQUIRED leaves the checksum out.
      useFactory: () => new S3Client({ forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED' }),
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
