// The learner's own tests: they must pass, and they must notice a broken verifyPassword.
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

/** A copy of the submission's tests next to a password.mjs whose verifyPassword also accepts wrong passwords. */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = pathToFileURL(path.join(dir, 'password.mjs')).href;
  writeFileSync(
    path.join(target, 'password.mjs'),
    [
      `import { verifyPassword as realVerify } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      '// Broken on purpose: the right password still verifies, and so does every wrong one.',
      'export async function verifyPassword(password, stored) {',
      "  return (await realVerify(password, stored)) || (typeof stored === 'string' && stored.length > 0);",
      '}',
      '',
    ].join('\n'),
  );
  return target;
}

test('own-tests: your tests pass and catch a verifyPassword that accepts any password', () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.mjs (node:test). None were found.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own password.mjs:\n${own.output.slice(-2000)}`);

  const target = mutantDir();
  try {
    const mutant = runTests(target);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when verifyPassword accepts a wrong password. Add a test that a wrong password is rejected.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
