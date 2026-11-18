// The learner's own tests: they must pass, and they must notice a shortener that never rate-limits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');
const dir = path.resolve(submissionDir);

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...env, NODE_OPTIONS: '' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * A copy of the submission's tests next to a shortener.mjs whose limiter never limits:
 * every call is made under a fresh client id, so no bucket ever empties.
 */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = pathToFileURL(path.join(dir, 'shortener.mjs')).href;
  writeFileSync(
    path.join(target, 'shortener.mjs'),
    [
      `import { createShortener as realCreate } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      'let n = 0;',
      '// Broken on purpose: each call gets its own client id, so the rate limit never applies.',
      'export function createShortener(options) {',
      '  const inner = realCreate(options);',
      '  return {',
      '    ...inner,',
      '    shorten(url, opts = {}) {',
      "      const clientId = typeof opts?.clientId === 'string' && opts.clientId ? `${opts.clientId}#${n++}` : opts?.clientId;",
      '      return inner.shorten(url, { ...opts, clientId });',
      '    },',
      '  };',
      '}',
      '',
    ].join('\n'),
  );
  if (existsSync(path.join(dir, 'server.mjs'))) {
    const realServer = pathToFileURL(path.join(dir, 'server.mjs')).href;
    writeFileSync(path.join(target, 'server.mjs'), `export * from ${JSON.stringify(realServer)};\n`);
  }
  return target;
}

test('own-tests: your tests pass and catch a shortener that never rate-limits', () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.mjs (node:test). None were found.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own code:\n${own.output.slice(-2000)}`);

  const target = mutantDir();
  try {
    const mutant = runTests(target);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when the rate limit never applies. Add a test that a client over its limit gets a RateLimitError.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
