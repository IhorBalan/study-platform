// Checks for the link shortener take-home. Node built-ins only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const ROOMY = Object.freeze({ capacity: 1_000_000, refillPerSecond: 1 });
const T0 = Date.parse('2026-11-18T09:00:00Z');

let core;
async function loadCore() {
  core ??= import(pathToFileURL(path.join(submissionDir, 'shortener.mjs')).href);
  const mod = await core;
  assert.equal(typeof mod.createShortener, 'function', 'shortener.mjs must export createShortener');
  for (const name of ['ValidationError', 'ConflictError', 'RateLimitError']) {
    assert.equal(typeof mod[name], 'function', `shortener.mjs must export the class ${name}`);
  }
  return mod;
}

function expectThrow(fn, ErrorType, what) {
  let outcome;
  try {
    const value = fn();
    outcome = `it returned ${JSON.stringify(value)}`;
  } catch (error) {
    if (error instanceof ErrorType) return error;
    outcome = `it threw ${error?.name ?? typeof error}: ${error?.message ?? error}`;
  }
  assert.fail(`${what}: expected a ${ErrorType.name}, but ${outcome}`);
}

test('validation: invalid urls, aliases and client ids are rejected with ValidationError', async () => {
  const { createShortener, ValidationError } = await loadCore();
  const s = createShortener({ rateLimit: ROOMY });
  const badUrls = [
    ['an empty string', ''],
    ['a number', 42],
    ['undefined', undefined],
    ['a relative url', '/just/a/path'],
    ['a url without a scheme', 'example.com'],
    ['a javascript: url', 'javascript:alert(1)'],
    ['a data: url', 'data:text/html,<script>alert(1)</script>'],
    ['an ftp: url', 'ftp://files.example.com/a'],
    ['a url longer than 2048 characters', `https://example.com/${'a'.repeat(2040)}`],
  ];
  for (const [label, url] of badUrls) {
    expectThrow(() => s.shorten(url, { clientId: 'v1' }), ValidationError, `shorten with ${label}`);
  }
  const okUrl = `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`;
  assert.equal(okUrl.length, 2048);
  assert.ok(s.shorten(okUrl, { clientId: 'v1' })?.code, 'A url of exactly 2048 characters must be accepted');
  assert.ok(s.shorten('http://localhost:8080/x?y=1#z', { clientId: 'v1' })?.code, 'An http url with a port, query and hash must be accepted');

  for (const alias of ['abc', 'a'.repeat(33), 'has space', 'semi;colon', 'ünï', 1234]) {
    expectThrow(
      () => s.shorten('https://example.com', { clientId: 'v1', alias }),
      ValidationError,
      `shorten with alias ${JSON.stringify(alias)}`,
    );
  }
  for (const clientId of [undefined, '', 7]) {
    expectThrow(
      () => s.shorten('https://example.com', { clientId }),
      ValidationError,
      `shorten with clientId ${JSON.stringify(clientId)}`,
    );
  }
});

test('codes: generated codes are 7-character base62 and unique, aliases are honoured and never reused', async () => {
  const { createShortener, ConflictError } = await loadCore();
  const s = createShortener({ rateLimit: ROOMY });
  const seen = new Set();
  for (let i = 0; i < 3000; i++) {
    const result = s.shorten(`https://example.com/${i}`, { clientId: 'codes' });
    assert.equal(typeof result?.code, 'string', `shorten must return { code, url }, got ${JSON.stringify(result)}`);
    assert.match(result.code, /^[0-9A-Za-z]{7}$/, `Generated codes must be 7 characters of [0-9A-Za-z], got "${result.code}"`);
    assert.equal(result.url, `https://example.com/${i}`, 'shorten must return the url it stored');
    seen.add(result.code);
  }
  assert.equal(seen.size, 3000, `3000 links produced only ${seen.size} distinct codes`);

  const custom = s.shorten('https://example.com/launch', { clientId: 'codes', alias: 'Launch_2026' });
  assert.equal(custom?.code, 'Launch_2026', 'A valid alias must be used as the code');
  expectThrow(
    () => s.shorten('https://example.com/other', { clientId: 'codes', alias: 'Launch_2026' }),
    ConflictError,
    'Reusing an alias',
  );
  const generated = [...seen][0];
  expectThrow(
    () => s.shorten('https://example.com/other', { clientId: 'codes', alias: generated }),
    ConflictError,
    'An alias equal to an existing generated code',
  );
  assert.equal(s.resolve('Launch_2026'), 'https://example.com/launch', 'The alias must still point at its first url');
});

test('resolve-stats: resolve returns the url and counts hits, stats reports them, unknown codes give null', async () => {
  const { createShortener } = await loadCore();
  let now = T0;
  const s = createShortener({ clock: () => now, rateLimit: ROOMY });
  const { code } = s.shorten('https://example.com/a?b=1', { clientId: 'r1' });
  now += 60_000;
  assert.equal(s.resolve(code), 'https://example.com/a?b=1', 'resolve must return the stored url');
  s.resolve(code);
  s.resolve(code);
  const stats = s.stats(code);
  assert.deepEqual(
    stats,
    { code, url: 'https://example.com/a?b=1', hits: 3, createdAt: new Date(T0).toISOString() },
    'stats must return { code, url, hits, createdAt } with createdAt from the injected clock at creation time',
  );
  assert.equal(s.stats(code).hits, 3, 'stats must not count as a hit');
  assert.equal(s.resolve('zzzzzzz'), null, 'resolve of an unknown code must return null');
  assert.equal(s.stats('zzzzzzz'), null, 'stats of an unknown code must return null');
});

test('rate-limit: a token bucket per client, with refill, a cap and retryAfterSeconds', async () => {
  const { createShortener, RateLimitError, ValidationError } = await loadCore();
  let now = T0;
  const s = createShortener({ clock: () => now, rateLimit: { capacity: 3, refillPerSecond: 0.5 } });
  for (let i = 0; i < 3; i++) s.shorten(`https://example.com/${i}`, { clientId: 'alice' });
  const first = expectThrow(
    () => s.shorten('https://example.com/4', { clientId: 'alice' }),
    RateLimitError,
    'The 4th link within the same instant with capacity 3',
  );
  assert.equal(first.retryAfterSeconds, 2, `With an empty bucket and 0.5 tokens per second, retryAfterSeconds must be 2, got ${first.retryAfterSeconds}`);
  assert.ok(s.shorten('https://example.com/b', { clientId: 'bob' })?.code, 'Another client must not be limited by alice');

  now += 1000;
  const second = expectThrow(
    () => s.shorten('https://example.com/5', { clientId: 'alice' }),
    RateLimitError,
    'After 1 s at 0.5 tokens per second (half a token)',
  );
  assert.equal(second.retryAfterSeconds, 1, `With half a token left to refill, retryAfterSeconds must be 1, got ${second.retryAfterSeconds}`);
  now += 1000;
  assert.ok(s.shorten('https://example.com/6', { clientId: 'alice' })?.code, 'After 2 s one token has refilled; the request must succeed');
  expectThrow(() => s.shorten('https://example.com/7', { clientId: 'alice' }), RateLimitError, 'Right after using the refilled token');

  now += 60 * 60 * 1000;
  let allowed = 0;
  for (let i = 0; i < 6; i++) {
    try {
      s.shorten(`https://example.com/later/${i}`, { clientId: 'alice' });
      allowed += 1;
    } catch (error) {
      if (!(error instanceof RateLimitError)) throw error;
    }
  }
  assert.equal(allowed, 3, `After an hour idle the bucket must be capped at capacity 3, but ${allowed} links were allowed`);

  for (let i = 0; i < 3; i++) {
    expectThrow(() => s.shorten('javascript:alert(1)', { clientId: 'carol' }), ValidationError, 'An invalid url');
  }
  expectThrow(
    () => s.shorten('https://example.com/ok', { clientId: 'carol' }),
    RateLimitError,
    'After 3 invalid requests with capacity 3 (invalid requests also cost a token)',
  );
});

test('http-api: status codes, problem documents, Retry-After and redirects', async () => {
  const { createShortener } = await loadCore();
  const serverMod = await import(pathToFileURL(path.join(submissionDir, 'server.mjs')).href);
  assert.equal(typeof serverMod.createApp, 'function', 'server.mjs must export createApp');
  const server = serverMod.createApp(createShortener({ rateLimit: { capacity: 2, refillPerSecond: 0.001 } }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, clientId) =>
    fetch(`${base}/links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-client-id': clientId },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
  const get = (p) => fetch(`${base}${p}`, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  async function expectProblem(res, status, what) {
    assert.equal(res.status, status, `${what}: expected status ${status}, got ${res.status}`);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/, `${what}: expected Content-Type application/problem+json`);
    const body = await res.json();
    assert.equal(body.status, status, `${what}: the problem document's "status" must be ${status}`);
    assert.equal(typeof body.title, 'string', `${what}: the problem document needs a "title"`);
  }

  try {
    const created = await post({ url: 'https://example.com/http' }, 'h1');
    assert.equal(created.status, 201, `POST /links with a valid url: expected 201, got ${created.status}`);
    const { code, url } = await created.json();
    assert.match(code ?? '', /^[0-9A-Za-z]{7}$/, 'POST /links must answer { code, url }');
    assert.equal(url, 'https://example.com/http');

    const redirect = await get(`/${code}`);
    assert.equal(redirect.status, 302, `GET /${code}: expected 302, got ${redirect.status}`);
    assert.equal(redirect.headers.get('location'), 'https://example.com/http', 'The redirect must point at the stored url');

    const stats = await get(`/links/${code}/stats`);
    assert.equal(stats.status, 200, `GET /links/:code/stats: expected 200, got ${stats.status}`);
    assert.equal((await stats.json()).hits, 1, 'Stats after one redirect must show 1 hit');

    await expectProblem(await get('/unknown1'), 404, 'GET of an unknown code');
    await expectProblem(await get('/links/unknown1/stats'), 404, 'Stats of an unknown code');
    await expectProblem(await post({ url: 'javascript:alert(1)' }, 'h2'), 400, 'POST /links with a javascript: url');
    await expectProblem(await post('{"url": ', 'h3'), 400, 'POST /links with a body that is not JSON');

    const aliased = await post({ url: 'https://example.com/a', alias: 'my-alias' }, 'h4');
    assert.equal(aliased.status, 201, `POST /links with a free alias: expected 201, got ${aliased.status}`);
    await expectProblem(await post({ url: 'https://example.com/b', alias: 'my-alias' }, 'h5'), 409, 'POST /links with a taken alias');

    await post({ url: 'https://example.com/1' }, 'limited');
    await post({ url: 'https://example.com/2' }, 'limited');
    const limited = await post({ url: 'https://example.com/3' }, 'limited');
    const retryAfter = limited.headers.get('retry-after');
    await expectProblem(limited, 429, 'The third POST /links from one client with capacity 2');
    assert.ok(/^\d+$/.test(retryAfter ?? '') && Number(retryAfter) >= 1, `A 429 must carry Retry-After in whole seconds, got ${retryAfter}`);
    const otherClient = await post({ url: 'https://example.com/4' }, 'someone-else');
    assert.equal(otherClient.status, 201, 'The limit must be per X-Client-Id: another client must still get 201');
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});
