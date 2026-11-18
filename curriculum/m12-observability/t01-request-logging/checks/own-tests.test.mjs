// The learner's own tests: they must pass, and they must notice two broken apps.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, NODE_OPTIONS, ...env } = process.env;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=15000', '--test-force-exit', 'test/**/*.test.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 40_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const MUTANTS = [
  [
    'a debug line writes every request body, password included, to the log',
    [
      "import express from 'express';",
      'export function createApp(options = {}) {',
      '  const destination = options.destination ?? process.stdout;',
      '  const outer = express();',
      '  outer.use(express.json());',
      '  outer.use((req, _res, next) => {',
      "    if (req.body && typeof req.body === 'object') destination.write(JSON.stringify({ level: 30, time: Date.now(), msg: 'debug body', body: req.body }) + '\\n');",
      '    next();',
      '  });',
      '  outer.use(realCreate(options));',
      '  return outer;',
      '}',
    ].join('\n'),
  ],
  [
    'lines written inside handlers lose the request id',
    [
      'export function createApp(options = {}) {',
      '  const destination = options.destination ?? process.stdout;',
      '  const stripped = {',
      '    write(chunk) {',
      '      let out = String(chunk);',
      '      try {',
      '        const line = JSON.parse(out);',
      "        if (line.msg !== 'request completed') { delete line.reqId; out = JSON.stringify(line) + '\\n'; }",
      '      } catch {}',
      '      return destination.write(out);',
      '    },',
      '  };',
      '  return realCreate({ ...options, destination: stripped });',
      '}',
    ].join('\n'),
  ],
];

/** A copy of the submission's src/ and test/ whose src/app.ts wraps the real one with a bug. */
function mutantDir(body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = JSON.stringify(pathToFileURL(path.join(dir, 'src', 'app.ts')).href);
  writeFileSync(
    path.join(target, 'src', 'app.ts'),
    `import { createApp as realCreate } from ${real};\nexport * from ${real};\n// Broken on purpose.\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a body that is logged and lines without the request id', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  assert.ok(existsSync(path.join(dir, 'src', 'app.ts')), 'src/app.ts is missing from the submission.');

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own src/app.ts:\n${own.output.slice(-2500)}`);

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
  assert.equal(survivors.length, 0, `Your tests still pass when the app has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
