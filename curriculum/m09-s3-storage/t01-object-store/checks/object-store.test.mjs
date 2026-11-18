// Checks for "A storage module over S3". Node built-ins only; the AWS SDK comes from the
// submission's node_modules. Node runs src/object-store.ts directly by stripping its types.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const PREFIX = (process.env.AWS_RESOURCE_PREFIX ?? 'check-local-').toLowerCase();
const BUCKET = `${PREFIX}t01-${randomUUID().slice(0, 8)}`;

const S3 = createRequire(path.join(dir, 'package.json'))('@aws-sdk/client-s3');
/** The checks' own client, independent of the submission's createS3Client. */
const admin = new S3.S3Client({ forcePathStyle: true });

before(async () => {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set. Start the emulator with `pnpm lab up aws`.');
  await admin.send(new S3.CreateBucketCommand({ Bucket: BUCKET }));
});

after(async () => {
  try {
    let token;
    do {
      const page = await admin.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
      if (keys.length > 0) await admin.send(new S3.DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    await admin.send(new S3.DeleteBucketCommand({ Bucket: BUCKET }));
  } finally {
    admin.destroy();
  }
});

let loaded;
async function load() {
  const file = path.join(dir, 'src', 'object-store.ts');
  assert.ok(existsSync(file), 'src/object-store.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  assert.equal(typeof mod.createObjectStore, 'function', 'src/object-store.ts must export createObjectStore.');
  assert.equal(typeof mod.ObjectNotFoundError, 'function', 'src/object-store.ts must export the ObjectNotFoundError class.');
  return mod;
}

/** A client whose send() records every command, so checks can see which requests the store makes. */
function spyClient() {
  const sent = [];
  const spy = Object.create(admin);
  spy.send = (command, ...rest) => {
    sent.push(command);
    return admin.send(command, ...rest);
  };
  return { client: spy, sent };
}

async function makeStore(client = admin) {
  const { createObjectStore } = await load();
  return createObjectStore({ client, bucket: BUCKET });
}

let counter = 0;
/** A fresh key prefix per check, so checks never see each other's objects. */
const freshPrefix = () => `c${++counter}-${randomUUID().slice(0, 6)}/`;

async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('client: createS3Client() uses path-style addressing and reaches the emulator from the environment', async () => {
  const { createS3Client } = await load();
  assert.equal(typeof createS3Client, 'function', 'src/object-store.ts must export createS3Client.');
  const client = createS3Client();
  try {
    assert.ok(client instanceof S3.S3Client, 'createS3Client() should return an S3Client from @aws-sdk/client-s3.');
    assert.equal(client.config.forcePathStyle, true, 'The client should use path-style addressing (forcePathStyle: true).');
    const key = `${freshPrefix()}ping`;
    await client.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'ping' }));
    const res = await admin.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    assert.equal(res.ContentLength, 4, 'An object written with your client should be readable from the emulator.');
  } finally {
    client.destroy();
  }
});

test('put-head: put stores the content type (with a default) and metadata, and head reports them', async () => {
  const store = await makeStore();
  const p = freshPrefix();

  const res = await store.put(`${p}doc.json`, '{"a":1}', { contentType: 'application/json', metadata: { owner: 'user-1' } });
  assert.match(String(res?.etag), /^"?[0-9a-f]{32}"?$/, `put() should resolve to { etag } with the ETag S3 returned, got ${JSON.stringify(res)}.`);
  const raw = await admin.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: `${p}doc.json` }));
  assert.equal(raw.ContentType, 'application/json', 'put() should store the contentType it was given.');
  assert.deepEqual(raw.Metadata, { owner: 'user-1' }, 'put() should store the metadata it was given.');

  await store.put(`${p}blob`, new Uint8Array([1, 2, 3]));
  const blob = await admin.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: `${p}blob` }));
  assert.equal(blob.ContentType, 'application/octet-stream', `Without a contentType, put() should store application/octet-stream, found ${blob.ContentType}.`);

  const head = await store.head(`${p}doc.json`);
  assert.equal(head.key, `${p}doc.json`, 'head().key should be the key.');
  assert.equal(head.size, 7, `head().size should be the object size in bytes (7), got ${head.size}.`);
  assert.equal(head.contentType, 'application/json', 'head().contentType should be the stored content type.');
  assert.deepEqual(head.metadata, { owner: 'user-1' }, 'head().metadata should be the stored metadata.');
  assert.equal(head.etag, raw.ETag, 'head().etag should be the ETag as S3 returns it.');
  assert.ok(head.lastModified instanceof Date, 'head().lastModified should be a Date.');
});

test('get-stream: getStream returns a Node.js Readable with the exact bytes, size and content type', async () => {
  const store = await makeStore();
  const key = `${freshPrefix()}random.bin`;
  const bytes = randomBytes(300 * 1024);
  await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: bytes, ContentType: 'application/x-test' }));

  const result = await store.getStream(key);
  assert.ok(result?.body instanceof Readable, 'getStream().body should be a Node.js Readable stream, not a buffer or a string.');
  assert.equal(result.size, bytes.length, `getStream().size should be ${bytes.length}, got ${result.size}.`);
  assert.equal(result.contentType, 'application/x-test', 'getStream().contentType should be the stored content type.');
  const read = await readAll(result.body);
  assert.ok(read.equals(bytes), `The streamed bytes differ from what was stored (${read.length} bytes read, ${bytes.length} stored). Binary data must not be decoded as text.`);
});

test('not-found: a missing key is ObjectNotFoundError for head and getStream, and other errors are not', async () => {
  const { ObjectNotFoundError } = await load();
  const store = await makeStore();
  const key = `${freshPrefix()}missing`;

  for (const method of ['head', 'getStream']) {
    let error;
    try {
      await store[method](key);
    } catch (e) {
      error = e;
    }
    assert.ok(error, `${method}() on a missing key should reject.`);
    assert.ok(error instanceof ObjectNotFoundError, `${method}() on a missing key should reject with ObjectNotFoundError, got ${error?.name}: ${error?.message}`);
    assert.equal(error.key, key, `The ObjectNotFoundError from ${method}() should carry the key.`);
  }

  const { createObjectStore } = await load();
  const noBucket = createObjectStore({ client: admin, bucket: `${BUCKET}-absent` });
  let error;
  try {
    await noBucket.getStream('anything');
  } catch (e) {
    error = e;
  }
  assert.ok(error, 'getStream() on a bucket that does not exist should reject.');
  assert.ok(
    !(error instanceof ObjectNotFoundError),
    'A missing bucket was reported as ObjectNotFoundError. Only a missing key (NoSuchKey) should be; a missing bucket is a configuration error and should surface as it is.',
  );
});

test('list-pages: list returns one page of at most pageSize items and a cursor for the next', async () => {
  const store = await makeStore();
  const p = freshPrefix();
  const keys = Array.from({ length: 5 }, (_, i) => `${p}item-${i}`);
  for (const key of keys) await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'xx' }));
  await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: `${p.slice(0, -1)}-other/x`, Body: 'x' }));

  const seen = [];
  let cursor;
  for (let page = 0; page < 3; page++) {
    const res = await store.list({ prefix: p, pageSize: 2, cursor });
    assert.ok(Array.isArray(res?.items), 'list() should resolve to { items, nextCursor }.');
    assert.ok(res.items.length <= 2, `A page should hold at most pageSize (2) items, got ${res.items.length}.`);
    seen.push(...res.items.map((i) => i.key));
    if (page < 2) assert.equal(typeof res.nextCursor, 'string', `Page ${page + 1} of 3 should come with a nextCursor string.`);
    else assert.equal(res.nextCursor, null, 'The last page should have nextCursor: null.');
    cursor = res.nextCursor ?? undefined;
  }
  assert.deepEqual(seen, keys, 'Following nextCursor should visit every key under the prefix once, in key order, and nothing outside it.');

  const first = (await store.list({ prefix: p, pageSize: 10 })).items[0];
  assert.equal(first.size, 2, 'Each item should carry its size.');
  assert.match(first.etag, /[0-9a-f]{32}/, 'Each item should carry its ETag.');
  assert.ok(first.lastModified instanceof Date, 'Each item should carry lastModified as a Date.');
});

test('list-all: listAll yields every object under the prefix, fetching page by page', async () => {
  const p = freshPrefix();
  const keys = Array.from({ length: 5 }, (_, i) => `${p}k${i}`);
  for (const key of keys) await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'x' }));
  const { client, sent } = spyClient();
  const store = await makeStore(client);

  const iterator = store.listAll({ prefix: p, pageSize: 2 });
  assert.equal(typeof iterator?.[Symbol.asyncIterator], 'function', 'listAll() should return an async iterable (an async generator).');
  const first = await iterator.next();
  assert.equal(first.value?.key, keys[0], 'The first item from listAll() should be the first key.');
  const listCallsAfterFirst = sent.filter((c) => c instanceof S3.ListObjectsV2Command).length;
  assert.equal(listCallsAfterFirst, 1, `listAll() fetched ${listCallsAfterFirst} pages before yielding the first item. It should fetch the next page only when the caller gets there.`);

  const rest = [];
  for await (const item of iterator) rest.push(item.key);
  assert.deepEqual([first.value.key, ...rest], keys, 'listAll() should yield every key under the prefix exactly once.');
  const lists = sent.filter((c) => c instanceof S3.ListObjectsV2Command);
  assert.equal(lists.length, 3, `With pageSize 2 and 5 objects, listAll() should make 3 list requests, it made ${lists.length}.`);
  assert.ok(lists.every((c) => c.input.MaxKeys === 2), 'listAll() should pass pageSize to S3 as MaxKeys.');
});

test('delete: delete is idempotent and deleteMany removes keys in batches of at most 1000', async () => {
  const p = freshPrefix();
  await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: `${p}one`, Body: 'x' }));
  const { client, sent } = spyClient();
  const store = await makeStore(client);

  await store.delete(`${p}one`);
  await store.delete(`${p}one`);
  await store.delete(`${p}never-existed`);
  const left = await admin.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${p}one` }));
  assert.equal(left.KeyCount ?? 0, 0, 'delete() should remove the object.');

  const real = Array.from({ length: 3 }, (_, i) => `${p}batch-${i}`);
  for (const key of real) await admin.send(new S3.PutObjectCommand({ Bucket: BUCKET, Key: key, Body: 'x' }));
  const keys = [...real, ...Array.from({ length: 2497 }, (_, i) => `${p}ghost-${i}`)];
  sent.length = 0;
  await store.deleteMany(keys);
  const batches = sent.filter((c) => c instanceof S3.DeleteObjectsCommand);
  assert.ok(batches.length > 0, 'deleteMany() should use DeleteObjects, not one DeleteObject request per key.');
  const sizes = batches.map((c) => c.input.Delete?.Objects?.length ?? 0);
  assert.ok(sizes.every((n) => n <= 1000), `DeleteObjects accepts at most 1000 keys per request. Batches sent: ${sizes.join(', ')}.`);
  assert.equal(sizes.reduce((a, b) => a + b, 0), keys.length, `deleteMany() should send every key once. Sent ${sizes.reduce((a, b) => a + b, 0)} of ${keys.length}.`);
  const after = await admin.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${p}batch-` }));
  assert.equal(after.KeyCount ?? 0, 0, 'deleteMany() should remove the objects.');
  await store.deleteMany([]);
});
