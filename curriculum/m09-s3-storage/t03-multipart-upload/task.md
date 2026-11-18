Exports and video files can be several gigabytes. Upload them in parts, a few at a time, without ever holding the whole file in memory, and make sure a failed upload leaves nothing billable behind.

Use the low-level multipart commands from `@aws-sdk/client-s3`, not `@aws-sdk/lib-storage`: the point is to see each step. Node runs the `.ts` files directly, so use only erasable TypeScript syntax.

## `src/multipart.ts`

**`uploadLarge({ client, bucket, key, body, partSize?, concurrency?, contentType? })`**

- `body` is an `AsyncIterable<Uint8Array>` whose chunks can have any size.
- `partSize` defaults to 8 MiB, `concurrency` to 4. A `partSize` under 5 MiB (`MIN_PART_SIZE`) or a `concurrency` under 1 rejects with a `RangeError` before any request is sent.
- Every part except the last is exactly `partSize` bytes. Parts are numbered from 1.
- At most `concurrency` parts upload at the same time, and the next part is not read from `body` until a slot is free. Memory stays near `partSize × (concurrency + 1)`, whatever the file size.
- `contentType` is set when the upload is created.
- A body smaller than one part must work too.
- Resolves to `{ etag, parts, size }`: the ETag S3 returned on completion, the number of parts and the total bytes.
- If the source throws or any request fails, the upload is aborted and the promise rejects with the **original** error. No multipart upload and no object may remain.

## `src/housekeeping.ts`

**`applyHousekeeping(client, bucket)`** gives the bucket exactly two enabled lifecycle rules:

1. Abort incomplete multipart uploads 1 day after they start, for the whole bucket.
2. Expire objects under the prefix `tmp/` after 7 days.

Calling it twice leaves the same two rules.

## README

When would you use `lib-storage`'s `Upload` instead of your function? What else should a lifecycle rule do for this bucket in production, and why?

## What is checked

The checks upload generated data of different sizes through a client that records every command, compare checksums of what was stored, count parts in flight and bytes read ahead, make the source and one part fail on purpose, look for open multipart uploads afterwards, and read back the bucket's lifecycle configuration.
