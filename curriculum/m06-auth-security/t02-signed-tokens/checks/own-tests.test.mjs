// The learner's own tests: they must pass, and they must notice a verifyToken that skips the signature check.
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

/** A copy of the submission's tests next to a token.mjs whose verifyToken never checks the signature. */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = pathToFileURL(path.join(dir, 'token.mjs')).href;
  writeFileSync(
    path.join(target, 'token.mjs'),
    [
      "import { createHmac } from 'node:crypto';",
      `import { verifyToken as realVerify } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      '// Broken on purpose: re-signs the token with the expected secret before checking it,',
      '// so tampered payloads and wrong secrets pass. Everything else behaves as before.',
      'export function verifyToken(token, options) {',
      "  const parts = typeof token === 'string' ? token.split('.') : [];",
      '  if (parts.length === 3 && parts[0] && parts[1] && options && options.secret) {',
      '    try {',
      "      const sig = createHmac('sha256', options.secret).update(`${parts[0]}.${parts[1]}`).digest('base64url');",
      '      token = `${parts[0]}.${parts[1]}.${sig}`;',
      '    } catch {}',
      '  }',
      '  return realVerify(token, options);',
      '}',
      '',
    ].join('\n'),
  );
  return target;
}

test('own-tests: your tests pass and catch a verifyToken that skips the signature check', () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.mjs')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.mjs (node:test). None were found.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own token.mjs:\n${own.output.slice(-2000)}`);

  const target = mutantDir();
  try {
    const mutant = runTests(target);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when verifyToken accepts a changed payload or a wrong secret. Add a test that a tampered token is rejected.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
