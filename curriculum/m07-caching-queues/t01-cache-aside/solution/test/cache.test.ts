// Tests for the cache against a real Valkey. Each run uses its own key prefix
// and deletes its keys afterwards, so runs never see each other's data.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import { createCache } from '../src/cache.ts';

const url = process.env.VALKEY_URL ?? 'redis://localhost:56379';
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}cache-test-${randomUUID()}:`;

let redis: Redis;
let other: Redis;

before(() => {
  redis = new Redis(url);
  other = new Redis(url);
});

after(async () => {
  const keys = await redis.keys(`${runPrefix}*`);
  if (keys.length > 0) await redis.del(...keys);
  await Promise.all([redis.quit(), other.quit()]);
});

/** A fresh prefix per test, so tests can run in any order. */
const prefixFor = () => `${runPrefix}${randomUUID()}:`;

function countingLoader<T>(value: T | null, delayMs = 0) {
  const loader = async () => {
    loader.calls += 1;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return value;
  };
  loader.calls = 0;
  return loader;
}

test('a miss calls the loader and stores the value with a TTL', async () => {
  const prefix = prefixFor();
  const cache = createCache({ redis, prefix, ttlSeconds: 60, negativeTtlSeconds: 5 });
  const loader = countingLoader({ price: 1999 });

  assert.deepEqual(await cache.getOrLoad('p1', loader), { price: 1999 });
  assert.equal(loader.calls, 1);
  assert.equal(await redis.get(`${prefix}p1`), JSON.stringify({ price: 1999 }));
  const ttl = await redis.ttl(`${prefix}p1`);
  assert.ok(ttl > 0 && ttl <= 60, `ttl was ${ttl}`);
});

test('a hit does not call the loader', async () => {
  const cache = createCache({ redis, prefix: prefixFor(), ttlSeconds: 60, negativeTtlSeconds: 5 });
  const loader = countingLoader('v');
  await cache.getOrLoad('k', loader);
  await cache.getOrLoad('k', loader);
  assert.equal(loader.calls, 1);
});

test('null is cached with the shorter negative TTL', async () => {
  const prefix = prefixFor();
  const cache = createCache({ redis, prefix, ttlSeconds: 60, negativeTtlSeconds: 5 });
  const loader = countingLoader(null);
  assert.equal(await cache.getOrLoad('missing', loader), null);
  assert.equal(await cache.getOrLoad('missing', loader), null);
  assert.equal(loader.calls, 1);
  const ttl = await redis.ttl(`${prefix}missing`);
  assert.ok(ttl > 0 && ttl <= 5, `ttl was ${ttl}`);
});

test('a loader error is rethrown and not cached', async () => {
  const cache = createCache({ redis, prefix: prefixFor(), ttlSeconds: 60, negativeTtlSeconds: 5 });
  await assert.rejects(cache.getOrLoad('k', async () => { throw new Error('db down'); }), /db down/);
  assert.equal(await cache.getOrLoad('k', async () => 'recovered'), 'recovered');
});

test('invalidate makes the next read load again', async () => {
  const cache = createCache({ redis, prefix: prefixFor(), ttlSeconds: 60, negativeTtlSeconds: 5 });
  await cache.getOrLoad('k', async () => 'old');
  await cache.invalidate('k');
  assert.equal(await cache.getOrLoad('k', async () => 'new'), 'new');
});

test('a load that started before invalidate does not store its value', async () => {
  const cache = createCache({ redis, prefix: prefixFor(), ttlSeconds: 60, negativeTtlSeconds: 5 });
  const slow = cache.getOrLoad('k', countingLoader('old', 150));
  await new Promise((resolve) => setTimeout(resolve, 50));
  await cache.invalidate('k');
  assert.equal(await slow, 'old');
  assert.equal(await cache.getOrLoad('k', async () => 'new'), 'new');
});

test('concurrent misses in one process call the loader once', async () => {
  const cache = createCache({ redis, prefix: prefixFor(), ttlSeconds: 60, negativeTtlSeconds: 5 });
  const loader = countingLoader('v', 50);
  const results = await Promise.all(Array.from({ length: 30 }, () => cache.getOrLoad('hot', loader)));
  assert.equal(loader.calls, 1);
  assert.ok(results.every((r) => r === 'v'));
});

test('concurrent misses in two processes call the loader once', async () => {
  const prefix = prefixFor();
  const a = createCache({ redis, prefix, ttlSeconds: 60, negativeTtlSeconds: 5 });
  const b = createCache({ redis: other, prefix, ttlSeconds: 60, negativeTtlSeconds: 5 });
  const loader = countingLoader('v', 100);
  const calls = [];
  for (let i = 0; i < 10; i++) calls.push(a.getOrLoad('hot', loader), b.getOrLoad('hot', loader));
  const results = await Promise.all(calls);
  assert.equal(loader.calls, 1);
  assert.ok(results.every((r) => r === 'v'));
});

test('every key the cache writes expires', async () => {
  const prefix = prefixFor();
  const cache = createCache({ redis, prefix, ttlSeconds: 60, negativeTtlSeconds: 5 });
  await cache.getOrLoad('a', async () => 1);
  await cache.invalidate('a');
  await cache.getOrLoad('b', async () => null);
  for (const key of await redis.keys(`${prefix}*`)) {
    assert.ok((await redis.pttl(key)) > 0, `${key} has no TTL`);
  }
});
