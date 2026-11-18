---
title: The AWS SDK v3 from Node
skills: [s3-sdk]
---

The AWS SDK for JavaScript v3 is how a Node backend talks to S3, and to every other AWS service in module 11. It is modular and command-based, and once you know its four habits (clients, commands, credentials, errors) every service reads the same way. This lesson uses S3 against the lab emulator, which speaks the same API.

## Clients and commands

Each service is its own package. You create one client per service and send it command objects:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ forcePathStyle: true });

await s3.send(new PutObjectCommand({
  Bucket: 'dev-uploads',
  Key: 'notes/hello.txt',
  Body: 'hello',
  ContentType: 'text/plain',
}));
```

The input field names match the S3 REST API (`Bucket`, `Key`, `ContentType`, `MaxKeys`), so the API reference doubles as SDK documentation. Commands import individually, so your bundle (or Lambda) carries only what it uses. There is also an aggregated `S3` class with methods like `s3.putObject(...)`; it is convenient but pulls in every command. Most codebases use the client and commands.

**Create one client and reuse it.** A client holds a pool of keep-alive connections (50 sockets per client by default in Node). Creating one per request throws the pool away each time. In NestJS, a client is a natural provider:

```ts
@Global()
@Module({
  providers: [{ provide: S3_CLIENT, useFactory: () => new S3Client({ forcePathStyle: true }) }],
  exports: [S3_CLIENT],
})
export class StorageModule {}
```

## Configuration comes from the environment

Notice that the client above has no region, endpoint or keys. The SDK resolves them itself:

- **Region** from `AWS_REGION` (or the shared config file).
- **Endpoint** from `AWS_ENDPOINT_URL`, or a service-specific `AWS_ENDPOINT_URL_S3`. Without one, it builds the real AWS endpoint for the region. This is how the same code talks to the emulator locally and to AWS in production.
- **Credentials** from the **default provider chain**, tried in order: environment variables (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`), SSO and shared `~/.aws` files, a web identity token, and finally the container or instance metadata service.

The last step is what production uses. A container on ECS, a Lambda function or a pod with an IAM role gets short-lived credentials from the platform, and the chain picks them up. **No access key ever appears in your code or your `.env` in production.** Locally you use SSO (`aws sso login`) or, against the emulator, any dummy values.

`forcePathStyle: true` makes the SDK put the bucket in the path (`http://localhost:4566/dev-uploads/key`) instead of the host name (`dev-uploads.s3.amazonaws.com`). AWS prefers the second form, called virtual-hosted style. Emulators and most S3-compatible stores need path style because `dev-uploads.localhost` does not resolve. Turn it on for the emulator; on AWS either works.

## Bodies are streams

`PutObject` accepts a string, a `Uint8Array`, a `Buffer` or a stream. For a stream, S3 needs the length up front, so pass `ContentLength` or use multipart upload (lesson 4).

`GetObject` returns the body as a stream. In Node it is an `http.IncomingMessage`, which is a `Readable`, with helper methods mixed in:

```ts
const res = await s3.send(new GetObjectCommand({ Bucket: 'dev-uploads', Key: 'notes/hello.txt' }));

const text = await res.Body!.transformToString();      // small text
// const bytes = await res.Body!.transformToByteArray(); // small binary
// const web = res.Body!.transformToWebStream();         // a web ReadableStream
```

For anything large, pipe the stream instead of buffering it. A NestJS route can return it directly:

```ts
import { StreamableFile } from '@nestjs/common';
import type { Readable } from 'node:stream';

@Get('exports/:id')
async download(@Param('id') id: string) {
  const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: `exports/${id}.csv` }));
  return new StreamableFile(res.Body as Readable, { type: res.ContentType, length: res.ContentLength });
}
```

(For user-facing downloads a presigned URL is usually better, as lesson 3 shows. Streaming through the API fits small files or ones you transform on the way.)

**Always consume or destroy a body.** An unread body holds its socket. After 50 forgotten bodies, every S3 call in the process waits for a free socket and the SDK logs "socket usage at capacity". If you only needed the headers, call `HeadObject` instead, or `res.Body.destroy()` when you are done.

## Errors

Failed calls throw an exception that extends `S3ServiceException`. The useful fields:

- `error.name`: the S3 error code, such as `NoSuchKey`, `NoSuchBucket`, `AccessDenied`, `SlowDown`.
- `error.$metadata.httpStatusCode`: the HTTP status.
- `error.$metadata.requestId`: what AWS support will ask for.

```ts
import { NoSuchKey, S3ServiceException } from '@aws-sdk/client-s3';

try {
  await s3.send(new GetObjectCommand({ Bucket, Key }));
} catch (error) {
  if (error instanceof NoSuchKey) throw new ObjectNotFoundError(Key, { cause: error });
  throw error; // AccessDenied, NoSuchBucket, throttling: not "not found"
}
```

One trap: `HeadObject` responses have no body, so S3 cannot say which error happened. A missing key arrives as a generic `NotFound` with status 404, and so does a missing bucket. Check `error.name === 'NotFound'` or the status code for HEAD.

Translate SDK errors into your own at the edge of a storage module. The rest of the app should see `ObjectNotFoundError`, not S3 error codes. And translate only what you mean: a missing bucket or an access denied error is a configuration problem that should page someone, not a 404 for the user.

The SDK **retries** throttling and transient network errors itself (three attempts by default, with backoff). You can raise `maxAttempts` on the client; do not wrap calls in your own retry loop on top.

## Listing and pagination

`ListObjectsV2` returns at most 1,000 keys per call, plus `IsTruncated` and a `NextContinuationToken`. The SDK ships paginator helpers that hide the loop:

```ts
import { paginateListObjectsV2 } from '@aws-sdk/client-s3';

for await (const page of paginateListObjectsV2({ client: s3, pageSize: 500 }, { Bucket, Prefix: 'users/42/' })) {
  for (const obj of page.Contents ?? []) console.log(obj.Key, obj.Size);
}
```

When you expose listing in your own API, hand out an opaque cursor rather than S3's token name, so you can change the backing store later.

## Working against the emulator

The lab runs an S3-compatible emulator on `http://localhost:4566`. Point the SDK at it with environment variables, and nothing in your code changes:

```sh
export AWS_ENDPOINT_URL=http://localhost:4566 AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=test AWS_SECRET_ACCESS_KEY=test
```

Emulators are excellent for tests and fast feedback, and they are not AWS. The one in this lab, for example, does not verify request signatures: a tampered presigned URL still works there. Treat the emulator as a test double for the API surface, and keep a short list of what you have only verified locally.

In tests, give each run its own bucket name with a random suffix, and delete its objects and the bucket in `after()`. Buckets must be empty before `DeleteBucket` succeeds, and with versioning on that includes old versions.

## Common mistakes

- Creating an `S3Client` per request, which loses connection reuse.
- Committing access keys or putting them in a production `.env`. Use roles and the provider chain.
- Forgetting `forcePathStyle: true` against an emulator, then debugging DNS errors for `bucket.localhost`.
- Calling `transformToByteArray()` on large objects, or never reading the body at all.
- Mapping every 404 to "not found", including a missing bucket.
- Adding your own retry loop around calls the SDK already retries.

## Go deeper

- [AWS SDK for JavaScript v3 developer guide](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/welcome.html): clients, commands, configuration and migration from v2.
- [Set credentials in Node.js](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html): the provider chain step by step.
- [S3 client API reference](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/): every command, its input and output types.
- [Error responses](https://docs.aws.amazon.com/AmazonS3/latest/API/ErrorResponses.html): the list of S3 error codes and their status codes.
