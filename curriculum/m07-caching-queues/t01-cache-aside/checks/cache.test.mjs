// Checks for "A cache-aside helper with stampede protection". Node built-ins only;
// ioredis comes from the submission's node_modules. Node runs src/cache.ts directly
// by stripping its types.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const VALKEY_URL = process.env.VALKEY_URL;
const ROOT = `${process.env.VALKEY_KEY_PREFIX ?? 'check_local:'}t01:${randomUUID().slice(0, 8)}:`;

const clients = [];
function client() {
  assert.ok(VALKEY_URL, 'VALKEY_URL is not set for the check run. Start the lab Valkey with `pnpm lab up valkey`.');
  const require = createRequire(path.join(dir, 'package.json'));
  const { Redis } = require('ioredis');
  const redis = new Redis(VALKEY_URL, { maxRetriesPerRequest: 2 });
  clients.push(redis);
  return redis;
}

let admin;
after(async () => {
  if (admin) {
    let cursor = '0';
    do {
      const [next, keys] = await admin.scan(cursor, 'MATCH', `${ROOT}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await admin.del(...keys);
    } while (cursor !== '0');
  }
  await Promise.all(clients.map((c) => c.quit().catch(() => c.disconnect())));
});

let loaded;
async function load() {
  const file = path.join(dir, 'src', 'cache.ts');
  assert.ok(existsSync(file), 'src/cache.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  assert.equal(typeof mod.createCache, 'function', 'src/cache.ts must export a function named createCache.');
  admin ??= client();
  return mod;
}

let counter = 0;
/** A fresh key prefix for one check, so checks never share state. */
const freshPrefix = () => `${ROOT}${++counter}:`;

/** A loader that counts its calls. `gate` lets a check decide when it resolves. */
function loaderOf(value, { delayMs = 0, gate } = {}) {
  const fn = async () => {
    fn.calls += 1;
    if (gate) await gate;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return value;
  };
  fn.calls = 0;
  return fn;
}

async function makeCache(overrides = {}) {
  const { createCache } = await load();
  const prefix = overrides.prefix ?? freshPrefix();
  const cache = createCache({ redis: overrides.redis ?? admin, prefix, ttlSeconds: 120, negativeTtlSeconds: 7, ...overrides });
  return { cache, prefix };
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('hit-miss: a miss loads and stores JSON with the TTL, and a hit skips the loader', async () => {
  const { cache, prefix } = await makeCache();
  const loader = loaderOf({ id: 'p1', priceCents: 1999 });

  const first = await cache.getOrLoad('product:p1', loader);
  assert.deepEqual(first, { id: 'p1', priceCents: 1999 }, 'The first call should return what the loader returned.');
  assert.equal(loader.calls, 1, `A miss should call the loader once, it was called ${loader.calls} times.`);

  const raw = await admin.get(`${prefix}product:p1`);
  assert.ok(raw !== null, `Expected the value under the key "<prefix>product:p1", found nothing there.`);
  assert.deepEqual(JSON.parse(raw), { id: 'p1', priceCents: 1999 }, 'The stored value should be the JSON of what the loader returned.');
  const ttl = await admin.ttl(`${prefix}product:p1`);
  assert.ok(ttl > 0 && ttl <= 120, `The value should expire after ttlSeconds (120), its TTL is ${ttl}.`);

  const second = await cache.getOrLoad('product:p1', loader);
  assert.deepEqual(second, { id: 'p1', priceCents: 1999 });
  assert.equal(loader.calls, 1, 'A hit must not call the loader.');

  // A value another instance stored is a hit as well.
  await admin.set(`${prefix}product:p2`, JSON.stringify({ id: 'p2' }), 'EX', 60);
  const other = loaderOf({ id: 'wrong' });
  assert.deepEqual(await cache.getOrLoad('product:p2', other), { id: 'p2' }, 'A value already in Valkey should be returned as it is.');
  assert.equal(other.calls, 0, 'A value already in Valkey must not call the loader.');
});

test('negative-cache: null is cached for negativeTtlSeconds, and loader errors are not cached', async () => {
  const { cache, prefix } = await makeCache();
  const missing = loaderOf(null);
  assert.equal(await cache.getOrLoad('product:none', missing), null);
  assert.equal(await cache.getOrLoad('product:none', missing), null);
  assert.equal(missing.calls, 1, `A null result should be cached, but the loader ran ${missing.calls} times.`);
  const ttl = await admin.ttl(`${prefix}product:none`);
  assert.ok(ttl > 0 && ttl <= 7, `A cached null should expire after negativeTtlSeconds (7), its TTL is ${ttl}.`);

  let attempts = 0;
  const failing = async () => {
    attempts += 1;
    throw new Error('database unavailable');
  };
  await assert.rejects(cache.getOrLoad('product:err', failing), /database unavailable/, 'A loader error should reach the caller.');
  assert.equal(await admin.exists(`${prefix}product:err`), 0, 'A loader error must not be stored.');
  const recovered = loaderOf({ ok: true });
  assert.deepEqual(await cache.getOrLoad('product:err', recovered), { ok: true }, 'After an error the next call should load again.');
  assert.equal(attempts, 1);
  assert.equal(recovered.calls, 1, 'After a loader error the next call should try the loader straight away, not wait.');
});

test('invalidate: invalidate removes the value and the next read loads fresh data', async () => {
  const { cache, prefix } = await makeCache();
  await cache.getOrLoad('product:p1', loaderOf({ priceCents: 1000 }));
  await cache.invalidate('product:p1');
  assert.equal(await admin.exists(`${prefix}product:p1`), 0, 'After invalidate the value key should be gone.');
  const fresh = loaderOf({ priceCents: 1200 });
  assert.deepEqual(await cache.getOrLoad('product:p1', fresh), { priceCents: 1200 });
  assert.equal(fresh.calls, 1, 'The read after invalidate should call the loader.');
  await cache.invalidate('product:never-cached');
});

test('no-stale-set: a load that began before invalidate does not store its old value', async () => {
  const { cache } = await makeCache();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const slow = cache.getOrLoad('product:p1', loaderOf({ priceCents: 1000 }, { gate }));
  await new Promise((resolve) => setTimeout(resolve, 80));
  // The price changes in the database and the writer invalidates, while the slow read is still loading.
  await cache.invalidate('product:p1');
  release();
  assert.deepEqual(await slow, { priceCents: 1000 }, 'The slow caller still gets the value its loader returned.');

  const next = loaderOf({ priceCents: 1200 });
  const value = await cache.getOrLoad('product:p1', next);
  assert.deepEqual(
    value,
    { priceCents: 1200 },
    'A load that started before invalidate() stored its old value afterwards, so the cache serves a stale price until the TTL ends.',
  );
  assert.equal(next.calls, 1);
});

test('single-flight: 50 concurrent misses in one process call the loader once', async () => {
  const { cache } = await makeCache();
  const loader = loaderOf({ hot: true }, { delayMs: 100 });
  const results = await Promise.all(Array.from({ length: 50 }, () => cache.getOrLoad('product:hot', loader)));
  assert.equal(loader.calls, 1, `50 concurrent misses for one key called the loader ${loader.calls} times. Expected 1.`);
  assert.ok(results.every((r) => r?.hot === true), 'Every caller should receive the loaded value.');
});

test('cross-instance: concurrent misses in two processes call the loader once', async () => {
  const prefix = freshPrefix();
  const a = await makeCache({ prefix, redis: client() });
  const b = await makeCache({ prefix, redis: client() });
  const loader = loaderOf({ hot: true }, { delayMs: 200 });
  const calls = [];
  for (let i = 0; i < 20; i++) calls.push(a.cache.getOrLoad('product:hot', loader), b.cache.getOrLoad('product:hot', loader));
  const started = Date.now();
  const results = await Promise.all(calls);
  assert.equal(
    loader.calls,
    1,
    `Two cache instances with separate connections called the loader ${loader.calls} times for one key. The second instance should wait for the first.`,
  );
  assert.ok(results.every((r) => r?.hot === true), 'Every caller should receive the loaded value.');
  assert.ok(Date.now() - started < 3000, 'Waiting callers should get the value soon after it is stored.');
});

test('lock-expiry: a stuck loader in one process does not block another process for longer than lockTimeoutMs', async () => {
  const prefix = freshPrefix();
  const a = await makeCache({ prefix, redis: client(), lockTimeoutMs: 400 });
  const b = await makeCache({ prefix, redis: client(), lockTimeoutMs: 400 });
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const stuck = a.cache.getOrLoad('product:p1', loaderOf({ from: 'a' }, { gate }));
  await new Promise((resolve) => setTimeout(resolve, 80));

  const started = Date.now();
  const fromB = loaderOf({ from: 'b' });
  const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500).unref());
  let value;
  try {
    value = await Promise.race([b.cache.getOrLoad('product:p1', fromB), timer]);
  } catch {
    assert.fail('Process B was still waiting 2.5 s after process A got stuck while loading (lockTimeoutMs is 400).');
  } finally {
    release();
    await stuck.catch(() => undefined);
  }
  assert.deepEqual(value, { from: 'b' }, 'Process B should load the value itself once A has held the lock for lockTimeoutMs.');
  assert.ok(Date.now() - started >= 150, 'Process B should first wait for A, not load at once.');
});

test('keys-expire: every key the cache writes is under the prefix and has a TTL', async () => {
  const { cache, prefix } = await makeCache();
  await cache.getOrLoad('a', loaderOf(1));
  await cache.getOrLoad('b', loaderOf(null));
  await cache.invalidate('a');
  await cache.getOrLoad('a', loaderOf(2));
  await Promise.all(Array.from({ length: 5 }, () => cache.getOrLoad('c', loaderOf(3, { delayMs: 50 }))));
  await cache.invalidate('c');

  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await admin.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  assert.ok(keys.length > 0, 'No keys were found under the prefix you were given.');
  const immortal = [];
  for (const key of keys) if ((await admin.pttl(key)) < 0) immortal.push(key.slice(prefix.length));
  assert.deepEqual(immortal, [], `These keys never expire, so they pile up in Valkey: ${immortal.join(', ')}`);
});
