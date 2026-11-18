// A sliding-window-log rate limiter on Valkey, shared by every API instance,
// and an Express-style middleware that answers 429 with Retry-After.
import { randomUUID } from 'node:crypto';
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

// One sorted set per client: each allowed request is a member scored by its time.
// The whole decision runs inside Valkey, so two API instances cannot both see
// "one slot left" and both take it.
// KEYS[1]: the set. ARGV: now, windowMs, limit, a unique member.
const SLIDING_WINDOW = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, ARGV[4])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, tonumber(oldest[2]) + window - now}
`;

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { redis, prefix, limit, windowMs } = options;
  const now = options.now ?? Date.now;

  return {
    async consume(key: string): Promise<RateLimitResult> {
      const at = now();
      // The member must be unique: two requests in the same millisecond are two requests.
      const member = `${at}-${randomUUID()}`;
      const [allowed, remaining, retryAfterMs] = (await redis.eval(
        SLIDING_WINDOW,
        1,
        `${prefix}${key}`,
        at,
        windowMs,
        limit,
        member,
      )) as [number, number, number];
      return { allowed: allowed === 1, remaining, retryAfterMs };
    },
  };
}

/**
 * Rejects requests over the limit with 429 and Retry-After. If Valkey is
 * unreachable it lets the request through: for this API an outage of the
 * limiter must not become an outage of the product.
 */
export function rateLimitMiddleware(limiter: RateLimiter, keyFor: (req: Request) => string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    limiter.consume(keyFor(req)).then(
      (result) => {
        if (result.allowed) {
          res.setHeader('X-RateLimit-Remaining', String(result.remaining));
          next();
          return;
        }
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))));
        res.status(429).type('application/problem+json').json({
          type: 'about:blank',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Rate limit exceeded. Retry after the time in the Retry-After header.',
        });
      },
      (error: unknown) => {
        console.warn('rate limiter unavailable, allowing request', error);
        next();
      },
    );
  };
}
