// Checks for "Signed tokens by hand". Node built-ins only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

// Count calls to crypto.timingSafeEqual (see the password task for the technique).
const realTimingSafeEqual = crypto.timingSafeEqual;
let timingSafeCalls = 0;
crypto.timingSafeEqual = function countedTimingSafeEqual(...args) {
  timingSafeCalls += 1;
  return realTimingSafeEqual.apply(this, args);
};
syncBuiltinESMExports();

const SECRET = 'check-secret-0123456789-abcdefghijklmnop';
const OTHER_SECRET = 'another-secret-0123456789-abcdefghijklmn';
const NOW = 1_800_000_000;

let loaded;
async function load() {
  loaded ??= import(pathToFileURL(path.join(submissionDir, 'token.mjs')).href);
  const mod = await loaded;
  for (const name of ['issueToken', 'verifyToken']) {
    assert.equal(typeof mod[name], 'function', `token.mjs must export a function named ${name}`);
  }
  return mod;
}

const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const hmac = (secret, input) => crypto.createHmac('sha256', secret).update(input).digest('base64url');

/** A reference HS256 signer, so tokens can be built with any header and payload. */
function forge(header, payload, secret = SECRET) {
  const input = `${b64(header)}.${b64(payload)}`;
  return `${input}.${hmac(secret, input)}`;
}

const decode = (segment) => JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

/** Calls verifyToken and expects a TokenError-like error with `code` (or one of several codes). */
function expectCode(verifyToken, token, options, code, what) {
  const codes = [code].flat();
  let error;
  try {
    const payload = verifyToken(token, options);
    assert.fail(`verifyToken accepted ${what}. Expected it to throw with code "${codes.join('" or "')}", got payload ${JSON.stringify(payload)}`);
  } catch (caught) {
    if (caught instanceof assert.AssertionError) throw caught;
    error = caught;
  }
  assert.ok(error instanceof Error, `verifyToken threw a non-Error for ${what}`);
  assert.ok(
    codes.includes(error.code),
    `verifyToken for ${what}: expected error code "${codes.join('" or "')}", got ${JSON.stringify(error.code)} (${error.message})`,
  );
}

test('issue-format: a token is header.payload.signature with HS256 and an HMAC-SHA256 signature', async () => {
  const { issueToken } = await load();
  const token = issueToken({ sub: 'user-1', role: 'member' }, { secret: SECRET, expiresInSeconds: 900, now: NOW });
  assert.equal(typeof token, 'string', 'issueToken must return a string');
  const parts = token.split('.');
  assert.equal(parts.length, 3, `Expected three dot-separated parts, got ${parts.length}`);
  for (const part of parts) {
    assert.match(part, /^[A-Za-z0-9_-]+$/, `Every part must be base64url without padding, got "${part}"`);
  }
  assert.deepEqual(decode(parts[0]), { alg: 'HS256', typ: 'JWT' }, 'The header must be exactly { alg: "HS256", typ: "JWT" }');
  const payload = decode(parts[1]);
  assert.equal(payload.sub, 'user-1', 'The payload must contain the claims that were passed in');
  assert.equal(payload.role, 'member', 'The payload must contain the claims that were passed in');
  assert.equal(payload.iat, NOW, `iat must be "now" in seconds (${NOW}), got ${payload.iat}`);
  assert.equal(payload.exp, NOW + 900, `exp must be now + expiresInSeconds (${NOW + 900}), got ${payload.exp}`);
  assert.equal(parts[2], hmac(SECRET, `${parts[0]}.${parts[1]}`), 'The signature is not HMAC-SHA256(secret, "<header>.<payload>")');

  const withAud = issueToken({ sub: 'user-1' }, { secret: SECRET, expiresInSeconds: 60, audience: 'api', now: NOW });
  assert.equal(decode(withAud.split('.')[1]).aud, 'api', 'With an audience option the payload must carry aud');
});

test('verify-valid: a valid token returns its payload, including tokens signed by another HS256 implementation', async () => {
  const { issueToken, verifyToken } = await load();
  const token = issueToken({ sub: 'user-2' }, { secret: SECRET, expiresInSeconds: 60, now: NOW });
  const payload = verifyToken(token, { secret: SECRET, now: NOW + 30 });
  assert.equal(payload?.sub, 'user-2', `verifyToken must return the payload, got ${JSON.stringify(payload)}`);

  const foreign = forge({ typ: 'JWT', alg: 'HS256' }, { sub: 'user-3', exp: NOW + 10, aud: 'api' });
  const foreignPayload = verifyToken(foreign, { secret: SECRET, audience: 'api', now: NOW });
  assert.equal(foreignPayload?.sub, 'user-3', 'A correctly signed token from another HS256 implementation must verify');

  const bufferSecret = Buffer.from(SECRET);
  const viaBuffer = issueToken({ sub: 'user-4' }, { secret: bufferSecret, expiresInSeconds: 60, now: NOW });
  assert.equal(verifyToken(viaBuffer, { secret: bufferSecret, now: NOW })?.sub, 'user-4', 'A Buffer secret must work as well');
});

test('tamper: a changed payload, a wrong secret or a damaged signature is rejected as bad-signature', async () => {
  const { issueToken, verifyToken } = await load();
  const token = issueToken({ sub: 'user-5', role: 'member' }, { secret: SECRET, expiresInSeconds: 60, now: NOW });
  const [header, payload, signature] = token.split('.');
  const promoted = b64({ ...decode(payload), role: 'admin' });
  expectCode(verifyToken, `${header}.${promoted}.${signature}`, { secret: SECRET, now: NOW }, 'bad-signature', 'a payload changed to role "admin"');
  expectCode(verifyToken, token, { secret: OTHER_SECRET, now: NOW }, 'bad-signature', 'a token checked with another secret');
  const flipped = signature.slice(0, -2) + (signature.at(-2) === 'A' ? 'B' : 'A') + signature.at(-1);
  expectCode(verifyToken, `${header}.${payload}.${flipped}`, { secret: SECRET, now: NOW }, 'bad-signature', 'a signature with one character changed');
  expectCode(verifyToken, `${header}.${payload}.${signature.slice(0, 10)}`, { secret: SECRET, now: NOW }, 'bad-signature', 'a truncated signature');
});

test('alg-check: only HS256 is accepted, whatever the header asks for', async () => {
  const { verifyToken } = await load();
  const claims = { sub: 'attacker', role: 'admin', exp: NOW + 60 };
  const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
  expectCode(verifyToken, unsigned, { secret: SECRET, now: NOW }, ['unsupported-alg', 'malformed'], 'a token with alg "none" and no signature');
  const unsignedWithJunk = `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.${b64('x')}`;
  expectCode(verifyToken, unsignedWithJunk, { secret: SECRET, now: NOW }, 'unsupported-alg', 'a token with alg "none"');
  const hs512Input = `${b64({ alg: 'HS512', typ: 'JWT' })}.${b64(claims)}`;
  const hs512 = `${hs512Input}.${crypto.createHmac('sha512', SECRET).update(hs512Input).digest('base64url')}`;
  expectCode(verifyToken, hs512, { secret: SECRET, now: NOW }, 'unsupported-alg', 'a valid HS512 token');
  expectCode(verifyToken, forge({ alg: 'RS256', typ: 'JWT' }, claims), { secret: SECRET, now: NOW }, 'unsupported-alg', 'a header claiming RS256');
  expectCode(verifyToken, forge({ alg: 'hs256', typ: 'JWT' }, claims), { secret: SECRET, now: NOW }, 'unsupported-alg', 'a header with alg "hs256" in lower case');
  expectCode(verifyToken, forge({ typ: 'JWT' }, claims), { secret: SECRET, now: NOW }, 'unsupported-alg', 'a header without alg');
});

test('expiry: exp is required and a token is expired from the second exp names', async () => {
  const { issueToken, verifyToken } = await load();
  const token = issueToken({ sub: 'user-6' }, { secret: SECRET, expiresInSeconds: 60, now: NOW });
  assert.equal(verifyToken(token, { secret: SECRET, now: NOW + 59 })?.sub, 'user-6', 'A token one second before exp must verify');
  expectCode(verifyToken, token, { secret: SECRET, now: NOW + 60 }, 'expired', 'a token at exactly its exp');
  expectCode(verifyToken, token, { secret: SECRET, now: NOW + 3600 }, 'expired', 'a token an hour after exp');
  expectCode(verifyToken, forge({ alg: 'HS256', typ: 'JWT' }, { sub: 'forever' }), { secret: SECRET, now: NOW }, 'malformed', 'a correctly signed token without exp');
  expectCode(verifyToken, forge({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', exp: String(NOW + 60) }), { secret: SECRET, now: NOW }, 'malformed', 'a token whose exp is a string');
  const live = issueToken({ sub: 'user-7' }, { secret: SECRET, expiresInSeconds: 60 });
  assert.equal(verifyToken(live, { secret: SECRET })?.sub, 'user-7', 'Without a now option both functions must use the current time');
});

test('audience: when an audience is expected, a token for another audience or none is rejected', async () => {
  const { issueToken, verifyToken } = await load();
  const forApi = issueToken({ sub: 'user-8' }, { secret: SECRET, expiresInSeconds: 60, audience: 'api', now: NOW });
  assert.equal(verifyToken(forApi, { secret: SECRET, audience: 'api', now: NOW })?.sub, 'user-8', 'A token for the expected audience must verify');
  const forAdmin = issueToken({ sub: 'user-8' }, { secret: SECRET, expiresInSeconds: 60, audience: 'admin', now: NOW });
  expectCode(verifyToken, forAdmin, { secret: SECRET, audience: 'api', now: NOW }, 'wrong-audience', 'a token for audience "admin" when "api" is expected');
  const noAud = issueToken({ sub: 'user-8' }, { secret: SECRET, expiresInSeconds: 60, now: NOW });
  expectCode(verifyToken, noAud, { secret: SECRET, audience: 'api', now: NOW }, 'wrong-audience', 'a token without aud when "api" is expected');
});

test('malformed: garbage input is rejected as malformed and never with another kind of error', async () => {
  const { verifyToken } = await load();
  const cases = [
    ['', 'an empty string'],
    ['abc', 'a single segment'],
    ['a.b', 'two segments'],
    ['a.b.c.d', 'four segments'],
    [`${b64('not json')}.${b64({ exp: NOW + 60 })}.sig`, 'a header that is not JSON'],
    ['%%%.###.!!!', 'segments that are not base64url'],
    [null, 'null'],
    [12345, 'a number'],
  ];
  for (const [token, what] of cases) expectCode(verifyToken, token, { secret: SECRET, now: NOW }, 'malformed', what);
  const badPayloadInput = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64('not json')}`;
  const badPayload = `${badPayloadInput}.${hmac(SECRET, badPayloadInput)}`;
  expectCode(verifyToken, badPayload, { secret: SECRET, now: NOW }, 'malformed', 'a correctly signed payload that is not JSON');
});

test('timing-safe: signatures are compared with crypto.timingSafeEqual', async () => {
  const { issueToken, verifyToken } = await load();
  const token = issueToken({ sub: 'user-9' }, { secret: SECRET, expiresInSeconds: 60, now: NOW });
  timingSafeCalls = 0;
  verifyToken(token, { secret: SECRET, now: NOW });
  try {
    verifyToken(token, { secret: OTHER_SECRET, now: NOW });
  } catch {
    // Expected: bad signature.
  }
  assert.ok(
    timingSafeCalls >= 2,
    `crypto.timingSafeEqual was called ${timingSafeCalls} times for two verifications of full-length signatures. Do not compare signatures with === or Buffer.equals.`,
  );
});

test('weak-secret: a secret shorter than 32 bytes is refused with a RangeError', async () => {
  const { issueToken, verifyToken } = await load();
  assert.throws(
    () => issueToken({ sub: 'x' }, { secret: 'secret', expiresInSeconds: 60, now: NOW }),
    RangeError,
    'issueToken with a 6-byte secret must throw a RangeError',
  );
  const token = forge({ alg: 'HS256', typ: 'JWT' }, { sub: 'x', exp: NOW + 60 }, 'short');
  assert.throws(() => verifyToken(token, { secret: 'short', now: NOW }), RangeError, 'verifyToken with a 5-byte secret must throw a RangeError');
  const exactly32 = 'x'.repeat(32);
  const ok = issueToken({ sub: 'y' }, { secret: exactly32, expiresInSeconds: 60, now: NOW });
  assert.equal(verifyToken(ok, { secret: exactly32, now: NOW })?.sub, 'y', 'A secret of exactly 32 bytes must be accepted');
});
