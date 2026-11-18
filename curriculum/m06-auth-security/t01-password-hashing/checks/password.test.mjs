// Checks for "Hash passwords with scrypt". Node built-ins only.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

// Count calls to crypto.timingSafeEqual. Patching the built-in and syncing its
// ESM exports before the submission is imported means both `import { timingSafeEqual }`
// and `crypto.timingSafeEqual` reach the counter.
const realTimingSafeEqual = crypto.timingSafeEqual;
let timingSafeCalls = 0;
crypto.timingSafeEqual = function countedTimingSafeEqual(...args) {
  timingSafeCalls += 1;
  return realTimingSafeEqual.apply(this, args);
};
syncBuiltinESMExports();

const scryptAsync = promisify(crypto.scrypt);

/** Small parameters keep the checks fast. One test uses the defaults. */
const FAST = Object.freeze({ N: 2 ** 12, r: 8, p: 1 });
const FASTER = Object.freeze({ N: 2 ** 10, r: 8, p: 1 });
const FORMAT = /^\$scrypt\$n=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

let loaded;
async function load() {
  loaded ??= import(pathToFileURL(path.join(submissionDir, 'password.mjs')).href);
  const mod = await loaded;
  for (const name of ['hashPassword', 'verifyPassword', 'needsRehash', 'login']) {
    assert.equal(typeof mod[name], 'function', `password.mjs must export a function named ${name}`);
  }
  return mod;
}

function parse(stored, what) {
  assert.equal(typeof stored, 'string', `${what}: expected a string, got ${typeof stored}`);
  const match = FORMAT.exec(stored);
  assert.ok(match, `${what}: expected the format $scrypt$n=<N>,r=<r>,p=<p>$<salt>$<hash> (base64url), got "${stored}"`);
  return {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
    salt: Buffer.from(match[4], 'base64url'),
    hash: Buffer.from(match[5], 'base64url'),
  };
}

async function rejects(promiseFn, ErrorType, what) {
  let outcome;
  try {
    await promiseFn();
    outcome = 'it resolved';
  } catch (error) {
    if (error instanceof ErrorType) return;
    outcome = `it threw ${error?.name ?? typeof error}: ${error?.message ?? error}`;
  }
  assert.fail(`${what}: expected a ${ErrorType.name}, but ${outcome}`);
}

test('format: the stored string encodes N, r, p, a 16-byte salt and a 32-byte scrypt key', async () => {
  const { hashPassword } = await load();
  const password = 'correct horse battery staple';
  const stored = await hashPassword(password, FAST);
  const parsed = parse(stored, 'hashPassword(password, { N: 4096, r: 8, p: 1 })');
  assert.deepEqual(
    { N: parsed.N, r: parsed.r, p: parsed.p },
    { ...FAST },
    'The parameters in the stored string must be the ones that were passed in',
  );
  assert.equal(parsed.salt.length, 16, `Expected a 16-byte salt, found ${parsed.salt.length} bytes`);
  assert.equal(parsed.hash.length, 32, `Expected a 32-byte key, found ${parsed.hash.length} bytes`);
  const expected = await scryptAsync(password, parsed.salt, 32, { ...FAST, maxmem: 64 * 1024 * 1024 });
  assert.ok(
    expected.equals(parsed.hash),
    'The key in the stored string is not scrypt(password, salt, 32, { N, r, p }) for the salt and parameters it names',
  );
});

test('unique-salts: hashing the same password twice gives different strings that both verify', async () => {
  const { hashPassword, verifyPassword } = await load();
  const hashes = [];
  for (let i = 0; i < 3; i++) hashes.push(await hashPassword('same password', FASTER));
  const salts = new Set(hashes.map((h) => parse(h, 'hashPassword').salt.toString('hex')));
  assert.equal(salts.size, 3, 'Three hashes of the same password reused a salt. Each hash needs a fresh random salt.');
  for (const stored of hashes) {
    assert.equal(await verifyPassword('same password', stored), true, `verifyPassword rejected the right password for ${stored}`);
  }
});

test('verify: the right password is accepted and anything else is rejected without throwing', async () => {
  const { hashPassword, verifyPassword } = await load();
  const stored = await hashPassword('Tr0ub4dor&3', FASTER);
  assert.equal(await verifyPassword('Tr0ub4dor&3', stored), true, 'verifyPassword rejected the right password');
  for (const wrong of ['tr0ub4dor&3', 'Tr0ub4dor&3 ', 'Tr0ub4dor', 'x']) {
    assert.equal(await verifyPassword(wrong, stored), false, `verifyPassword accepted the wrong password "${wrong}"`);
  }
  const malformed = ['', 'not a hash', '$scrypt$n=1024,r=8,p=1$abc', stored.replace('$scrypt$', '$argon2id$'), null, 42];
  for (const bad of malformed) {
    let result;
    try {
      result = await verifyPassword('Tr0ub4dor&3', bad);
    } catch (error) {
      assert.fail(`verifyPassword threw for the stored value ${JSON.stringify(bad)} (${error?.message}). It must return false.`);
    }
    assert.equal(result, false, `verifyPassword returned ${result} for the stored value ${JSON.stringify(bad)}`);
  }
});

test('encoded-params: verification uses the parameters in the stored string, and new hashes use N=2^17, r=8, p=1', async () => {
  const { hashPassword, verifyPassword } = await load();
  for (const params of [FASTER, FAST, { N: 2 ** 11, r: 4, p: 2 }]) {
    const stored = await hashPassword('old account', params);
    assert.equal(
      await verifyPassword('old account', stored),
      true,
      `A hash made with N=${params.N}, r=${params.r}, p=${params.p} did not verify. Read the parameters from the stored string.`,
    );
  }
  const current = parse(await hashPassword('new account'), 'hashPassword(password) with no params');
  assert.deepEqual(
    { N: current.N, r: current.r, p: current.p },
    { N: 131072, r: 8, p: 1 },
    'hashPassword without params must use N = 2^17, r = 8, p = 1',
  );
});

test('timing-safe: verification compares keys with crypto.timingSafeEqual', async () => {
  const { hashPassword, verifyPassword } = await load();
  const stored = await hashPassword('compare me', FASTER);
  timingSafeCalls = 0;
  await verifyPassword('compare me', stored);
  await verifyPassword('compare you', stored);
  assert.ok(
    timingSafeCalls >= 2,
    `crypto.timingSafeEqual was called ${timingSafeCalls} times for two verifications. Compare the derived key with it, not with === or Buffer.equals.`,
  );
});

test('rehash: needsRehash spots old parameters and login returns an upgraded hash', async () => {
  const { hashPassword, verifyPassword, needsRehash, login } = await load();
  const old = await hashPassword('upgrade me', FASTER);
  assert.equal(needsRehash(old, FAST), true, 'needsRehash: a hash with N=1024 must need a rehash when the policy is N=4096');
  assert.equal(needsRehash(old, FASTER), false, 'needsRehash: a hash made with the current parameters must not need a rehash');
  assert.equal(needsRehash('garbage', FAST), true, 'needsRehash: a value that cannot be parsed must need a rehash');

  const wrong = await login('wrong password', old, FAST);
  assert.deepEqual(wrong, { ok: false, newHash: null }, 'login with the wrong password must return { ok: false, newHash: null }');

  const current = await login('upgrade me', old, FASTER);
  assert.deepEqual(current, { ok: true, newHash: null }, 'login with a current hash must return { ok: true, newHash: null }');

  const upgraded = await login('upgrade me', old, FAST);
  assert.equal(upgraded?.ok, true, 'login with the right password must return ok: true');
  const fresh = parse(upgraded.newHash, 'login(...).newHash after a policy change');
  assert.equal(fresh.N, FAST.N, `The new hash must use the new parameters (N=${FAST.N}), found N=${fresh.N}`);
  assert.equal(await verifyPassword('upgrade me', upgraded.newHash), true, 'The new hash returned by login does not verify');
});

test('input-limits: hashPassword rejects non-strings, empty passwords and passwords over 1024 characters', async () => {
  const { hashPassword } = await load();
  await rejects(() => hashPassword(undefined, FASTER), TypeError, 'hashPassword(undefined)');
  await rejects(() => hashPassword(12345678, FASTER), TypeError, 'hashPassword(12345678)');
  await rejects(() => hashPassword('', FASTER), RangeError, 'hashPassword("")');
  await rejects(() => hashPassword('a'.repeat(1025), FASTER), RangeError, 'hashPassword of 1025 characters');
  const longest = await hashPassword('a'.repeat(1024), FASTER);
  parse(longest, 'hashPassword of exactly 1024 characters');
});

test('non-blocking: hashing with the default parameters does not block the event loop', async () => {
  const { hashPassword } = await load();
  let ticks = 0;
  const timer = setInterval(() => {
    ticks += 1;
  }, 5);
  const started = performance.now();
  try {
    await hashPassword('do not block me');
  } finally {
    clearInterval(timer);
  }
  const elapsed = performance.now() - started;
  assert.ok(
    ticks >= 2,
    `A 5 ms timer fired ${ticks} times during a ${Math.round(elapsed)} ms hash with the default parameters. ` +
      'Expected scrypt with N=2^17 to run off the main thread (callback or promisified crypto.scrypt, not scryptSync).',
  );
});
