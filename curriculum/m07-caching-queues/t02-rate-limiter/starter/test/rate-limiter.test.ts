// Tests for the rate limiter against a real Valkey. Run them with `npm test`.
// Pass a fake clock (`now`) so that no test has to sleep.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import { createRateLimiter } from '../src/rate-limiter.ts';

const url = process.env.VALKEY_URL ?? 'redis://localhost:56379';
// A prefix of its own per run, so runs never see each other's keys.
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}rl-test-${randomUUID()}:`;

let redis: Redis;

before(() => {
  redis = new Redis(url);
});

after(async () => {
  // TODO: delete every key under runPrefix.
  await redis.quit();
});

test('allows up to the limit, then denies', async () => {
  const clock = { t: 1_000_000 };
  const limiter = createRateLimiter({ redis, prefix: `${runPrefix}${randomUUID()}:`, limit: 2, windowMs: 1000, now: () => clock.t });
  assert.equal((await limiter.consume('u1')).allowed, true);
  assert.equal((await limiter.consume('u1')).allowed, true);
  assert.equal((await limiter.consume('u1')).allowed, false);
});

// TODO: remaining and retryAfterMs.
// TODO: the window slides (a burst across a window boundary).
// TODO: denied requests do not count; same-millisecond requests do.
// TODO: separate clients, two instances racing, the key's TTL.
// TODO: the middleware: 429, Retry-After, and a limiter that throws.
