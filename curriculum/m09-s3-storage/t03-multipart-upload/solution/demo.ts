// Uploads 40 MiB of generated data to the bucket in DEMO_BUCKET and prints the result.
import { randomBytes } from 'node:crypto';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { uploadLarge } from './src/multipart.ts';

const bucket = process.env.DEMO_BUCKET ?? 'dev-large-files';
const client = new S3Client({ forcePathStyle: true });
await client.send(new CreateBucketCommand({ Bucket: bucket })).catch(() => {});

async function* generated(totalBytes: number) {
  for (let sent = 0; sent < totalBytes; sent += 1024 * 1024) yield randomBytes(Math.min(1024 * 1024, totalBytes - sent));
}

const started = Date.now();
const result = await uploadLarge({ client, bucket, key: 'demo/big.bin', body: generated(40 * 1024 * 1024) });
console.log(result, `${Date.now() - started} ms`);
client.destroy();
