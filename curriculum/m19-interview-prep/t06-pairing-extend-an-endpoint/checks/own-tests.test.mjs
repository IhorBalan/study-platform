// The learner's own tests: they must pass, and they must notice a list that ignores the cursor.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');
const dir = path.resolve(submissionDir);

function runTests(cwd, timeout = 60_000) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.mjs'], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...env, NODE_OPTIONS: '' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/**
 * A copy of the whole submission in which tickets.mjs always returns the first page.
 * The real module moves to tickets.real.mjs, so server.mjs and every other file of the copy
 * import the broken one, and tests that go through HTTP see it too.
 */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.mutant-') || entry === '.git') continue;
    if (entry === 'node_modules') symlinkSync(path.join(dir, entry), path.join(target, entry), 'dir');
    else cpSync(path.join(dir, entry), path.join(target, entry), { recursive: true });
  }
  renameSync(path.join(target, 'tickets.mjs'), path.join(target, 'tickets.real.mjs'));
  writeFileSync(
    path.join(target, 'tickets.mjs'),
    [
      "import { listTickets as realList } from './tickets.real.mjs';",
      "export * from './tickets.real.mjs';",
      '// Broken on purpose: the cursor is dropped, so every page is the first page.',
      'export function listTickets(tickets, options = {}) {',
      '  const { cursor, ...rest } = options ?? {};',
      '  return realList(tickets, rest);',
      '}',
      '',
    ].join('\n'),
  );
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
    // A walk loop without a page cap never ends against the broken copy: the timeout counts as caught.
    const mutant = runTests(target, 20_000);
    assert.notEqual(
      mutant.status,
      0,
      'Your tests still pass when listTickets ignores the cursor and returns the first page every time. ' +
        'Add a test that asks for a second page with a nextCursor, through listTickets or over HTTP, and checks which tickets come back.',
    );
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});
