// The learner's own tests: they must pass, and they must notice two broken stores.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
// The learner's tests get a prefix of their own inside the run's prefix, so whatever
// they leave behind can be found and removed afterwards.
const OWN_PREFIX = `${(process.env.AWS_RESOURCE_PREFIX ?? 'check-local-').toLowerCase()}own${randomUUID().slice(0, 6)}-`;

after(async () => {
  if (!process.env.AWS_ENDPOINT_URL) return;
  const S3 = createRequire(path.join(dir, 'package.json'))('@aws-sdk/client-s3');
  const s3 = new S3.S3Client({ forcePathStyle: true });
  try {
    const { Buckets = [] } = await s3.send(new S3.ListBucketsCommand({}));
    for (const { Name } of Buckets.filter((b) => b.Name?.startsWith(OWN_PREFIX))) {
      let token;
      do {
        const page = await s3.send(new S3.ListObjectsV2Command({ Bucket: Name, ContinuationToken: token }));
        const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
        if (keys.length > 0) await s3.send(new S3.DeleteObjectsCommand({ Bucket: Name, Delete: { Objects: keys, Quiet: true } }));
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      await s3.send(new S3.DeleteBucketCommand({ Bucket: Name }));
    }
  } finally {
    s3.destroy();
  }
});

function runTests(cwd) {
  // Without NODE_TEST_CONTEXT the nested run behaves like a top-level `node --test`.
  const { NODE_TEST_CONTEXT, NODE_OPTIONS, ...rest } = process.env;
  const env = { ...rest, AWS_RESOURCE_PREFIX: OWN_PREFIX };
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-timeout=15000', '--test-force-exit', 'test/**/*.test.ts'], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output });
    });
  });
}

const WRAP = `
const METHODS = ['put', 'head', 'getStream', 'list', 'listAll', 'delete', 'deleteMany'];
function wrapStore(real, overrides) {
  const store = {};
  for (const name of METHODS) store[name] = real[name].bind(real);
  return Object.assign(store, overrides);
}`;

const MUTANTS = [
  [
    'head and getStream reject with a plain Error instead of ObjectNotFoundError for a missing key',
    `export function createObjectStore(options) {
  const real = realCreateObjectStore(options);
  const plain = (fn) => async (...args) => {
    try { return await fn(...args); } catch (e) { if (e instanceof ObjectNotFoundError) throw new Error('not found'); throw e; }
  };
  return wrapStore(real, { head: plain(real.head.bind(real)), getStream: plain(real.getStream.bind(real)) });
}`,
  ],
  [
    'list ignores the cursor and always returns the first page',
    `export function createObjectStore(options) {
  const real = realCreateObjectStore(options);
  return wrapStore(real, { list: (opts = {}) => real.list({ ...opts, cursor: undefined }) });
}`,
  ],
];

/** A copy of the submission's src/ and test/ whose src/object-store.ts wraps the real one with a bug. */
function mutantDir(body) {
  const target = mkdtempSync(path.join(dir, '.mutant-'));
  writeFileSync(path.join(target, 'package.json'), JSON.stringify({ type: 'module' }));
  cpSync(path.join(dir, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(dir, 'test'), path.join(target, 'test'), { recursive: true });
  const real = JSON.stringify(pathToFileURL(path.join(dir, 'src', 'object-store.ts')).href);
  writeFileSync(
    path.join(target, 'src', 'object-store.ts'),
    `import { createObjectStore as realCreateObjectStore, ObjectNotFoundError } from ${real};\nexport * from ${real};\n// Broken on purpose.\n${WRAP}\n${body}\n`,
  );
  return target;
}

test('own-tests: your tests pass and catch a store with a wrong not-found error and a list that ignores the cursor', async () => {
  const testDir = path.join(dir, 'test');
  const files = existsSync(testDir) ? readdirSync(testDir, { recursive: true }).filter((f) => String(f).endsWith('.test.ts')) : [];
  assert.ok(files.length > 0, 'Add your tests as test/*.test.ts (node:test). None were found.');
  assert.ok(existsSync(path.join(dir, 'src', 'object-store.ts')), 'src/object-store.ts is missing from the submission.');

  const own = await runTests(dir);
  assert.ok(own.ok, `Your tests fail against your own src/object-store.ts:\n${own.output.slice(-2500)}`);

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
  assert.equal(survivors.length, 0, `Your tests still pass when the store has these bugs:\n${survivors.join('\n')}\nAdd a test that fails for each.`);
});
