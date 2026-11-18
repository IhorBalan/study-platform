Every feature that touches files (avatars, invoices, exports) will go through one small module. Write it over the AWS SDK v3 so that the rest of the app never sees S3 error names or continuation tokens.

## Requirements

Edit `src/object-store.ts`. Keep its exported names and types. Node runs the `.ts` files directly, so use only erasable TypeScript syntax.

**`createS3Client()`** returns an `S3Client` that works against the lab emulator. Read every setting from the environment: `AWS_ENDPOINT_URL`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. Hard-code nothing.

**`createObjectStore({ client, bucket })`** returns an object with these methods:

| Method | Behaviour |
| --- | --- |
| `put(key, body, { contentType?, metadata? })` | Stores a string or `Uint8Array`. The content type defaults to `application/octet-stream`. Resolves to `{ etag }`. |
| `head(key)` | Resolves to `{ key, size, etag, lastModified, contentType, metadata }`. |
| `getStream(key)` | Resolves to `{ body, size, contentType }`, where `body` is a Node.js `Readable` that has not been read yet. |
| `list({ prefix?, pageSize?, cursor? })` | One page: `{ items, nextCursor }`. Each item is `{ key, size, etag, lastModified }`. `nextCursor` is a string, or `null` on the last page. |
| `listAll({ prefix?, pageSize? })` | An async generator over every object under the prefix. It fetches a page only when the caller reaches it. |
| `delete(key)` | Removes the object. Deleting a key that does not exist succeeds. |
| `deleteMany(keys)` | Removes all the keys with `DeleteObjects`, at most 1000 keys per request. Throws if S3 reports a failed key. |

`head` and `getStream` reject with **`ObjectNotFoundError`** (exported, with a `key` property) when the key does not exist. Any other failure, such as a missing bucket, reaches the caller as the SDK raised it.

## Tests

Write tests in `test/*.test.ts` with `node:test`, importing `../src/object-store.ts`. Create your own bucket whose name starts with `AWS_RESOURCE_PREFIX`, and delete it in `after()`. Your tests must pass, and they must fail against a store whose `head` and `getStream` throw a plain `Error` for a missing key, and against one whose `list` ignores the cursor.

## README

Answer two questions in `README.md`: what your app would keep in Postgres for each stored file, and why not store the files themselves in a `bytea` column.

## What is checked

The checks create a bucket, call your client and store, look at the objects with their own client, count the list and delete requests your store sends, and run your tests against your module and two broken copies of it.
