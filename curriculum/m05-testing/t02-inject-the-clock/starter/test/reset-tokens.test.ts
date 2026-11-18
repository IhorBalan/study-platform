import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueResetToken, redeemResetToken } from '../src/reset-tokens.ts';

test('a fresh token can be redeemed', () => {
  const { token } = issueResetToken('user-1');
  assert.equal(redeemResetToken(token), 'user-1');
});

// How would you test that the token stops working after 15 minutes,
// without waiting 15 minutes? Or the rate limit, without sharing the
// Map above with every other test? Refactor first, then write the tests.
test.todo('a token expires after 15 minutes');
test.todo('a user gets at most 3 tokens per hour');
