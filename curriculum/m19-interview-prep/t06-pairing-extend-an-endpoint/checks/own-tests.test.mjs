// The learner's own tests: they must pass, and they must notice a list that ignores the cursor.
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

/** A copy of the submission's tests next to a tickets.mjs that always returns the first page. */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = pathToFileURL(path.join(dir, 'tickets.mjs')).href;
  writeFileSync(
    path.join(target, 'tickets.mjs'),
    [
      `import { listTickets as realList } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      '// Broken on purpose: the cursor is dropped, so every page is the first page.',
      'export function listTickets(tickets, options = {}) {',
      '  const { cursor, ...rest } = options ?? {};',
      '  return realList(tickets, rest);',
      '}',
      '',
    ].join('\n'),
  );
  for (const file of ['server.mjs', 'seed.mjs']) {
    if (!existsSync(path.join(dir, file))) continue;
    const href = pathToFileURL(path.join(dir, file)).href;
    writeFileSync(path.join(target, file), `export * from ${JSON.stringify(href)};\n`);
  }
  return target;
}

test('own-tests: your tests pass and catch a list that ignores the cursor', () => {
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
      'Your tests still pass when listTickets ignores the cursor and returns the first page every time. ' +
        'Add a test that calls listTickets with a nextCursor and checks which tickets come back.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
