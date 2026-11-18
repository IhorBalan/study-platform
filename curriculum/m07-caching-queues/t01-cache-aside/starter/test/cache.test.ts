// Tests for the cache against a real Valkey. Run them with `npm test`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import { createCache } from '../src/cache.ts';

const url = process.env.VALKEY_URL ?? 'redis://localhost:56379';
// A prefix of its own per run, so runs never see each other's keys.
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}cache-test-${randomUUID()}:`;

let redis: Redis;

before(() => {
  redis = new Redis(url);
});

after(async () => {
  // TODO: delete every key under runPrefix.
  await redis.quit();
});

test('a miss calls the loader and returns its value', async () => {
  const cache = createCache({ redis, prefix: `${runPrefix}${randomUUID()}:`, ttlSeconds: 60, negativeTtlSeconds: 5 });
  let calls = 0;
  const value = await cache.getOrLoad('p1', async () => {
    calls += 1;
    return { price: 1999 };
  });
  assert.deepEqual(value, { price: 1999 });
  assert.equal(calls, 1);
});

// TODO: a hit does not call the loader.
// TODO: TTLs, negative caching, loader errors.
// TODO: invalidate, including during a slow load.
// TODO: concurrent misses, in one cache and in two caches with separate connections.
