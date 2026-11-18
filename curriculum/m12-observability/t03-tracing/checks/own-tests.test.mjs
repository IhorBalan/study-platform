// The learner's own tests: they must pass, and they must notice two broken copies.
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
    'the call to pricing carries no trace context',
    'app.ts',
    'createApp',
    [
      'export function createApp(options) {',
      '  const realFetch = globalThis.fetch;',
      '  globalThis.fetch = (input, init = {}) => {',
      "    const url = String(input instanceof Request ? input.url : input);",
      '    if (!url.startsWith(options.pricingUrl)) return realFetch(input, init);',
      '    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));',
      "    headers.delete('traceparent');",
      "    headers.delete('tracestate');",
      '    return realFetch(input, { ...init, headers });',
      '  };',
      '  return real(options);',
      '}',
    ].join('\n'),
  ],
  [
    'errors are never recorded on spans',
    'tracing.ts',
    'startTracing',
    [
      'export function startTracing(exporter) {',
      '  const scrubbed = {',
      '    export(spans, done) {',
      '      const clean = spans.map((span) => Object.create(span, {',
      '        status: { value: { code: 0 } },',
      "        events: { value: span.events.filter((e) => e.name !== 'exception') },",
      '      }));',
      '      return exporter.export(clean, done);',
      '    },',
      '    shutdown: () => exporter.shutdown(),',
      '    forceFlush: () => exporter.forceFlush?.() ?? Promise.resolve(),',
      '  };',
      '  return real(scrubbed);',
      '}',
    ].join('\n'),
  ],
];

/** A copy of the submission's src/ and test/ in which one file wraps the real one with a bug. */
function mutantDir(file, name, body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const realFile = JSON.stringify(pathToFileURL(path.join(dir, 'src', file)).href);
  writeFileSync(
    path.join(target, 'src', file),
    `import { ${name} as real } from ${realFile};\nexport * from ${realFile};\n// Broken on purpose.\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a lost traceparent and errors that are not recorded', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  for (const file of ['app.ts', 'tracing.ts']) {
    assert.ok(existsSync(path.join(dir, 'src', file)), `src/${file} is missing from the submission.`);
  }

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own code:\n${own.output.slice(-2500)}`);

  const survivors = [];
  for (const [label, file, name, body] of MUTANTS) {
    const target = mutantDir(file, name, body);
    try {
      const run = await runTests(target);
      if (run.ok) survivors.push(`  - ${label}`);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  }
  assert.equal(survivors.length, 0, `Your tests still pass when the app has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
