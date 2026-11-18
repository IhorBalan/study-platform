// The learner's own tests: they must pass, and they must notice two broken limiters.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
// The learner's tests get a prefix of their own inside the run's prefix, so that
// whatever they leave behind can be removed without touching the other checks' keys.
const OWN_PREFIX = `${process.env.VALKEY_KEY_PREFIX ?? 'check_local:'}own:`;

after(async () => {
  const prefix = OWN_PREFIX;
  if (!process.env.VALKEY_URL) return;
  const { Redis } = createRequire(path.join(dir, 'package.json'))('ioredis');
  const redis = new Redis(process.env.VALKEY_URL, { maxRetriesPerRequest: 2 });
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length > 0) await redis.del(...keys);
    } while (cursor !== '0');
  } finally {
    await redis.quit();
  }
});

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, NODE_OPTIONS, ...rest } = process.env;
  const env = { ...rest, VALKEY_KEY_PREFIX: OWN_PREFIX };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=15000', '--test-force-exit', 'test/**/*.test.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const MUTANTS = [
  [
    'consume never denies a request',
    'export function createRateLimiter(options) {\n  const real = realCreate(options);\n  return { consume: async (key) => ({ ...(await real.consume(key)), allowed: true, retryAfterMs: 0 }) };\n}',
  ],
  [
    'every client shares one limit',
    'export function createRateLimiter(options) {\n  const real = realCreate(options);\n  return { consume: (key) => real.consume(\'everyone\') };\n}',
  ],
];

/** A copy of the submission's src/ and test/ whose src/rate-limiter.ts wraps the real one with a bug. */
function mutantDir(body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = JSON.stringify(pathToFileURL(path.join(dir, 'src', 'rate-limiter.ts')).href);
  writeFileSync(
    path.join(target, 'src', 'rate-limiter.ts'),
    `import { createRateLimiter as realCreate } from ${real};\nexport * from ${real};\n// Broken on purpose.\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a limiter that never denies and one that shares a limit between clients', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  assert.ok(existsSync(path.join(dir, 'src', 'rate-limiter.ts')), 'src/rate-limiter.ts is missing from the submission.');

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own src/rate-limiter.ts:\n${own.output.slice(-2500)}`);

  const survivors = [];
  for (const [label, body] of MUTANTS) {
    const target = mutantDir(body);
    try {
      const run = await runTests(target);
      if (run.ok) survivors.push(`  - ${label}`);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }
  assert.equal(survivors.length, 0, `Your tests still pass when the limiter has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
