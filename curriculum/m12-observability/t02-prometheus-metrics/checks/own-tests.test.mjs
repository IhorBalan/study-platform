// The learner's own tests: they must pass, and they must notice two broken /metrics outputs.
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

// Both mutants wrap the real app in an outer Express app that rewrites the /metrics response.
const PATCH_METRICS = [
  "import express from 'express';",
  'function rewriteMetrics(app, rewrite, observe = () => {}) {',
  '  const outer = express();',
  '  outer.use((req, res, next) => {',
  '    observe(req);',
  "    if (req.path !== '/metrics') return next();",
  '    const end = res.end.bind(res);',
  '    res.end = (chunk, ...rest) => {',
  "      if (chunk !== undefined && chunk !== null && typeof chunk !== 'function') {",
  "        if (!res.headersSent) res.removeHeader('content-length');",
  '        return end(rewrite(String(chunk)), ...rest);',
  '      }',
  '      return end(chunk, ...rest);',
  '    };',
  '    next();',
  '  });',
  '  outer.use(app);',
  '  return outer;',
  '}',
].join('\n');

const MUTANTS = [
  [
    'http_requests_total never grows',
    [
      PATCH_METRICS,
      'export function createApp(...args) {',
      '  return rewriteMetrics(realCreate(...args), (text) =>',
      "    text.replace(/^(http_requests_total(?:\\{[^}]*\\})?) .*$/gm, '$1 0'));",
      '}',
    ].join('\n'),
  ],
  [
    'every raw path becomes a route label value',
    [
      PATCH_METRICS,
      'export function createApp(...args) {',
      '  const seen = new Map();',
      '  return rewriteMetrics(',
      '    realCreate(...args),',
      '    (text) => {',
      "      const extra = [...seen].map(([p, n]) => `http_requests_total{method=\"GET\",route=${JSON.stringify(p)},status_code=\"200\"} ${n}`).join('\\n');",
      "      return extra ? text.replace(/^(# TYPE http_requests_total counter)$/m, `$1\\n${extra}`) : text;",
      '    },',
      "    (req) => { if (req.path !== '/metrics') seen.set(req.originalUrl, (seen.get(req.originalUrl) ?? 0) + 1); },",
      '  );',
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

test('own-tests: your tests pass and catch a counter that never grows and raw paths in the route label', async () => {
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
