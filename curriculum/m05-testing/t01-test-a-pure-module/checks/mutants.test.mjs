// Checks for "Test a pure module". Node built-ins only.
//
// The learner's tests are run against the reference implementation (they must
// pass) and against broken copies of it, called mutants (they must fail). A
// mutant whose run passes "survived": no test noticed the bug.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(fileURLToPath(import.meta.url));
const reference = readFileSync(path.join(here, 'fixtures', 'page-params.ts'), 'utf8');
const workRoot = mkdtempSync(path.join(os.tmpdir(), 'm05-t01-'));

after(() => rmSync(workRoot, { recursive: true, force: true }));

/** Replaces `from` with `to` exactly once, so a typo in a mutant fails loudly instead of testing nothing. */
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
  defaults: [
    ['the default limit is 10 instead of 20', ['export const DEFAULT_LIMIT = 20;', 'export const DEFAULT_LIMIT = 10;']],
    ['an empty limit is rejected instead of meaning "absent"', ['if (isAbsent(raw)) return DEFAULT_LIMIT;', 'if (raw === undefined) return DEFAULT_LIMIT;']],
    ['the default sort is oldest first', ["if (isAbsent(raw)) return { field: 'createdAt', direction: 'desc' };", "if (isAbsent(raw)) return { field: 'createdAt', direction: 'asc' };"]],
  ],
  limitBounds: [
    ['limit=0 is accepted', ["if (limit < 1) fail('limit'", "if (limit < 0) fail('limit'"]],
    ['limits above 100 are not clamped', ['return Math.min(limit, MAX_LIMIT);', 'return limit;']],
    ['limits above 100 are rejected instead of clamped', ['return Math.min(limit, MAX_LIMIT);', "if (limit > MAX_LIMIT) fail('limit', 'is too large'); return limit;"]],
    ['the clamp is off by one (100 becomes 99)', ['return Math.min(limit, MAX_LIMIT);', 'return Math.min(limit, MAX_LIMIT - 1);']],
  ],
  offsetBounds: [
    ['offset=10000 is rejected', ['if (offset > MAX_OFFSET)', 'if (offset >= MAX_OFFSET)']],
    ['offsets above 10000 are accepted', ['if (offset > MAX_OFFSET)', 'if (offset > MAX_OFFSET * 10)']],
  ],
  malformed: [
    ['numbers are read with parseInt, so "10abc" is 10', ['if (!DIGITS.test(raw)) fail(', "const n = Number.parseInt(raw, 10); if (!Number.isNaN(n)) return n; fail("]],
    ['numbers are read with Number(), so "1.5" and " 5" pass', ['if (!DIGITS.test(raw)) fail(', 'if (!Number.isFinite(Number(raw))) fail(']],
    ['the digit pattern is not anchored', ['const DIGITS = /^\\d+$/;', 'const DIGITS = /\\d+/;']],
  ],
  sort: [
    ['a leading minus is ignored, so "-title" sorts ascending', ['return { field: field as SortField, direction };', "return { field: field as SortField, direction: 'asc' };"]],
    ['an unknown sort field falls back to the default instead of failing', ['if (!SORT_FIELDS.includes(field)) fail(', "if (!SORT_FIELDS.includes(field)) return { field: 'createdAt', direction: 'desc' }; if (false) fail("]],
    ['"createdAt" without a minus sorts descending', ['return { field: field as SortField, direction };', "return { field: field as SortField, direction: field === 'createdAt' ? 'desc' : direction };"]],
  ],
  errors: [
    ['errors are plain Error, not RangeError', ['throw new RangeError(`${name} ${detail}`);', 'throw new Error(`${name} ${detail}`);']],
    ['error messages do not name the parameter', ['throw new RangeError(`${name} ${detail}`);', 'throw new RangeError(`invalid query parameter: ${detail}`);']],
  ],
};

/** Copies the learner's src/ and test/ into a fresh folder, with `implementation` as src/page-params.ts. */
function prepare(name, implementation) {
  const work = path.join(workRoot, name);
  mkdirSync(work, { recursive: true });
  writeFileSync(path.join(work, 'package.json'), JSON.stringify({ type: 'module' }));
  if (existsSync(path.join(dir, 'src'))) cpSync(path.join(dir, 'src'), path.join(work, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(work, 'test'), { recursive: true });
  mkdirSync(path.join(work, 'src'), { recursive: true });
  writeFileSync(path.join(work, 'src', 'page-params.ts'), implementation);
  return work;
}

/** Runs the learner's test files in `cwd` with the TAP reporter. Resolves to { ok, tests, failed, output }. */
function runTests(cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // otherwise the child reports to this runner instead of printing
  delete env.NODE_OPTIONS;
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--test', '--test-reporter=tap', '--test-timeout=10000', 'test/**/*.test.ts'],
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

let baselineRun;
function baseline() {
  baselineRun ??= (async () => {
    const testDir = path.join(dir, 'test');
    if (!existsSync(testDir)) return { problem: 'The submission has no test/ folder.' };
    const files = readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts'));
    if (files.length === 0) return { problem: 'No *.test.ts file was found in test/. Keep test/page-params.test.ts.' };
    const result = await runTests(prepare('reference', reference));
    return { ...result, problem: null };
  })();
  return baselineRun;
}

async function requireGreenBaseline() {
  const run = await baseline();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(
    run.ok && run.tests > 0,
    'Your tests must pass against the correct implementation before the checks can tell whether they catch bugs. ' +
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

test('tests-pass: your tests pass against the correct implementation', async () => {
  const run = await baseline();
  assert.ok(!run.problem, run.problem ?? '');
  assert.ok(run.tests > 0, `No tests ran. Output:\n${run.output.slice(-1500)}`);
  assert.ok(
    run.ok,
    `${run.failed} of ${run.tests} tests failed against the correct implementation. ` +
      `A test that fails on correct code is testing the wrong thing. Output:\n${run.output.slice(-2500)}`,
  );
});

test('catches-defaults: your tests catch wrong defaults', () => expectKilled('defaults'));

test('catches-limit-bounds: your tests catch mistakes at the limit boundaries', () => expectKilled('limitBounds'));

test('catches-offset-bounds: your tests catch mistakes at the offset boundaries', () => expectKilled('offsetBounds'));

test('catches-malformed-input: your tests catch malformed numbers being accepted', () => expectKilled('malformed'));

test('catches-sort: your tests catch mistakes in sort parsing', () => expectKilled('sort'));

test('catches-error-shape: your tests check the error type and message', () => expectKilled('errors'));
