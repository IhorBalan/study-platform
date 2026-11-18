import assert from 'node:assert/strict';
import { test } from 'node:test';
import { issueToken, verifyToken } from '../token.mjs';

const secret = 'test-secret-0123456789-abcdefghijklmnop';
const now = 1_800_000_000;
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Asserts that `fn` throws a TokenError with `code`. */
function throwsCode(fn, code) {
  assert.throws(fn, (error) => error.name === 'TokenError' && error.code === code);
}

test('a fresh token verifies and returns its claims', () => {
  const token = issueToken({ sub: 'u1' }, { secret, expiresInSeconds: 60, now });
  const payload = verifyToken(token, { secret, now });
  assert.equal(payload.sub, 'u1');
  assert.equal(payload.exp, now + 60);
});

test('a changed payload is a bad signature', () => {
  const [header, payload, signature] = issueToken({ sub: 'u1', role: 'member' }, { secret, expiresInSeconds: 60, now }).split('.');
  const promoted = b64({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), role: 'admin' });
  throwsCode(() => verifyToken(`${header}.${promoted}.${signature}`, { secret, now }), 'bad-signature');
});

test('another secret is a bad signature', () => {
  const token = issueToken({ sub: 'u1' }, { secret, expiresInSeconds: 60, now });
  throwsCode(() => verifyToken(token, { secret: secret.toUpperCase(), now }), 'bad-signature');
});

test('alg none is refused', () => {
  const token = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', exp: now + 60 })}.${b64('x')}`;
  throwsCode(() => verifyToken(token, { secret, now }), 'unsupported-alg');
});

test('a token is expired from the second exp names', () => {
  const token = issueToken({ sub: 'u1' }, { secret, expiresInSeconds: 60, now });
  assert.equal(verifyToken(token, { secret, now: now + 59 }).sub, 'u1');
  throwsCode(() => verifyToken(token, { secret, now: now + 60 }), 'expired');
});

test('the audience must match when one is expected', () => {
  const token = issueToken({ sub: 'u1' }, { secret, expiresInSeconds: 60, audience: 'admin', now });
  throwsCode(() => verifyToken(token, { secret, audience: 'api', now }), 'wrong-audience');
});

test('garbage is malformed', () => {
  for (const token of ['', 'a.b', 'a.b.c.d', 42]) throwsCode(() => verifyToken(token, { secret, now }), 'malformed');
});

test('a short secret is refused', () => {
  assert.throws(() => issueToken({}, { secret: 'short', expiresInSeconds: 60 }), RangeError);
});
