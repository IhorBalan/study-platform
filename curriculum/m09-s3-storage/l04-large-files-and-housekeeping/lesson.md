---
title: Large files, lifecycle and a safe bucket
skills: [multipart-uploads, storage-operations]
---

Two problems remain after the basic upload flow. Large files do not fit a single request well: a 2 GB video over a hotel Wi-Fi connection fails at 90% and starts again. And buckets fill up quietly with abandoned uploads, old versions and temporary exports that nobody deletes, while their security depends on settings you may never have looked at. This lesson covers multipart upload, lifecycle rules, and the handful of bucket settings that keep files private. It ends with an honest look at alternatives to S3.

## Multipart upload

Multipart upload splits one object into parts that upload independently, in parallel, and can be retried one at a time.

1. **`CreateMultipartUpload`** with the bucket, key and content type. Returns an `UploadId`.
2. **`UploadPart`** for each part, with a `PartNumber` from 1 to 10,000. Each returns an `ETag`. Parts can upload in any order and in parallel.
3. **`CompleteMultipartUpload`** with the list of `{ PartNumber, ETag }` in ascending order. S3 joins the parts into one object.

Or **`AbortMultipartUpload`** to throw the parts away.

The rules: every part except the last must be at least **5 MiB**, a part can be up to 5 GiB, and there are at most 10,000 parts. With 8 MiB parts, that caps the object at about 80 GB; choose a larger part size for bigger files. The final object's ETag is not an MD5 of the file but a hash of the part hashes with `-<number of parts>` appended, such as `"1ff9d5...-3"`. Do not compare it with a local MD5.

**Incomplete uploads cost money.** Until you complete or abort, the parts are stored and billed, and they do not show up in `ListObjectsV2`. A crashed process that never aborts leaves them there forever. `ListMultipartUploads` shows them; a lifecycle rule (below) cleans them up automatically.

### Multipart from Node: lib-storage

For uploads from your server, use `Upload` from `@aws-sdk/lib-storage`. It reads any stream, cuts it into parts, uploads several at once, aborts on failure and reports progress:

```ts
import { Upload } from '@aws-sdk/lib-storage';
import { createReadStream } from 'node:fs';

const upload = new Upload({
  client: s3,
  params: { Bucket, Key: 'exports/2026-11.csv.gz', Body: createReadStream('/tmp/export.csv.gz'), ContentType: 'application/gzip' },
  partSize: 16 * 1024 * 1024,
  queueSize: 4,                // parts in flight
  leavePartsOnError: false,    // abort on failure (the default)
});
upload.on('httpUploadProgress', (p) => console.log(p.loaded, p.total));
await upload.done();
```

Memory stays near `partSize × queueSize`, whatever the file size. Small bodies go up as a single `PutObject`. In task 3 you write the same logic by hand with the low-level commands, to see where the ETags, the ordering and the abort come from.

### Multipart from the browser

For large browser uploads, combine multipart with presigned URLs:

1. The browser asks the API to start an upload. The API calls `CreateMultipartUpload` and stores the `UploadId` with the pending file row.
2. The API presigns one `UploadPartCommand` URL per part number (or hands them out in batches).
3. The browser PUTs each slice of the `File` (`file.slice(start, end)`) to its URL and reads the `ETag` response header. The bucket's CORS rule must list `ETag` in `ExposeHeaders`, or the browser cannot read it.
4. The browser sends the list of ETags; the API calls `CompleteMultipartUpload` and runs the usual checks.

This is also how **resumable uploads** work: after a failure at 180 MB, the client asks the API which parts S3 already has (`ListParts`) and uploads only the rest. Libraries such as Uppy implement the browser side for you.

## Lifecycle rules

A lifecycle configuration is a list of rules that S3 applies on its own, roughly once a day. Each rule has a filter (a prefix, tags, or object size) and actions:

```ts
await s3.send(new PutBucketLifecycleConfigurationCommand({
  Bucket,
  LifecycleConfiguration: {
    Rules: [
      { ID: 'abort-incomplete-multipart', Status: 'Enabled', Filter: { Prefix: '' },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
      { ID: 'expire-tmp', Status: 'Enabled', Filter: { Prefix: 'tmp/' }, Expiration: { Days: 7 } },
      { ID: 'old-exports-to-ia', Status: 'Enabled', Filter: { Prefix: 'exports/' },
        Transitions: [{ Days: 30, StorageClass: 'STANDARD_IA' }] },
      { ID: 'old-versions', Status: 'Enabled', Filter: { Prefix: '' },
        NoncurrentVersionExpiration: { NoncurrentDays: 30 } },
    ],
  },
}));
```

- **`AbortIncompleteMultipartUpload`**: every bucket that receives multipart uploads should have this.
- **`Expiration`**: deletes objects after N days. Ideal for temporary exports, pending uploads in an `incoming/` prefix, or anything with a retention limit.
- **`Transitions`**: move objects to cheaper storage classes as they age.
- **`NoncurrentVersionExpiration`**: with versioning on, removes old versions after N days.

`PutBucketLifecycleConfiguration` **replaces** the whole configuration. Two parts of your code that each "add a rule" overwrite each other; manage the rules in one place, ideally in infrastructure as code (module 15). Lifecycle actions are not instant: an object due today may disappear tomorrow.

Lifecycle rules also handle **orphans**: objects with no database row because the upload was never completed. Upload into `incoming/`, copy to the final key when the file is confirmed, and let a rule expire `incoming/` after a day.

## Versioning

With versioning enabled, an overwrite keeps the old object as a noncurrent version, and a delete adds a **delete marker** instead of removing data. You can restore anything a bug or an attacker overwrote. The cost is that every version is billed, which is why it goes with a `NoncurrentVersionExpiration` rule. Once enabled, versioning can be suspended but never fully turned off.

For records that must not change, such as signed contracts kept for ten years, **S3 Object Lock** (which requires versioning) stores objects as write-once-read-many. In compliance mode, not even the account root user can delete a locked version before its retention date.

## Keeping the bucket private

Most S3 data leaks in the news were public buckets. Today's defaults help:

- **Block Public Access** is on for new buckets (since April 2023). Leave all four settings on. Serve files through presigned URLs or a CDN, never through a public bucket.
- **ACLs are disabled** for new buckets (Object Ownership "bucket owner enforced"). Access is decided by IAM and bucket policies only.
- **Encryption at rest** is automatic: since January 2023 every new object is encrypted with S3-managed keys (SSE-S3). Use SSE-KMS when you need control over who can use the key and an audit trail of every decrypt, at a per-request KMS cost (enable S3 Bucket Keys to reduce it).
- **Bucket policies** add rules that hold no matter which role calls. A common one denies any request that does not use TLS:

```json
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": ["arn:aws:s3:::acme-uploads", "arn:aws:s3:::acme-uploads/*"],
  "Condition": { "Bool": { "aws:SecureTransport": "false" } }
}
```

Give your application's role only the actions it needs on the bucket it uses (`s3:PutObject`, `s3:GetObject` on `arn:aws:s3:::acme-uploads/*`), not `s3:*`. Module 11 covers IAM.

## A CDN in front

Files that many people read, such as avatars and product images, should not be served from S3 for every page view. Put **CloudFront** in front: it caches at edge locations near users, and the bucket stays private because only CloudFront may read it (Origin Access Control). For private content behind a CDN, CloudFront has its own **signed URLs and signed cookies**, signed with a key pair you register; a signed cookie can cover every image on a page at once. Use content-addressed keys (a new key per new avatar) so you never need to invalidate caches.

## Alternatives a startup might pick

| Option | What it is | Good for | Watch out for |
| --- | --- | --- | --- |
| **AWS S3** | The reference object store | Anything on AWS; the richest features (lifecycle, Object Lock, events, IAM) | Egress pricing; many settings to get right |
| **Cloudflare R2** | S3-compatible API, no egress fees | Download-heavy products (media, public assets) | A smaller feature set than S3, so check lifecycle, retention and event support against your needs; a second vendor if the rest is on AWS |
| **Supabase Storage** | Object storage built into Supabase, with access rules as Postgres RLS policies | Apps already on Supabase; rules next to the data | Tied to the Supabase platform |
| **UploadThing** | Managed upload service for TypeScript apps | Shipping uploads in a day with type and size limits declared in code | Files live on someone else's service; less control over keys, lifecycle and compliance |

Because R2, Supabase Storage and most emulators speak the S3 API, the SDK code from this module mostly carries over: change the endpoint, credentials and `forcePathStyle`. That is a good reason to keep storage behind a small module of your own, as in task 1.

## Common mistakes

- No `AbortIncompleteMultipartUpload` rule, so failed uploads are billed forever and never seen.
- Completing a multipart upload with parts out of order, or comparing its ETag with an MD5.
- Two pieces of code calling `PutBucketLifecycleConfiguration`, each wiping the other's rules.
- Versioning on without a rule for noncurrent versions.
- Turning off Block Public Access to serve images, instead of using a CDN or presigned URLs.
- Granting the app `s3:*` on `*`.

## Go deeper

- [Uploading and copying objects using multipart upload](https://docs.aws.amazon.com/AmazonS3/latest/userguide/mpuoverview.html): the process, limits and permissions.
- [@aws-sdk/lib-storage](https://www.npmjs.com/package/@aws-sdk/lib-storage): `Upload` options and progress events.
- [Managing the lifecycle of objects](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html): rule elements, filters and timing.
- [Blocking public access to your Amazon S3 storage](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html): the four settings and how they interact with policies.
- [Serving private content with signed URLs and signed cookies](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PrivateContent.html): CloudFront's own signing.
