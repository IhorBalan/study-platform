// Lifecycle rules that keep the bucket from filling up with things nobody will ever read.
import { PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';

export async function applyHousekeeping(client: S3Client, bucket: string): Promise<void> {
  // This call replaces the bucket's whole lifecycle configuration, so every rule goes in at once.
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: bucket,
      LifecycleConfiguration: {
        Rules: [
          {
            // Parts of an upload that was never completed or aborted are billed like any object,
            // yet do not show up in a normal listing.
            ID: 'abort-incomplete-multipart',
            Status: 'Enabled',
            Filter: { Prefix: '' },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
          {
            ID: 'expire-tmp',
            Status: 'Enabled',
            Filter: { Prefix: 'tmp/' },
            Expiration: { Days: 7 },
          },
        ],
      },
    }),
  );
}
