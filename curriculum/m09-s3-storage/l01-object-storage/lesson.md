---
title: "Object storage: where files belong"
skills: [object-storage]
---

Sooner or later a user wants to upload something: an avatar, an invoice, a CSV export. The bytes have to live somewhere, and the obvious places (the server's disk, a database column) both break as soon as you have two instances or a few hundred gigabytes. Object storage, with Amazon S3 as the reference design, is where files go in almost every backend. This lesson covers the model, what it costs, and the one architectural rule that shapes the rest of the module: file bytes should not pass through your API server.

## The model: buckets, keys, objects

S3 is a giant key-value store for files.

- A **bucket** is a named container. Bucket names are global across all AWS accounts, lowercase, 3 to 63 characters. You usually have a few per app (`acme-prod-uploads`, `acme-prod-exports`), not one per user.
- A **key** is the object's name inside the bucket, any UTF-8 string up to 1024 bytes: `users/42/avatars/9f1c.png`.
- An **object** is the bytes plus metadata: a content type, a size, an ETag (a hash-like fingerprint), and any `x-amz-meta-*` headers you add.

There are no folders. `users/42/avatars/9f1c.png` is one flat string. The console shows folders because listing with `Prefix: 'users/42/'` and `Delimiter: '/'` groups keys by the next slash. This matters in practice: "renaming a folder" means copying and deleting every object under the prefix, and "listing a folder" is a prefix query that returns at most 1,000 keys per page.

Objects are **immutable**. You cannot append to one or change byte 500. You replace the whole object with a new PUT. A single PUT takes up to 5 GB; larger objects (up to 50 TB) go up in parts with multipart upload, covered in lesson 4.

## Consistency

Since December 2020, S3 gives **strong read-after-write consistency** for every operation. After a successful PUT, any GET or LIST sees the new object. Old tutorials warn about eventual consistency; ignore them for S3. Some S3-compatible stores and emulators differ in details, so test the ones you depend on.

What S3 does not give you is transactions. Writing the object and inserting the database row that points at it are two separate operations, and either can fail. Design for that: write the object first, then the row, and clean up objects that no row references (lesson 4 shows how lifecycle rules help).

## The shape of the bill

S3 pricing has three parts, and beginners usually estimate only the first.

| Part | Rough order (S3 Standard, us-east-1) | What drives it |
| --- | --- | --- |
| Storage | about $0.023 per GB-month | How much you keep, in which storage class |
| Requests | about $0.005 per 1,000 PUTs or LISTs, $0.0004 per 1,000 GETs | Many tiny objects, chatty listing |
| Data transfer out | about $0.09 per GB to the internet | Every download by a user |

Check the pricing page for current numbers; the shape is what matters. 1 TB stored costs about $23 a month. If users download that terabyte once a month, transfer costs about $90. Egress is usually the big line, which is why CDNs and providers with free egress (Cloudflare R2) exist.

**Storage classes** trade a cheaper GB-month for retrieval fees or delays:

- **Standard**: the default, for anything read often.
- **Standard-IA** (infrequent access): about half the storage price, with a per-GB retrieval fee and a 30-day minimum. Good for old invoices.
- **Intelligent-Tiering**: S3 moves objects between tiers by access pattern for a small monitoring fee. A safe default when you cannot predict access.
- **Glacier Instant Retrieval, Flexible Retrieval, Deep Archive**: archive tiers, from milliseconds to hours to read back, for compliance copies and backups.

You choose a class per object at upload time, or let lifecycle rules move objects later.

## Why not the disk or the database

**The server's disk.** Containers are disposable: a redeploy gives you a fresh filesystem, and two instances behind a load balancer each see only their own files. You would need a shared network filesystem, with its own failure modes, to make this work.

**A `bytea` column in Postgres.** It works for a few small files and keeps everything in one transaction, which is tempting. It does not scale well:

- Every file goes into the WAL, every replica and every backup. Your nightly `pg_dump` grows with user uploads instead of business data.
- Reading a 50 MB file means Postgres and Node each hold 50 MB in memory. A `bytea` value is capped at 1 GB.
- Managed Postgres storage costs several times more per GB than S3, with no cheaper tiers.

The standard design splits the two: **S3 holds the bytes, Postgres holds the facts.**

```sql
CREATE TABLE files (
  id            uuid PRIMARY KEY,
  owner_id      uuid NOT NULL REFERENCES users(id),
  storage_key   text NOT NULL UNIQUE,        -- users/42/9f1c....png
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL,
  status        text NOT NULL DEFAULT 'pending',  -- pending | ready | rejected
  original_name text,                         -- for display only, never part of the key
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

Queries such as "all files of this customer" or "storage used per tenant" run against this table. S3 is never your query engine.

## Why uploads should not pass through your API

The naive upload endpoint accepts `multipart/form-data`, buffers or streams the file through Node, and then PUTs it to S3. Every byte crosses the network twice, and your API pays for it:

- **Bandwidth and memory.** Ten users uploading 200 MB videos at once means 2 GB in flight through a process that was sized for JSON.
- **Timeouts.** Load balancers and PaaS routers cut requests after 30 to 100 seconds. A slow mobile upload does not finish.
- **Scaling the wrong thing.** You add API instances to move bytes that never needed your code.
- **Body limits.** Express, Next.js route handlers and serverless functions cap request bodies (Lambda at about 6 MB), so you end up fighting the platform.

The alternative is a **presigned URL**: your API checks who the user is and what they may upload, then returns a URL that lets the browser PUT that one object straight to S3 for a few minutes. Your API handles two small JSON requests; S3 handles the bytes. Lesson 3 builds this flow. A frontend analogy: it is like handing the browser a short-lived, single-use token for one specific CDN path, instead of proxying the file yourself.

## Common mistakes

- Using the user's file name as the key. It collides, leaks personal data into URLs and logs, and lets a user pick paths like `../`. Generate keys on the server.
- Treating prefixes as folders and expecting cheap renames or a `COUNT(*)`. Keep that information in Postgres.
- Estimating cost from storage alone and being surprised by egress.
- Making a bucket public to "just serve the images". Keep buckets private and serve through presigned URLs or a CDN.
- Proxying uploads through the API "for now". The memory spikes and timeouts arrive with the first large files.

## Go deeper

- [What is Amazon S3?](https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html): the user guide's overview of buckets, objects, keys and the consistency model.
- [Understanding and managing storage classes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/storage-class-intro.html): each class, its minimum duration and retrieval behaviour.
- [Amazon S3 pricing](https://aws.amazon.com/s3/pricing/): the current numbers behind the table above.
- [Amazon S3 increases the maximum object size to 50 TB](https://aws.amazon.com/about-aws/whats-new/2025/12/amazon-s3-maximum-object-size-50-tb/): the December 2025 change to object size limits.
