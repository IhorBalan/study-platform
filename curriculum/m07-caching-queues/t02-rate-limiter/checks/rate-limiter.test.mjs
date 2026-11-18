// Checks for "A distributed rate limiter". Node built-ins only; ioredis and express
// come from the submission's node_modules. Node runs src/rate-limiter.ts directly
// by stripping its types. A fake clock drives the window, so nothing sleeps.
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
const ROOT = `${process.env.VALKEY_KEY_PREFIX ?? 'check_local:'}t02:${randomUUID().slice(0, 8)}:`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));

const clients = [];
function client() {
  assert.ok(VALKEY_URL, 'VALKEY_URL is not set for the check run. Start the lab Valkey with `pnpm lab up valkey`.');
  const { Redis } = requireFromSubmission('ioredis');
  const redis = new Redis(VALKEY_URL, { maxRetriesPerRequest: 2 });
  clients.push(redis);
  return redis;
}

let admin;
const servers = [];
after(async () => {
  for (const server of servers) server.close();
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
  const file = path.join(dir, 'src', 'rate-limiter.ts');
  assert.ok(existsSync(file), 'src/rate-limiter.ts is missing from the submission.');
  loaded ??= import(pathToFileURL(file).href);
  const mod = await loaded;
  assert.equal(typeof mod.createRateLimiter, 'function', 'src/rate-limiter.ts must export a function named createRateLimiter.');
  admin ??= client();
  return mod;
}

let counter = 0;
/** A limiter on a fresh prefix with a fake clock that starts on a whole second. */
async function setup(limit, windowMs, { redis, prefix, clock } = {}) {
  const { createRateLimiter } = await load();
  const c = clock ?? { t: 1_800_000_000_000 };
  const p = prefix ?? `${ROOT}${++counter}:`;
  const limiter = createRateLimiter({ redis: redis ?? admin, prefix: p, limit, windowMs, now: () => c.t });
  return { limiter, clock: c, prefix: p };
}

/**
 * Two limiter instances on separate connections, sharing a prefix and a clock,
 * like two API instances behind a load balancer. Requests alternate between them.
 */
async function pair(limit, windowMs) {
  const first = await setup(limit, windowMs, { redis: client() });
  const second = await setup(limit, windowMs, { redis: client(), prefix: first.prefix, clock: first.clock });
  let turn = 0;
  const limiter = { consume: (key) => (turn++ % 2 ? second : first).limiter.consume(key) };
  return { limiter, clock: first.clock, prefix: first.prefix };
}

const pick = (r) => ({ allowed: r?.allowed, remaining: r?.remaining, retryAfterMs: r?.retryAfterMs });

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('allows-up-to-limit: limit requests pass, the next is denied, remaining and retryAfterMs are exact', async () => {
  const { limiter } = await pair(3, 1000);
  const seen = [];
  for (let i = 0; i < 4; i++) seen.push(pick(await limiter.consume('client-a')));
  assert.deepEqual(
    seen,
    [
      { allowed: true, remaining: 2, retryAfterMs: 0 },
      { allowed: true, remaining: 1, retryAfterMs: 0 },
      { allowed: true, remaining: 0, retryAfterMs: 0 },
      { allowed: false, remaining: 0, retryAfterMs: 1000 },
    ],
    'Three requests at the same instant with limit 3 and a 1000 ms window.',
  );
});

test('rolling-window: the window slides with the clock instead of resetting on fixed boundaries', async () => {
  const { limiter, clock } = await pair(5, 1000);
  const start = clock.t;
  clock.t = start + 900;
  for (let i = 0; i < 5; i++) assert.equal((await limiter.consume('c')).allowed, true, 'The first 5 requests should pass.');
  clock.t = start + 1100;
  const burst = pick(await limiter.consume('c'));
  assert.deepEqual(
    burst,
    { allowed: false, remaining: 0, retryAfterMs: 800 },
    '5 requests at t=900 ms and 1 more at t=1100 ms are 6 within 200 ms. A fixed window that resets at t=1000 lets this through.',
  );
  clock.t = start + 1900;
  assert.equal((await limiter.consume('c')).allowed, true, 'At t=1900 ms the requests from t=900 ms have left the window.');

  // Requests leave the window one by one.
  const { limiter: l2, clock: c2 } = await pair(3, 1000);
  const s2 = c2.t;
  await l2.consume('c');
  await l2.consume('c');
  c2.t = s2 + 500;
  await l2.consume('c');
  c2.t = s2 + 999;
  assert.deepEqual(pick(await l2.consume('c')), { allowed: false, remaining: 0, retryAfterMs: 1 }, 'At t=999 ms the window is still full.');
  c2.t = s2 + 1000;
  assert.equal((await l2.consume('c')).allowed, true, 'At t=1000 ms the two requests from t=0 have left the window.');
  assert.equal((await l2.consume('c')).allowed, true, 'At t=1000 ms two slots are free.');
  assert.deepEqual(
    pick(await l2.consume('c')),
    { allowed: false, remaining: 0, retryAfterMs: 500 },
    'The third request at t=1000 ms should wait for the one from t=500 ms.',
  );
});

test('denied-not-counted: rejected requests do not extend the block', async () => {
  const { limiter, clock } = await pair(2, 1000);
  const start = clock.t;
  await limiter.consume('c');
  await limiter.consume('c');
  for (let i = 1; i <= 9; i++) {
    clock.t = start + i * 100;
    assert.equal((await limiter.consume('c')).allowed, false, `A third request at t=${i * 100} ms should be denied.`);
  }
  clock.t = start + 1000;
  assert.equal(
    (await limiter.consume('c')).allowed,
    true,
    'After the window has passed the client should be allowed again. Denied requests were counted against it.',
  );
});

test('same-millisecond: requests at the same instant each count', async () => {
  const { limiter } = await pair(5, 1000);
  let allowed = 0;
  for (let i = 0; i < 10; i++) if ((await limiter.consume('c')).allowed) allowed += 1;
  assert.equal(allowed, 5, `10 requests in the same millisecond with limit 5: ${allowed} were allowed.`);
});

test('atomic: two instances on separate connections never allow more than the limit together', async () => {
  const prefix = `${ROOT}${++counter}:`;
  const clock = { t: 1_800_000_000_000 };
  const a = await setup(10, 60_000, { redis: client(), prefix, clock });
  const b = await setup(10, 60_000, { redis: client(), prefix, clock });
  for (const round of [0, 1]) {
    clock.t += round * 120_000;
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => (i % 2 ? a : b).limiter.consume('shared-client')));
    const allowed = results.filter((r) => r.allowed).length;
    assert.equal(
      allowed,
      10,
      `60 concurrent requests through two API instances with limit 10 allowed ${allowed}. Reading the count and adding the request must be one atomic step.`,
    );
  }
});

test('keys: one key per client under the prefix, with a TTL no longer than the window', async () => {
  const { limiter, prefix } = await pair(1, 5000);
  assert.equal((await limiter.consume('user:1')).allowed, true);
  assert.equal((await limiter.consume('user:1')).allowed, false);
  assert.equal((await limiter.consume('user:2')).allowed, true, 'Another client should have a limit of its own.');
  for (const id of ['user:1', 'user:2']) {
    const ttl = await admin.pttl(`${prefix}${id}`);
    assert.ok(ttl !== -2, `Expected the client's state under the key "<prefix>${id}", found nothing there.`);
    assert.ok(ttl > 0 && ttl <= 5000, `The key for ${id} should expire within windowMs (5000), its PTTL is ${ttl}.`);
  }
});

async function serve(limiter) {
  const mod = await load();
  assert.equal(typeof mod.rateLimitMiddleware, 'function', 'src/rate-limiter.ts must export a function named rateLimitMiddleware.');
  const express = requireFromSubmission('express');
  const app = express();
  let handled = 0;
  app.use(mod.rateLimitMiddleware(limiter, (req) => String(req.headers['x-client-id'] ?? 'anonymous')));
  app.get('/things', (_req, res) => {
    handled += 1;
    res.json({ ok: true });
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise((resolve) => server.once('listening', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, handled: () => handled };
}

const get = (base, id) => fetch(`${base}/things`, { headers: id ? { 'x-client-id': id } : {}, signal: AbortSignal.timeout(5000) });

test('http-429: the middleware passes allowed requests on and answers 429 with Retry-After in whole seconds', async () => {
  const { limiter } = await pair(2, 2500);
  const app = await serve(limiter);
  for (let i = 0; i < 2; i++) {
    const ok = await get(app.base, 'k1');
    assert.equal(ok.status, 200, `Request ${i + 1} of 2 should reach the handler, got ${ok.status}.`);
  }
  const limited = await get(app.base, 'k1');
  assert.equal(limited.status, 429, `The third request within the window should get 429, got ${limited.status}.`);
  assert.equal(
    limited.headers.get('retry-after'),
    '3',
    `Retry-After should be the wait in whole seconds, rounded up (2500 ms is "3"). Got ${limited.headers.get('retry-after')}.`,
  );
  assert.equal(app.handled(), 2, 'The handler must not run for a limited request.');
  assert.equal((await get(app.base, 'k2')).status, 200, 'Another client id should still pass.');
});

test('fail-open: when the limiter throws, the request still reaches the handler', async () => {
  let asked = 0;
  const app = await serve({
    consume: async () => {
      asked += 1;
      throw new Error('connect ECONNREFUSED 127.0.0.1:6379');
    },
  });
  const res = await get(app.base, 'k1');
  assert.equal(asked, 1, 'The middleware should ask the limiter once per request.');
  assert.equal(res.status, 200, `With Valkey down the API should keep serving (fail open), got ${res.status}.`);
  assert.equal(app.handled(), 1);
});
