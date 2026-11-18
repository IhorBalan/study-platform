// Tests against the lab S3 emulator. Each run creates its own bucket under AWS_RESOURCE_PREFIX
// and deletes it afterwards, objects included.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { buffer } from 'node:stream/consumers';
import { after, before, test } from 'node:test';
import { CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { ObjectNotFoundError, createObjectStore, createS3Client } from '../src/object-store.ts';

const client = createS3Client();
const bucket = `${process.env.AWS_RESOURCE_PREFIX ?? 'dev-'}store-test-${randomUUID().slice(0, 8)}`.toLowerCase();
const store = createObjectStore({ client, bucket });

before(async () => {
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
});

after(async () => {
  const keys: string[] = [];
  for await (const item of store.listAll()) keys.push(item.key);
  await store.deleteMany(keys);
  await client.send(new DeleteBucketCommand({ Bucket: bucket }));
  client.destroy();
});

test('put then getStream returns the same bytes', async () => {
  const bytes = randomBytes(2048);
  await store.put('bin/a', bytes, { contentType: 'application/x-test' });
  const { body, size, contentType } = await store.getStream('bin/a');
  assert.deepEqual(await buffer(body), bytes);
  assert.equal(size, 2048);
  assert.equal(contentType, 'application/x-test');
});

test('head returns metadata and a default content type', async () => {
  await store.put('meta/a.txt', 'hello', { metadata: { owner: 'u1' } });
  const head = await store.head('meta/a.txt');
  assert.equal(head.size, 5);
  assert.equal(head.contentType, 'application/octet-stream');
  assert.deepEqual(head.metadata, { owner: 'u1' });
});

test('missing keys raise ObjectNotFoundError', async () => {
  await assert.rejects(store.head('nope'), (e) => e instanceof ObjectNotFoundError && e.key === 'nope');
  await assert.rejects(store.getStream('nope'), (e) => e instanceof ObjectNotFoundError && e.key === 'nope');
});

test('a missing bucket is not reported as a missing object', async () => {
  const other = createObjectStore({ client, bucket: `${bucket}-missing` });
  await assert.rejects(other.getStream('x'), (e) => !(e instanceof ObjectNotFoundError));
});

test('list pages through a prefix with a cursor', async () => {
  for (let i = 0; i < 5; i++) await store.put(`page/${i}`, String(i));
  const first = await store.list({ prefix: 'page/', pageSize: 2 });
  assert.deepEqual(first.items.map((i) => i.key), ['page/0', 'page/1']);
  assert.ok(first.nextCursor);
  const second = await store.list({ prefix: 'page/', pageSize: 2, cursor: first.nextCursor ?? undefined });
  assert.deepEqual(second.items.map((i) => i.key), ['page/2', 'page/3']);
  const third = await store.list({ prefix: 'page/', pageSize: 2, cursor: second.nextCursor ?? undefined });
  assert.deepEqual(third.items.map((i) => i.key), ['page/4']);
  assert.equal(third.nextCursor, null);

  const all: string[] = [];
  for await (const item of store.listAll({ prefix: 'page/', pageSize: 2 })) all.push(item.key);
  assert.equal(all.length, 5);
});

test('delete is idempotent and deleteMany removes every key', async () => {
  await store.put('gone/1', 'x');
  await store.put('gone/2', 'x');
  await store.delete('gone/1');
  await store.delete('gone/1');
  await assert.rejects(store.head('gone/1'), ObjectNotFoundError);
  await store.deleteMany(['gone/2', 'gone/never-existed']);
  assert.equal((await store.list({ prefix: 'gone/' })).items.length, 0);
});
