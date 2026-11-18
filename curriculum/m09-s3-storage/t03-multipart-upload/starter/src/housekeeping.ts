// Lifecycle rules that keep the bucket from filling up with things nobody will ever read.
import { S3Client } from '@aws-sdk/client-s3';

export async function applyHousekeeping(client: S3Client, bucket: string): Promise<void> {
  // TODO: one lifecycle configuration with two rules (see the task brief).
  throw new Error('TODO: applyHousekeeping');
}
