// Checks for "Integration tests for a repository". Node built-ins only; `pg`
// comes from the submission's node_modules.
//
// The learner's tests run against the reference repository on the database in
// DATABASE_URL: once on an empty table, twice in a row, and in shuffled order.
// Then they run against broken copies of the repository (mutants) and must
// fail for each one.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
const referenceRepo = fixture('notes-repository.ts');
const referenceSchema = fixture('schema.ts');

// Runs live inside the submission so that `pg` resolves from its node_modules.
const workRoot = path.join(dir, '.m05-check-runs');
rmSync(workRoot, { recursive: true, force: true });

let pool;
after(async () => {
  await pool?.end();
  rmSync(workRoot, { recursive: true, force: true });
});

/** Drops the notes table so a run starts from an empty database. */
async function resetDatabase() {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is not set for the check run. Start the lab Postgres with `pnpm lab up postgres`.');
  if (!pool) {
    const require = createRequire(path.join(dir, 'package.json'));
    const pg = require('pg');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  }
  await pool.query('DROP TABLE IF EXISTS notes CASCADE');
}

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
  read: [
    ['listRecent() returns the oldest note first', ['ORDER BY created_at DESC, id DESC', 'ORDER BY created_at ASC, id ASC']],
    ['listRecent() returns one note more than the limit', ['LIMIT $1', 'LIMIT $1 + 1']],
    ['findById() returns undefined instead of null for a missing id', ['[id]);\n    return rows.length === 0 ? null', '[id]);\n    return rows.length === 0 ? undefined']],
  ],
  write: [
    ['create() ignores the body', ["[input.title, input.body ?? '']", "[input.title, '']"]],
    [
      'rename() also renames every other note',
      [
        'async rename(id: string, title: string): Promise<Note | null> {',
        "async rename(id: string, title: string): Promise<Note | null> {\n    await this.#db.query('UPDATE notes SET title = $2 WHERE id <> $1', [id, title]);",
      ],
    ],
    ['rename() throws instead of returning null for a missing id', ['[id, title],\n    );\n    return rows.length === 0 ? null : toNote(rows[0]);', "[id, title],\n    );\n    if (rows.length === 0) throw new Error('note not found');\n    return toNote(rows[0]);"]],
    ['delete() returns true even when nothing was deleted', ['return rowCount === 1;', 'return true;']],
    ['delete() also deletes every newer note', ['DELETE FROM notes WHERE id = $1', 'DELETE FROM notes WHERE id >= $1'], ['return rowCount === 1;', 'return (rowCount ?? 0) >= 1;']],
  ],
};

/** Copies the learner's src/ and test/ into a fresh folder with the given repository and schema. */
function prepare(name, repo = referenceRepo) {
  const work = path.join(workRoot, name);
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }));
  if (existsSync(path.join(dir, 'src'))) cpSync(path.join(dir, 'src'), path.join(work, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(work, 'test'), { recursive: true });
  mkdirSync(path.join(work, 'src'), { recursive: true });
  writeFileSync(path.join(work, 'src', 'notes-repository.ts'), repo);
  writeFileSync(path.join(work, 'src', 'schema.ts'), referenceSchema);
  return work;
}

function runTests(cwd, extraArgs = []) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_OPTIONS;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', '--test-timeout=10000', '--test-force-exit', ...extraArgs, 'test/**/*.test.ts'],
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

function submissionProblem() {
  const testDir = path.join(dir, 'test');
  if (!existsSync(testDir)) return 'The submission has no test/ folder.';
  const files = readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts'));
  if (files.length === 0) return 'No *.test.ts file was found in test/.';
  if (!existsSync(path.join(dir, 'node_modules', 'pg'))) return 'pg was not found in node_modules. Keep it in package.json dependencies.';
  return null;
}

const tail = (run) => run.output.slice(-2500);

/** The first clean run, shared by every criterion that needs passing tests first. */
let firstRun;
function cleanRun() {
  firstRun ??= (async () => {
    const problem = submissionProblem();
    if (problem) return { problem };
    await resetDatabase();
    return { problem: null, ...(await runTests(prepare('clean'))) };
  })();
  return firstRun;
}

async function requireGreenBaseline() {
  const run = await cleanRun();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(run.ok && run.tests > 0, 'Your tests must pass on an empty database first. Fix the "tests-pass" criterion.');
}

async function expectKilled(group) {
  await requireGreenBaseline();
  const survivors = [];
  // One at a time: they share the database.
  for (const [i, [label, ...pairs]] of MUTANTS[group].entries()) {
    await resetDatabase();
    const run = await runTests(prepare(`${group}-${i}`, mutate(referenceRepo, ...pairs)));
    if (run.ok) survivors.push(`  - ${label}`);
  }
  assert.equal(
    survivors.length,
    0,
    `Your tests still pass when the repository has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each of them.`,
  );
}

test('tests-pass: your tests pass against the correct repository on an empty database', async () => {
  const run = await cleanRun();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(run.tests > 0, `No tests ran. Output:\n${tail(run)}`);
  assert.ok(run.ok, `${run.failed} of ${run.tests} tests failed against the correct repository. Output:\n${tail(run)}`);
});

test('repeatable: your tests pass again on the database the previous run left behind', async () => {
  await requireGreenBaseline();
  await resetDatabase();
  const work = prepare('repeat');
  const first = await runTests(work);
  assert.ok(first.ok, `The first of two runs failed. Output:\n${tail(first)}`);
  const second = await runTests(work);
  assert.ok(
    second.ok,
    `Your tests pass on an empty database but ${second.failed} of ${second.tests} fail when run a second time without cleaning up. ` +
      `Each test needs a clean slate whatever earlier runs left. Output:\n${tail(second)}`,
  );
});

test('order-independent: your tests pass in shuffled order, run after run', async () => {
  await requireGreenBaseline();
  await resetDatabase();
  const work = prepare('shuffled');
  // --test-randomize arrived during Node 24. On an older runtime, fall back to two plain runs.
  const canShuffle = process.allowedNodeEnvironmentFlags.has('--test-randomize');
  for (const seed of [11, 4242]) {
    const run = await runTests(work, canShuffle ? ['--test-randomize', `--test-random-seed=${seed}`] : []);
    assert.ok(
      run.ok,
      `With the tests shuffled (node --test --test-randomize --test-random-seed=${seed}), ${run.failed} of ${run.tests} failed. ` +
        `A test depends on another test having run before it, or on data an earlier run left. Output:\n${tail(run)}`,
    );
  }
});

test('catches-read-bugs: your tests catch broken reads', () => expectKilled('read'));

test('catches-write-bugs: your tests catch broken writes', () => expectKilled('write'));
