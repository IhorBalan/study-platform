import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConflictError, createShortener, RateLimitError, ValidationError } from '../shortener.mjs';

const roomy = { capacity: 1000, refillPerSecond: 1 };

test('a generated code resolves to the original url and counts hits', () => {
  const s = createShortener({ rateLimit: roomy });
  const { code } = s.shorten('https://example.com/a?b=c', { clientId: 'c1' });
  assert.match(code, /^[0-9A-Za-z]{7}$/);
  assert.equal(s.resolve(code), 'https://example.com/a?b=c');
  assert.equal(s.resolve(code), 'https://example.com/a?b=c');
  assert.equal(s.stats(code).hits, 2);
  assert.equal(s.resolve('missing'), null);
  assert.equal(s.stats('missing'), null);
});

test('only absolute http and https urls are accepted', () => {
  const s = createShortener({ rateLimit: roomy });
  for (const bad of ['', 'example.com', 'javascript:alert(1)', 'ftp://example.com', 42, `https://e.com/${'a'.repeat(2048)}`]) {
    assert.throws(() => s.shorten(bad, { clientId: 'c1' }), ValidationError, String(bad).slice(0, 30));
  }
});

test('aliases are validated and unique', () => {
  const s = createShortener({ rateLimit: roomy });
  assert.equal(s.shorten('https://example.com', { clientId: 'c1', alias: 'launch' }).code, 'launch');
  assert.throws(() => s.shorten('https://example.org', { clientId: 'c1', alias: 'launch' }), ConflictError);
  assert.throws(() => s.shorten('https://example.org', { clientId: 'c1', alias: 'no' }), ValidationError);
  assert.throws(() => s.shorten('https://example.org', { clientId: 'c1', alias: 'has space' }), ValidationError);
});

test('a client over its limit is rejected until tokens refill, other clients are not', () => {
  let now = 0;
  const s = createShortener({ clock: () => now, rateLimit: { capacity: 2, refillPerSecond: 1 } });
  s.shorten('https://a.example', { clientId: 'c1' });
  s.shorten('https://b.example', { clientId: 'c1' });
  assert.throws(
    () => s.shorten('https://c.example', { clientId: 'c1' }),
    (error) => error instanceof RateLimitError && error.retryAfterSeconds === 1,
  );
  assert.ok(s.shorten('https://c.example', { clientId: 'c2' }).code);
  now += 1000;
  assert.ok(s.shorten('https://c.example', { clientId: 'c1' }).code);
});
