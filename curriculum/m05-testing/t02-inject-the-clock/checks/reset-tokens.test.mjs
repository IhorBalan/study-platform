// Checks for "Inject the clock". Node built-ins only.
//
// Part 1 drives the learner's refactored module with the checks' own fake
// clock and id generator. Part 2 runs the learner's tests against the
// reference implementation and against broken copies of it (mutants).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(fileURLToPath(import.meta.url));
const reference = readFileSync(path.join(here, 'fixtures', 'reset-tokens.ts'), 'utf8');
const workRoot = mkdtempSync(path.join(os.tmpdir(), 'm05-t02-'));

after(() => rmSync(workRoot, { recursive: true, force: true }));

const MINUTE = 60_000;
const START = 1_000_000_000; // 1970-01-12: far from the real time, so a module that reads Date.now() shows up

// ---------------------------------------------------------------------------
// Part 1: the refactored module

let loaded;
async function load() {
  loaded ??= import(pathToFileURL(path.join(dir, 'src', 'reset-tokens.ts')).href).then(
    (mod) => ({ mod, error: null }),
    (error) => ({ mod: null, error }),
  );
  const { mod, error } = await loaded;
  assert.ok(!error, `src/reset-tokens.ts could not be imported: ${String(error?.message ?? error).slice(0, 800)}`);
  assert.equal(typeof mod.createResetTokens, 'function', 'src/reset-tokens.ts must export a function named createResetTokens');
  return mod;
}

function fakeClock(start = START) {
  let now = start;
  return { now: () => now, advance: (ms) => (now += ms) };
}

function ids(prefix = 'chk') {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function fresh() {
  const mod = await load();
  const clock = fakeClock();
  const tokens = mod.createResetTokens({ clock, randomId: ids() });
  assert.ok(
    tokens && typeof tokens.issue === 'function' && typeof tokens.redeem === 'function',
    'createResetTokens(deps) must return an object with issue() and redeem() methods',
  );
  return { mod, clock, tokens };
}

function isRateLimited(mod, fn) {
  try {
    fn();
    return false;
  } catch (error) {
    assert.ok(
      error instanceof mod.RateLimitedError,
      `expected a RateLimitedError, got ${String(error?.name ?? error)}: ${String(error?.message ?? '')}`,
    );
    return true;
  }
}

test('exports-factory: createResetTokens() returns independent instances', async () => {
  const mod = await load();
  assert.equal(typeof mod.RateLimitedError, 'function', 'src/reset-tokens.ts must still export RateLimitedError');
  const clock = fakeClock();
  const a = mod.createResetTokens({ clock, randomId: ids('a') });
  const b = mod.createResetTokens({ clock, randomId: ids('b') });
  const { token } = a.issue('user-1');
  assert.equal(b.redeem(token), null, 'a token issued by one instance must not be redeemable on another instance');
  for (let i = 0; i < 3; i++) b.issue('user-2');
  assert.ok(
    !isRateLimited(mod, () => a.issue('user-2')),
    'tokens issued by one instance must not count towards the rate limit of another instance',
  );
});

test('uses-injected-clock: expiry follows the clock passed in deps', async () => {
  const { clock, tokens } = await fresh();
  const first = tokens.issue('user-1');
  assert.equal(
    first.expiresAt,
    START + 15 * MINUTE,
    `with the clock at ${START}, expected expiresAt ${START + 15 * MINUTE}, got ${first.expiresAt}`,
  );
  clock.advance(15 * MINUTE - 1);
  assert.equal(tokens.redeem(first.token), 'user-1', 'a token must still work 1 ms before it expires (by the injected clock)');

  const second = tokens.issue('user-1');
  clock.advance(15 * MINUTE);
  assert.equal(tokens.redeem(second.token), null, 'a token must stop working exactly 15 minutes after issue (by the injected clock)');
});

test('uses-injected-random: tokens come from the randomId passed in deps', async () => {
  const { tokens } = await fresh();
  assert.equal(tokens.issue('user-1').token, 'chk-1', 'the first token must be the first value returned by deps.randomId()');
  assert.equal(tokens.issue('user-2').token, 'chk-2', 'the second token must be the second value returned by deps.randomId()');
});

test('single-use: a token works once and unknown tokens are refused', async () => {
  const { tokens } = await fresh();
  const { token } = tokens.issue('user-1');
  assert.equal(tokens.redeem(token), 'user-1', 'redeem() of a fresh token must return the user id');
  assert.equal(tokens.redeem(token), null, 'redeem() of a used token must return null');
  assert.equal(tokens.redeem('never-issued'), null, 'redeem() of an unknown token must return null');
});

test('rate-limit: 3 tokens per user in any 60-minute window', async () => {
  const { mod, clock, tokens } = await fresh();
  tokens.issue('user-1');
  clock.advance(20 * MINUTE);
  tokens.redeem(tokens.issue('user-1').token);
  tokens.issue('user-1');
  assert.ok(isRateLimited(mod, () => tokens.issue('user-1')), 'the 4th token within 60 minutes must throw RateLimitedError');
  assert.ok(!isRateLimited(mod, () => tokens.issue('user-2')), 'another user must not be affected by user-1 hitting the limit');

  clock.advance(40 * MINUTE - 1);
  assert.ok(isRateLimited(mod, () => tokens.issue('user-1')), '1 ms before the oldest token is 60 minutes old, the limit must still apply');
  clock.advance(1);
  assert.ok(!isRateLimited(mod, () => tokens.issue('user-1')), 'exactly 60 minutes after the oldest token, a slot must be free again');
  assert.ok(isRateLimited(mod, () => tokens.issue('user-1')), 'only one slot frees up when the oldest token leaves the window');
});

test('default-deps: without deps it uses the real clock and random ids', async () => {
  const mod = await load();
  const tokens = mod.createResetTokens();
  const before = Date.now();
  const a = tokens.issue('user-1');
  const b = tokens.issue('user-1');
  const afterIssue = Date.now();
  assert.equal(typeof a.token, 'string', 'the default token must be a string');
  assert.ok(a.token.length >= 16, `the default token must be at least 16 characters long, got "${a.token}"`);
  assert.notEqual(a.token, b.token, 'two default tokens must differ');
  assert.ok(
    a.expiresAt >= before + 15 * MINUTE && a.expiresAt <= afterIssue + 15 * MINUTE,
    'with no deps, expiresAt must be 15 minutes after the real current time',
  );
  assert.equal(tokens.redeem(a.token), 'user-1', 'with no deps, a fresh token must be redeemable');
});

// ---------------------------------------------------------------------------
// Part 2: the learner's tests

function mutate(source, ...pairs) {
  let out = source;
  for (const [from, to] of pairs) {
    const at = out.indexOf(from);
    if (at === -1 || out.indexOf(from, at + 1) !== -1) throw new Error(`check bug: "${from}" must occur exactly once`);
    out = out.slice(0, at) + to + out.slice(at + from.length);
  }
  return out;
}

const MUTANTS = {
  expiry: [
    ['a token still works at the exact moment it expires', ['if (clock.now() >= entry.expiresAt)', 'if (clock.now() > entry.expiresAt)']],
    ['tokens live 16 minutes instead of 15', ['const expiresAt = now + TOKEN_TTL_MS;', 'const expiresAt = now + TOKEN_TTL_MS + 60_000;']],
    ['a token can be redeemed twice', ['tokens.delete(token);', '']],
    ['redeem() reads the real clock instead of the injected one', ['if (clock.now() >= entry.expiresAt)', 'if (Date.now() >= entry.expiresAt)']],
    ['issue() computes expiry from the real clock', ['const expiresAt = now + TOKEN_TTL_MS;', 'const expiresAt = Date.now() + TOKEN_TTL_MS;']],
    ['the token is not the value from randomId()', ['const token = randomId();', "const token = randomId() + '-x';"]],
  ],
  rateLimit: [
    ['a user gets 4 tokens per window instead of 3', ['if (recent.length >= MAX_TOKENS_PER_WINDOW)', 'if (recent.length > MAX_TOKENS_PER_WINDOW)']],
    ['the limit is shared by all users', ['(issuedAt.get(userId) ?? [])', "(issuedAt.get('all') ?? [])"], ['issuedAt.set(userId,', "issuedAt.set('all',"]],
    ['a slot is not freed until after 60 minutes have passed', ['now - t < RATE_WINDOW_MS', 'now - t <= RATE_WINDOW_MS']],
    ['redeeming a token frees a rate-limit slot', ['tokens.delete(token);', 'tokens.delete(token); issuedAt.get(entry.userId)?.shift();']],
  ],
};

function prepare(name, implementation) {
  const work = path.join(workRoot, name);
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(work, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(work, 'test'), { recursive: true });
  if (implementation !== undefined) writeFileSync(path.join(work, 'src', 'reset-tokens.ts'), implementation);
  return work;
}

function runTests(cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', '--test-timeout=5000', 'test/**/*.test.ts'],
      { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const count = (label) => Number(output.match(new RegExp(`^# ${label} (\\d+)`, 'm'))?.[1] ?? 0);
      resolve({ ok: code === 0, tests: count('tests'), failed: count('fail'), output });
    });
  });
}

let baselineRuns;
function baseline() {
  baselineRuns ??= (async () => {
    const testDir = path.join(dir, 'test');
    if (!existsSync(testDir)) return { problem: 'The submission has no test/ folder.' };
    if (!existsSync(path.join(dir, 'src', 'reset-tokens.ts'))) return { problem: 'src/reset-tokens.ts is missing.' };
    const files = readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts'));
    if (files.length === 0) return { problem: 'No *.test.ts file was found in test/.' };
    const own = await runTests(prepare('own'));
    const ref = await runTests(prepare('reference', reference));
    return { own, ref, problem: null };
  })();
  return baselineRuns;
}

async function requireGreenBaseline() {
  const run = await baseline();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(
    run.own.ok && run.ref.ok && run.ref.tests > 0,
    'Your tests must pass against your code and the reference implementation before the checks can tell whether they catch bugs. ' +
      'Fix the "tests-pass" criterion first.',
  );
}

async function expectKilled(group) {
  await requireGreenBaseline();
  // One at a time: each run is a Node process, and the sandbox may have only 512 MB.
  const survivors = [];
  for (const [i, [label, ...pairs]] of MUTANTS[group].entries()) {
    const run = await runTests(prepare(`${group}-${i}`, mutate(reference, ...pairs)));
    if (run.ok) survivors.push(`  - ${label}`);
  }
  assert.equal(
    survivors.length,
    0,
    `Your tests still pass when the implementation has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each of them.`,
  );
}

test('tests-pass: your tests pass, quickly, against your code and the reference implementation', async () => {
  const run = await baseline();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(run.own.tests > 0, `No tests ran against your code. Output:\n${run.own.output.slice(-1500)}`);
  assert.ok(
    run.own.ok,
    `${run.own.failed} of ${run.own.tests} tests failed against your own code (each test may take at most 5 s). Output:\n${run.own.output.slice(-2500)}`,
  );
  assert.ok(
    run.ref.ok,
    `Your tests pass against your code but ${run.ref.failed} of ${run.ref.tests} fail against the reference implementation of the same API. ` +
      `Check that they use only createResetTokens(), issue(), redeem(), RateLimitedError and the exported constants. Output:\n${run.ref.output.slice(-2500)}`,
  );
});

test('catches-expiry-bugs: your tests catch broken expiry, single use and dependency handling', () => expectKilled('expiry'));

test('catches-rate-limit-bugs: your tests catch a broken rate limit', () => expectKilled('rateLimit'));
