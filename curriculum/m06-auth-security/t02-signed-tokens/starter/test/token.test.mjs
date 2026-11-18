import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueToken, verifyToken } from '../token.mjs';

// Run with `npm test`. Pass `now` so expiry tests do not depend on the clock.
const secret = 'test-secret-0123456789-abcdefghijklmnop';
const now = 1_800_000_000;

test('a fresh token verifies and returns its claims', () => {
  const token = issueToken({ sub: 'u1' }, { secret, expiresInSeconds: 60, now });
  assert.equal(verifyToken(token, { secret, now }).sub, 'u1');
});

// TODO: a changed payload and a wrong secret are bad signatures.
// TODO: alg "none" and other algorithms are refused.
// TODO: expiry, audience, garbage input and short secrets.
