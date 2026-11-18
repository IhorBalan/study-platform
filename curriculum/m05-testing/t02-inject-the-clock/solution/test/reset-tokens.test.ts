import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import {
  createResetTokens,
  RATE_WINDOW_MS,
  RateLimitedError,
  type ResetTokens,
  TOKEN_TTL_MS,
} from '../src/reset-tokens.ts';
import { FakeClock, sequentialIds } from './fakes.ts';

const MINUTE = 60 * 1000;

let clock: FakeClock;
let tokens: ResetTokens;

beforeEach(() => {
  clock = new FakeClock();
  tokens = createResetTokens({ clock, randomId: sequentialIds() });
});

describe('issue', () => {
  test('returns the generated id as the token', () => {
    assert.equal(tokens.issue('user-1').token, 'tok-1');
    assert.equal(tokens.issue('user-1').token, 'tok-2');
  });

  test('expires 15 minutes after issue, by the injected clock', () => {
    const { expiresAt } = tokens.issue('user-1');
    assert.equal(expiresAt, clock.now() + 15 * MINUTE);
    assert.equal(TOKEN_TTL_MS, 15 * MINUTE);
  });
});

describe('redeem', () => {
  test('returns the user id for a fresh token', () => {
    const { token } = tokens.issue('user-1');
    assert.equal(tokens.redeem(token), 'user-1');
  });

  test('still works one millisecond before expiry', () => {
    const { token } = tokens.issue('user-1');
    clock.advance(15 * MINUTE - 1);
    assert.equal(tokens.redeem(token), 'user-1');
  });

  test('fails at the exact moment of expiry', () => {
    const { token } = tokens.issue('user-1');
    clock.advance(15 * MINUTE);
    assert.equal(tokens.redeem(token), null);
  });

  test('works only once', () => {
    const { token } = tokens.issue('user-1');
    assert.equal(tokens.redeem(token), 'user-1');
    assert.equal(tokens.redeem(token), null);
  });

  test('returns null for an unknown token', () => {
    assert.equal(tokens.redeem('no-such-token'), null);
  });
});

describe('rate limit', () => {
  test('allows 3 tokens per user and refuses the 4th', () => {
    for (let i = 0; i < 3; i++) tokens.issue('user-1');
    assert.throws(() => tokens.issue('user-1'), RateLimitedError);
  });

  test('counts each user separately', () => {
    for (let i = 0; i < 3; i++) tokens.issue('user-1');
    assert.doesNotThrow(() => tokens.issue('user-2'));
  });

  test('frees a slot exactly 60 minutes after the oldest token', () => {
    tokens.issue('user-1');
    clock.advance(10 * MINUTE);
    tokens.issue('user-1');
    tokens.issue('user-1');

    clock.advance(RATE_WINDOW_MS - 10 * MINUTE - 1);
    assert.throws(() => tokens.issue('user-1'), RateLimitedError, 'one millisecond early');

    clock.advance(1);
    assert.doesNotThrow(() => tokens.issue('user-1'));
    assert.throws(() => tokens.issue('user-1'), RateLimitedError, 'only one slot was freed');
  });

  test('redeeming a token does not free a slot', () => {
    for (let i = 0; i < 3; i++) tokens.redeem(tokens.issue('user-1').token);
    assert.throws(() => tokens.issue('user-1'), RateLimitedError);
  });
});

test('separate instances do not share state', () => {
  const other = createResetTokens({ clock, randomId: sequentialIds('other') });
  const { token } = tokens.issue('user-1');
  assert.equal(other.redeem(token), null);
  for (let i = 0; i < 3; i++) other.issue('user-1');
  assert.doesNotThrow(() => tokens.issue('user-1'));
});
