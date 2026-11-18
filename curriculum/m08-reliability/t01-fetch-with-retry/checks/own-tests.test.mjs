// The learner's own tests: they must pass, and they must notice a fetchWithRetry that retries client errors.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.ts'], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...env, NODE_OPTIONS: '' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A copy of the submission's tests next to a retry.ts whose fetchWithRetry also retries 4xx answers. */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = pathToFileURL(path.join(dir, 'retry.ts')).href;
  writeFileSync(
    path.join(target, 'retry.ts'),
    [
      `import { fetchWithRetry as realFetchWithRetry } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      '// Broken on purpose: client errors such as 400 and 404 are retried up to three times.',
      'export async function fetchWithRetry(url, init, options) {',
      '  let res;',
      '  for (let i = 0; i < 3; i++) {',
      '    res = await realFetchWithRetry(url, init, options);',
      '    if (res.status < 400 || res.status >= 500 || res.status === 408 || res.status === 429) return res;',
      '    await res.body?.cancel();',
      '  }',
      '  return res;',
      '}',
      '',
    ].join('\n'),
  );
  return target;
}

test('own-tests: your tests pass and catch a fetchWithRetry that retries client errors', () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own retry.ts:\n${own.output.slice(-2000)}`);

  const target = mutantDir();
  try {
    const mutant = runTests(target);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when fetchWithRetry retries a 400 or 404. Add a test that counts the requests a client error causes.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
