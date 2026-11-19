---
title: Presigned URLs and direct uploads
skills: [presigned-urls]
---

A presigned URL lets someone without AWS credentials perform one specific S3 request, such as "PUT this key" or "GET that key", for a few minutes. It is how browsers upload to and download from a private bucket without the bytes touching your API. This lesson covers what the signature protects, the three-step upload flow, and the checks that must run after the upload, because the signature cannot check everything.

## What a presigned URL is

A normal SDK request carries a SigV4 signature in the `Authorization` header, computed with your secret key. A presigned URL moves that signature into the query string:

```
https://acme-uploads.s3.us-east-1.amazonaws.com/users/42/9f1c.png
  ?X-Amz-Algorithm=AWS4-HMAC-SHA256
  &X-Amz-Credential=AKIA.../20261118/us-east-1/s3/aws4_request
  &X-Amz-Date=20261118T101500Z
  &X-Amz-Expires=300
  &X-Amz-SignedHeaders=content-length;content-type;host
  &X-Amz-Signature=5f2c...
```

Your server computes it locally; no request goes to AWS. Whoever holds the URL can make exactly the request it describes until it expires, so treat it like a short-lived bearer token. It acts with the permissions of the credentials that signed it: if your server's role cannot write to the bucket, the URL cannot either.

**What the signature covers:** the HTTP method, the bucket and key, the expiry, every query parameter, and the headers listed in `X-Amz-SignedHeaders`. Change any of these and S3 answers 403.

**What it does not cover:** anything not in that list. In particular, it says nothing about what the bytes are.

**Expiry** is capped at 7 days. A URL signed with temporary role credentials also dies when those credentials expire, often within hours. For uploads, keep it to a few minutes; for downloads, often under a minute, since the browser follows the URL immediately.

## Signing with the SDK v3

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });

const url = await getSignedUrl(
  s3,
  new PutObjectCommand({ Bucket, Key: key, ContentType: 'image/png', ContentLength: size }),
  { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']) },
);
```

Two details in that snippet are easy to miss, and both fail silently:

1. **`signableHeaders`.** Setting `ContentType` on the command does not sign it. By default the SDK leaves `content-type` out of `X-Amz-SignedHeaders`, so the client can upload `text/html` to a URL you meant for PNGs. Listing it in `signableHeaders` makes S3 reject any other type. `content-length` is signed when you set `ContentLength`, which caps the upload at the size the client declared.
2. **`requestChecksumCalculation: 'WHEN_REQUIRED'`.** Since early 2025 the SDK adds a CRC32 checksum to uploads by default. When presigning, it only has an empty body to checksum, so the URL carries `x-amz-checksum-crc32=AAAAAA==` and real S3 rejects the browser's actual file. This client option leaves the checksum out. (The lab emulator accepts the bad URL, which is exactly why you check the URL's query string in tests.)

Download URLs are simpler:

```ts
const url = await getSignedUrl(
  s3,
  new GetObjectCommand({ Bucket, Key: key, ResponseContentDisposition: 'attachment; filename="invoice.pdf"' }),
  { expiresIn: 60 },
);
```

The `Response*` parameters override headers on the response, so the browser downloads the file under a friendly name instead of rendering it.

## PUT or POST

There are two kinds of presigned upload:

| | Presigned PUT | Presigned POST (policy) |
| --- | --- | --- |
| Browser sends | The raw file as the request body | A `multipart/form-data` form with fields and the file |
| Size limit | Exact length, if `content-length` is signed | A range: `["content-length-range", 1, 10485760]` |
| Content type | Exact value, if signed | Exact or prefix: `["starts-with", "$Content-Type", "image/"]` |
| SDK | `getSignedUrl` | `createPresignedPost` from `@aws-sdk/s3-presigned-post` |

POST policies are more flexible when the client does not know the exact size up front, and they work from a plain HTML form. PUT is simpler to use from `fetch`. Both are fine; pick one and enforce the limits in the signature.

## The upload flow

```
Browser                         API (NestJS)                          S3
   | POST /uploads {type,size}  ->|                                    |
   |                              | auth, validate, key = users/42/<uuid>.png
   |                              | insert files row (status pending)  |
   |<- {key, uploadUrl, headers}  |                                    |
   | PUT uploadUrl (file bytes) -------------------------------------->|
   |<------------------------------------------------------------ 200 |
   | POST /uploads/complete {key}->|                                   |
   |                              | HEAD + first bytes  -------------->|
   |                              | checks pass: status ready          |
   |<- 200 {key, size, type}      |                                    |
```

**Step 1: request.** The API authenticates the user, checks the declared type against an allow-list and the size against a limit, and generates the key. The key comes from the server: a namespace for the owner, a random id, an extension from the allow-list. Nothing the client sends (file name, path) goes into it. The API records the pending upload and returns the URL with the headers the browser must send.

**Step 2: upload.** The browser PUTs the file straight to S3:

```ts
await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: file });
```

For a browser to do this, the bucket needs a **CORS rule** that allows `PUT` from your app's origin and the `content-type` header. Without it, uploads work in curl and fail in the browser with a preflight error.

**Step 3: complete.** The browser tells the API it is done. The API must not take its word for anything:

- **Ownership.** The key must belong to this user and to an upload you issued. Another user's key is 403.
- **Existence.** `HeadObject`; if it is missing, nothing was uploaded.
- **Size and type.** Compare the HEAD's `ContentLength` and `ContentType` with what was declared. The signature should already enforce both, but this is cheap defence in depth, and it catches clients and stores where the signature is not enforced.
- **Content.** Read the first bytes with a ranged GET (`Range: 'bytes=0-7'`) and compare them with the type's magic number: `89 50 4E 47 0D 0A 1A 0A` for PNG, `FF D8 FF` for JPEG, `%PDF-` for PDF. A file named `.png` with HTML inside fails here.

If any check fails, delete the object and mark the row rejected. Only then is the file `ready` and visible to anyone else.

Some teams replace step 3 with an S3 event (an object-created notification to a queue or Lambda) so the check runs even if the browser never calls back. That is more robust; the explicit call is simpler and gives the user an immediate answer. Many apps use both.

## Scanning and re-encoding

Magic bytes prove that a file starts like a PDF, not that it is safe. For documents that other people will open, add a **malware scan** before the file becomes `ready`: GuardDuty Malware Protection for S3 scans new objects and tags them with the result, or a worker runs ClamAV on S3 events. Keep files `pending` (or in a quarantine prefix that nothing serves) until the scan reports clean.

For images, the strongest check is to **decode and re-encode** them in a worker (resizing at the same time). That removes anything hidden after the image data and strips EXIF metadata such as GPS location.

Never allow SVG or HTML uploads that are later served inline from your own domain: both can carry scripts. Serving user files from the bucket's own domain or a separate one, with `Content-Disposition: attachment` for documents, limits the damage.

## A processing pipeline on S3 events

"Design a file upload and processing pipeline" is a standard system design prompt. The usual answer puts a queue between the bucket and the workers:

```text
browser --PUT--> S3 bucket --s3:ObjectCreated:*--> SQS queue --> worker
                                                                   |
                 files row: pending -> ready / rejected  <---------+
```

The bucket sends an **event notification** for each new object. The destination can be an SQS queue, an SNS topic, a Lambda function or EventBridge. A queue is the common choice for heavy work: it holds events while workers are busy or down, retries failures, and moves messages that keep failing to a dead-letter queue. The queue needs a policy that lets the S3 service send to it, limited to your bucket.

The worker does what step 3 did, plus the slow parts: check the object, scan it, re-encode or make thumbnails, then set the row to `ready`.

Three properties of these events shape the worker:

- **At least once.** The same event can arrive twice, so the worker must be idempotent. Make the status change conditional (`update files set status = 'ready' where id = $1 and status = 'pending'`) and write results to a key derived from the source key, so a second run overwrites the same output.
- **No ordering.** Two writes to one key can arrive in either order. Each event record has a `sequencer` value; for the same key, the larger one is the later event. With versioning on, use the `versionId` from the event to read exactly the object the event is about.
- **Encoded keys.** The key in the event is URL-encoded (a space arrives as `+`). Decode it before calling S3.

Write results to a different prefix or bucket than the one that triggers the event. A worker that writes thumbnails back into the watched prefix triggers itself in a loop, and the bill shows it first.

## Common mistakes

- Setting `ContentType` on the command and assuming it is enforced. Check `X-Amz-SignedHeaders` in the URL.
- Long expiries ("valid for 7 days, to be safe"). A leaked URL works until it expires.
- Putting the client's file name in the key.
- Marking the upload ready as soon as the client says "done", without a HEAD.
- Forgetting the bucket's CORS rule, then debugging in the browser console.
- Leaving issued-but-never-completed uploads behind. Expire pending rows, and let a lifecycle rule remove the objects.

## Go deeper

- [Download and upload objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html): who can create them, expiry limits and what they can do.
- [Uploading objects with presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html): the upload case with SDK examples.
- [Authenticating requests: query parameters](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html): exactly what SigV4 signs in a presigned URL.
- [Data integrity protections for Amazon S3](https://docs.aws.amazon.com/sdkref/latest/guide/feature-dataintegrity.html): the SDK checksum defaults and the `WHEN_REQUIRED` setting.
- [GuardDuty Malware Protection for S3](https://docs.aws.amazon.com/guardduty/latest/ug/gdu-malware-protection-s3.html): managed scanning of new uploads.
