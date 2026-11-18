import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../password.mjs';

// Small parameters keep the suite fast. Run with `npm test`.
const FAST = { N: 2 ** 10, r: 8, p: 1 };

test('the right password verifies', async () => {
  const stored = await hashPassword('correct horse', FAST);
  assert.equal(await verifyPassword('correct horse', stored), true);
});

// TODO: a wrong password does not verify.
// TODO: the same password hashed twice gives two different strings.
// TODO: needsRehash and login after a parameter change.
// TODO: malformed stored values and invalid passwords.
