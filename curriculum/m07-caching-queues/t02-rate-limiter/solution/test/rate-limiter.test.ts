// Tests for the rate limiter against a real Valkey, with a fake clock so that
// no test has to sleep. Each test gets its own prefix; after() removes them all.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { Redis } from 'ioredis';
import express from 'express';
import { createRateLimiter, rateLimitMiddleware, type RateLimiter } from '../src/rate-limiter.ts';

const url = process.env.VALKEY_URL ?? 'redis://localhost:56379';
const runPrefix = `${process.env.VALKEY_KEY_PREFIX ?? 'local:'}rl-test-${randomUUID()}:`;

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

function setup(limit: number, windowMs: number, client = redis) {
  const clock = { t: 1_000_000 };
  const prefix = `${runPrefix}${randomUUID()}:`;
  const limiter = createRateLimiter({ redis: client, prefix, limit, windowMs, now: () => clock.t });
  return { clock, prefix, limiter };
}

test('allows up to the limit, then denies with the time until a slot frees', async () => {
  const { limiter } = setup(3, 1000);
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await limiter.consume('u1'));
  assert.deepEqual(
    results.map((r) => [r.allowed, r.remaining]),
    [[true, 2], [true, 1], [true, 0], [false, 0]],
  );
  assert.equal(results[3].retryAfterMs, 1000);
});

test('the window slides: a burst across a window boundary is still limited', async () => {
  const { clock, limiter } = setup(5, 1000);
  clock.t += 900;
  for (let i = 0; i < 5; i++) assert.equal((await limiter.consume('u1')).allowed, true);
  clock.t += 200;
  const denied = await limiter.consume('u1');
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 800);
  clock.t += 800;
  assert.equal((await limiter.consume('u1')).allowed, true);
});

test('old requests leave the window one by one', async () => {
  const { clock, limiter } = setup(3, 1000);
  await limiter.consume('u1');
  await limiter.consume('u1');
  clock.t += 500;
  await limiter.consume('u1');
  clock.t += 499;
  assert.equal((await limiter.consume('u1')).retryAfterMs, 1);
  clock.t += 1;
  assert.equal((await limiter.consume('u1')).allowed, true);
  assert.equal((await limiter.consume('u1')).allowed, true);
  const third = await limiter.consume('u1');
  assert.equal(third.allowed, false);
  assert.equal(third.retryAfterMs, 500);
});

test('denied requests do not count', async () => {
  const { clock, limiter } = setup(2, 1000);
  await limiter.consume('u1');
  await limiter.consume('u1');
  for (let i = 0; i < 9; i++) {
    clock.t += 100;
    assert.equal((await limiter.consume('u1')).allowed, false);
  }
  clock.t += 100;
  assert.equal((await limiter.consume('u1')).allowed, true);
});

test('requests in the same millisecond each count', async () => {
  const { limiter } = setup(5, 1000);
  let allowed = 0;
  for (let i = 0; i < 10; i++) if ((await limiter.consume('u1')).allowed) allowed += 1;
  assert.equal(allowed, 5);
});

test('keys are independent', async () => {
  const { limiter } = setup(1, 1000);
  assert.equal((await limiter.consume('u1')).allowed, true);
  assert.equal((await limiter.consume('u1')).allowed, false);
  assert.equal((await limiter.consume('u2')).allowed, true);
});

test('two instances racing never allow more than the limit', async () => {
  const { clock, prefix, limiter: a } = setup(10, 60_000);
  const b = createRateLimiter({ redis: other, prefix, limit: 10, windowMs: 60_000, now: () => clock.t });
  const results = await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).consume('u1')));
  assert.equal(results.filter((r) => r.allowed).length, 10);
});

test('the key expires after the window', async () => {
  const { prefix, limiter } = setup(3, 1000);
  await limiter.consume('u1');
  const ttl = await redis.pttl(`${prefix}u1`);
  assert.ok(ttl > 0 && ttl <= 1000, `pttl was ${ttl}`);
});

async function serve(limiter: RateLimiter) {
  const app = express();
  app.use(rateLimitMiddleware(limiter, (req) => String(req.headers['x-client-id'] ?? 'anonymous')));
  app.get('/', (_req, res) => {
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${port}` };
}

test('the middleware answers 429 with Retry-After in whole seconds', async () => {
  const { limiter } = setup(1, 2500);
  const { server, base } = await serve(limiter);
  try {
    const headers = { 'x-client-id': 'c1' };
    assert.equal((await fetch(base, { headers })).status, 200);
    const limited = await fetch(base, { headers });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('retry-after'), '3');
  } finally {
    server.close();
  }
});

test('the middleware lets requests through when the limiter fails', async () => {
  const broken: RateLimiter = { consume: async () => { throw new Error('connection refused'); } };
  const { server, base } = await serve(broken);
  try {
    assert.equal((await fetch(base)).status, 200);
  } finally {
    server.close();
  }
});
