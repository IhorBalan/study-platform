// The learner's own tests: they must pass, and they must notice a handler that treats every charge as succeeded.
// Compiles into its own output folder so it never races with the other check file, which rebuilds dist/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const OUT = '.own-tests-dist';
const cleanup = [];
after(() => cleanup.forEach((p) => rmSync(p, { recursive: true, force: true })));

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  cleanup.push(path.join(dir, OUT));
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--outDir', OUT, '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  return result.status === 0 ? null : `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 3000);
}

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', `${OUT}/test/*.test.js`], {
    cwd,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...env, NODE_OPTIONS: '' },
  });
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** A copy of the compiled project whose reconcile() treats every charge as succeeded, failed attempts included. */
function mutantDir() {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  cleanup.push(target);
  cpSync(path.join(dir, OUT), path.join(target, OUT), { recursive: true });
  for (const extra of ['db', 'fixtures']) {
    if (existsSync(path.join(dir, extra))) cpSync(path.join(dir, extra), path.join(target, extra), { recursive: true });
  }
  const real = pathToFileURL(path.join(dir, OUT, 'reconcile.js')).href;
  writeFileSync(
    path.join(target, OUT, 'reconcile.js'),
    [
      `import { reconcile as realReconcile } from ${JSON.stringify(real)};`,
      `export * from ${JSON.stringify(real)};`,
      '// Broken on purpose: a declined attempt now looks like money that arrived.',
      'async function* allSucceeded(charges) {',
      "  for await (const charge of charges) yield { ...charge, status: 'succeeded' };",
      '}',
      'export function reconcile(pool, charges, window) {',
      '  return realReconcile(pool, allSucceeded(charges), window);',
      '}',
      '',
    ].join('\n'),
  );
  return target;
}

test('own-tests: your tests pass and catch a reconcile() that treats failed charges as succeeded', () => {
  const testDir = path.join(dir, 'src', 'test');
  const files = existsSync(testDir) ? readdirSync(testDir).filter((f) => f.endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as src/test/*.test.ts (node:test). None were found.');
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.');

  const compileError = compile();
  assert.ok(!compileError, `The project did not compile:\n${compileError}`);
  assert.ok(existsSync(path.join(dir, OUT, 'reconcile.js')), 'src/reconcile.ts must exist and export reconcile.');

  const own = runTests(dir);
  assert.equal(own.status, 0, `Your tests fail against your own code:\n${own.output.slice(-2000)}`);

  const mutant = runTests(mutantDir());
  assert.notEqual(
    mutant.status,
    0,
    'Your tests still pass when reconcile() counts failed charges as succeeded. Add a test with a failed charge (for example a declined attempt before a successful one).',
  );
});
