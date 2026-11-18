import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createShortener } from '../shortener.mjs';

// Run with `npm test`. Add tests for every rule in task.md, including the rate limit.

test('a generated code resolves to the original url', () => {
  const s = createShortener();
  const { code } = s.shorten('https://example.com', { clientId: 'c1' });
  assert.equal(s.resolve(code), 'https://example.com');
});

// TODO: invalid urls and aliases, alias conflicts, hit counts, stats.
// TODO: a client over its limit is rejected until tokens refill (inject a clock).
// TODO: the HTTP status codes, against a server listening on port 0.
