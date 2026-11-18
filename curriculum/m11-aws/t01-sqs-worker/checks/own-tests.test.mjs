// The learner's own tests: they must pass, and they must notice two broken workers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
// The learner's tests get a prefix of their own inside the run's prefix, so whatever
// they leave behind can be removed without touching anything else.
const OWN_PREFIX = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}own-`;

after(async () => {
  if (!process.env.AWS_ENDPOINT_URL) return;
  const sdk = createRequire(path.join(dir, 'package.json'))('@aws-sdk/client-sqs');
  const sqs = new sdk.SQSClient({ useQueueUrlAsEndpoint: false });
  try {
    const listed = await sqs.send(new sdk.ListQueuesCommand({ QueueNamePrefix: OWN_PREFIX }));
    for (const url of listed.QueueUrls ?? []) await sqs.send(new sdk.DeleteQueueCommand({ QueueUrl: url })).catch(() => undefined);
  } finally {
    sqs.destroy();
  }
});

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, NODE_OPTIONS, ...rest } = process.env;
  const env = { ...rest, AWS_RESOURCE_PREFIX: OWN_PREFIX };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=20000', '--test-force-exit', 'test/**/*.test.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 50_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const MUTANTS = [
  [
    'a failing handler is treated as a success, so the message is deleted and never retried',
    'export function startWorker(options) {\n  return realStart({ ...options, handler: async (message) => { try { await options.handler(message); } catch {} } });\n}',
  ],
  [
    'every message is handled twice',
    'export function startWorker(options) {\n  return realStart({ ...options, handler: async (message) => { await options.handler(message); await options.handler(message); } });\n}',
  ],
];

/** A copy of the submission's src/ and test/ whose src/worker.ts wraps the real one with a bug. */
function mutantDir(body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = JSON.stringify(pathToFileURL(path.join(dir, 'src', 'worker.ts')).href);
  writeFileSync(
    path.join(target, 'src', 'worker.ts'),
    `import { startWorker as realStart } from ${real};\nexport * from ${real};\n// Broken on purpose.\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a worker that swallows failures and one that handles messages twice', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  assert.ok(existsSync(path.join(dir, 'src', 'worker.ts')), 'src/worker.ts is missing from the submission.');

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own src/worker.ts:\n${own.output.slice(-2500)}`);

  // The mutants run at the same time; each test creates queues with a random suffix.
  const results = await Promise.all(
    MUTANTS.map(async ([label, body]) => {
      const target = mutantDir(body);
      try {
        return { label, run: await runTests(target) };
      } finally {
        rmSync(target, { recursive: true, force: true });
      }
    }),
  );
  const survivors = results.filter((r) => r.run.ok).map((r) => `  - ${r.label}`);
  assert.equal(survivors.length, 0, `Your tests still pass when the worker has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
