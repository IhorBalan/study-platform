// A cache-aside helper on Valkey. The interface is fixed; the behaviour is yours.
// Read the task brief for the exact rules the checks hold you to.
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

export function createCache(options: CacheOptions): Cache {
  const { redis, prefix } = options;

  return {
    async getOrLoad<T>(key: string, loader: Loader<T>): Promise<T | null> {
      const raw = await redis.get(`${prefix}${key}`);
      if (raw !== null) return JSON.parse(raw) as T | null;

      const value = await loader();
      // TODO: expire the value (ttlSeconds, or negativeTtlSeconds for null).
      // TODO: do not store a value whose load started before an invalidate.
      // TODO: when many callers miss at once, in this process or another one, call the loader once.
      await redis.set(`${prefix}${key}`, JSON.stringify(value));
      return value;
    },

    async invalidate(key: string): Promise<void> {
      // TODO: remove the value, and make sure a load already in progress cannot put an old value back.
      void key;
    },
  };
}
