// The API's rate limiter. Today it counts in a Map inside each process, in fixed
// windows. Behind a load balancer with three instances, every client gets three
// times its limit, and a burst at the end of one window plus the start of the next
// gets twice. Move it to Valkey as a sliding window. Keep the exported names and types.
import type { NextFunction, Request, Response } from 'express';
import type { Redis } from 'ioredis';

export interface RateLimiterOptions {
  redis: Redis;
  /** Every key the limiter writes starts with this string. */
  prefix: string;
  /** Requests allowed in any window of windowMs. */
  limit: number;
  windowMs: number;
  /** The clock, in milliseconds. Default Date.now. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Requests left in the current window after this one. 0 when denied. */
  remaining: number;
  /** 0 when allowed. Otherwise how long until one more request would be allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  // TODO: replace this per-process fixed window with a sliding window in Valkey (options.redis).
  const windows = new Map<string, { start: number; count: number }>();

  return {
    async consume(key: string): Promise<RateLimitResult> {
      const at = now();
      const start = Math.floor(at / windowMs) * windowMs;
      let window = windows.get(key);
      if (!window || window.start !== start) {
        window = { start, count: 0 };
        windows.set(key, window);
      }
      if (window.count < limit) {
        window.count += 1;
        return { allowed: true, remaining: limit - window.count, retryAfterMs: 0 };
      }
      return { allowed: false, remaining: 0, retryAfterMs: start + windowMs - at };
    },
  };
}

export function rateLimitMiddleware(limiter: RateLimiter, keyFor: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // TODO: consume a slot for keyFor(req). Over the limit: 429 with Retry-After.
    // TODO: decide what happens when the limiter itself fails (see the brief).
    void limiter;
    void keyFor;
    void res;
    next();
  };
}
