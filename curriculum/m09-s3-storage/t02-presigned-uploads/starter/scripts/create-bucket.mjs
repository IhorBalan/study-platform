// Creates the bucket named in UPLOADS_BUCKET on the emulator, for local runs.
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const bucket = process.env.UPLOADS_BUCKET;
if (!bucket) throw new Error('Set UPLOADS_BUCKET first');
const s3 = new S3Client({ forcePathStyle: true });
await s3.send(new CreateBucketCommand({ Bucket: bucket }));
console.log(`Created ${bucket}`);
