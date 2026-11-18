// A cache-aside helper on Valkey: TTLs, negative caching, invalidation that
// cannot be undone by a slow load, and stampede protection inside one process
// (single flight) and across processes (a short lock in Valkey).
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface CacheOptions {
  redis: Redis;
  /** Every key this cache writes starts with this string. */
  prefix: string;
  ttlSeconds: number;
  /** TTL for a cached "not found" (a loader that returned null). */
  negativeTtlSeconds: number;
  /** How long one loader may hold the lock before others stop waiting. Default 5000. */
  lockTimeoutMs?: number;
}

export type Loader<T> = () => Promise<T | null>;

export interface Cache {
  getOrLoad<T>(key: string, loader: Loader<T>): Promise<T | null>;
  invalidate(key: string): Promise<void>;
}

const POLL_MS = 25;

// Stores the value only if nobody invalidated the key since the load began,
// then releases the lock if this caller still owns it. One round trip, atomic.
// KEYS: value, version, lock. ARGV: version seen, json, ttl seconds, lock token.
const STORE_IF_CURRENT = `
local current = redis.call('GET', KEYS[2]) or ''
local stored = 0
if current == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
  stored = 1
end
if redis.call('GET', KEYS[3]) == ARGV[4] then
  redis.call('DEL', KEYS[3])
end
return stored
`;

// Deletes the lock only if it is still ours. A plain DEL could remove a lock
// that expired and was taken by someone else in the meantime.
const RELEASE_LOCK = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

// A new random version makes every load that started earlier unable to store.
// KEYS: value, version. ARGV: new version, version ttl seconds.
const INVALIDATE = `
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[2])
redis.call('DEL', KEYS[1])
return 1
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createCache(options: CacheOptions): Cache {
  const { redis, prefix, ttlSeconds, negativeTtlSeconds } = options;
  const lockTimeoutMs = options.lockTimeoutMs ?? 5000;
  // The version marker must outlive any load that could still be running.
  const versionTtlSeconds = ttlSeconds + Math.ceil(lockTimeoutMs / 1000) + 60;
  const inFlight = new Map<string, Promise<unknown>>();

  const keys = (key: string) => ({
    value: `${prefix}${key}`,
    version: `${prefix}${key}:version`,
    lock: `${prefix}${key}:lock`,
  });

  async function readValue<T>(valueKey: string): Promise<{ hit: true; value: T | null } | { hit: false }> {
    const raw = await redis.get(valueKey);
    // A stored "null" is a negative entry: a hit whose value is null.
    return raw === null ? { hit: false } : { hit: true, value: JSON.parse(raw) as T | null };
  }

  async function load<T>(key: string, loader: Loader<T>, token: string | null): Promise<T | null> {
    const k = keys(key);
    const versionSeen = (await redis.get(k.version)) ?? '';
    let value: T | null;
    try {
      value = await loader();
    } catch (error) {
      // Errors are never cached. Let the next caller try again straight away.
      if (token) await redis.eval(RELEASE_LOCK, 1, k.lock, token);
      throw error;
    }
    const ttl = value === null ? negativeTtlSeconds : ttlSeconds;
    await redis.eval(STORE_IF_CURRENT, 3, k.value, k.version, k.lock, versionSeen, JSON.stringify(value), ttl, token ?? '');
    return value;
  }

  async function fetch<T>(key: string, loader: Loader<T>): Promise<T | null> {
    const k = keys(key);
    const deadline = Date.now() + lockTimeoutMs;
    for (;;) {
      const cached = await readValue<T>(k.value);
      if (cached.hit) return cached.value;

      const token = randomUUID();
      const acquired = (await redis.set(k.lock, token, 'PX', lockTimeoutMs, 'NX')) === 'OK';
      if (acquired) {
        // Someone may have stored the value between our read and the lock.
        const again = await readValue<T>(k.value);
        if (again.hit) {
          await redis.eval(RELEASE_LOCK, 1, k.lock, token);
          return again.value;
        }
        return load(key, loader, token);
      }
      // Another process is loading. Wait for its value, but not forever:
      // a crashed holder's lock expires, and after the deadline we load anyway.
      if (Date.now() >= deadline) return load(key, loader, null);
      await sleep(POLL_MS);
    }
  }

  return {
    getOrLoad<T>(key: string, loader: Loader<T>): Promise<T | null> {
      const existing = inFlight.get(key);
      if (existing) return existing as Promise<T | null>;
      const promise = fetch(key, loader).finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },

    async invalidate(key: string): Promise<void> {
      const k = keys(key);
      await redis.eval(INVALIDATE, 2, k.value, k.version, randomUUID(), versionTtlSeconds);
    },
  };
}
