import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, login, needsRehash, verifyPassword } from '../password.mjs';

// Small parameters keep the suite fast. One test covers the defaults.
const FAST = { N: 2 ** 10, r: 8, p: 1 };
const NEWER = { N: 2 ** 11, r: 8, p: 1 };

test('the right password verifies', async () => {
  const stored = await hashPassword('correct horse', FAST);
  assert.equal(await verifyPassword('correct horse', stored), true);
});

test('a wrong password does not verify', async () => {
  const stored = await hashPassword('correct horse', FAST);
  for (const wrong of ['Correct horse', 'correct horse ', 'correct', '']) {
    assert.equal(await verifyPassword(wrong, stored), false, wrong);
  }
});

test('the same password gets a different salt each time', async () => {
  const a = await hashPassword('same', FAST);
  const b = await hashPassword('same', FAST);
  assert.notEqual(a, b);
});

test('a malformed stored value is false, not an exception', async () => {
  for (const stored of ['', 'nope', '$scrypt$n=1024,r=8,p=1$abc$def', null]) {
    assert.equal(await verifyPassword('x', stored), false);
  }
});

test('new hashes use N=2^17, r=8, p=1 by default', async () => {
  const stored = await hashPassword('defaults');
  assert.match(stored, /^\$scrypt\$n=131072,r=8,p=1\$/);
});

test('needsRehash compares the stored parameters with the current ones', async () => {
  const stored = await hashPassword('old', FAST);
  assert.equal(needsRehash(stored, FAST), false);
  assert.equal(needsRehash(stored, NEWER), true);
});

test('login upgrades an old hash only after the right password', async () => {
  const stored = await hashPassword('old', FAST);
  assert.deepEqual(await login('wrong', stored, NEWER), { ok: false, newHash: null });
  const result = await login('old', stored, NEWER);
  assert.equal(result.ok, true);
  assert.match(result.newHash, /^\$scrypt\$n=2048,/);
  assert.equal(await verifyPassword('old', result.newHash), true);
});

test('empty, too long and non-string passwords are rejected', async () => {
  await assert.rejects(hashPassword('', FAST), RangeError);
  await assert.rejects(hashPassword('x'.repeat(1025), FAST), RangeError);
  await assert.rejects(hashPassword(42, FAST), TypeError);
});
