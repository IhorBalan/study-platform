// Checks for "Direct uploads with presigned URLs". Node built-ins only; Nest and the AWS SDK
// come from the submission's node_modules. The app runs in this process on a random port.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const PREFIX = (process.env.AWS_RESOURCE_PREFIX ?? 'check-local-').toLowerCase();
const BUCKET = `${PREFIX}t02-${randomUUID().slice(0, 8)}`;
const MAX = 10 * 1024 * 1024;

const require = createRequire(path.join(dir, 'package.json'));
const S3 = require('@aws-sdk/client-s3');
const admin = new S3.S3Client({ forcePathStyle: true });

const state = { compileOutput: null, bootError: null, app: null, base: null };

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return output.slice(0, 4000) || `tsc exited with status ${result.status}`;
}

async function boot() {
  const entry = path.join(dir, 'dist', 'app.module.js');
  if (!existsSync(entry)) throw new Error('dist/app.module.js was not produced. Keep src/app.module.ts and outDir "dist".');
  process.env.UPLOADS_BUCKET = BUCKET;
  await import(pathToFileURL(require.resolve('reflect-metadata')).href);
  const { NestFactory } = await import(pathToFileURL(require.resolve('@nestjs/core')).href);
  const { AppModule } = await import(pathToFileURL(entry).href);
  if (typeof AppModule !== 'function') throw new Error('src/app.module.ts must export a class named AppModule.');
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  state.app = app;
  await app.listen(0, '127.0.0.1');
  state.base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
}

before(async () => {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set. Start the emulator with `pnpm lab up aws`.');
  await admin.send(new S3.CreateBucketCommand({ Bucket: BUCKET }));
  state.compileOutput = compile();
  if (state.compileOutput) return;
  try {
    await boot();
  } catch (error) {
    state.bootError = String(error?.message ?? error).slice(0, 1500);
  }
});

after(async () => {
  await state.app?.close();
  try {
    let token;
    do {
      const page = await admin.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, ContinuationToken: token }));
      const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
      if (keys.length > 0) await admin.send(new S3.DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: keys, Quiet: true } }));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    await admin.send(new S3.DeleteBucketCommand({ Bucket: BUCKET }));
  } finally {
    admin.destroy();
  }
});

/** A user id unique to this run, so keys never collide with another run's. */
const user = (name) => `${name}-${randomUUID().slice(0, 6)}`;

async function api(method, url, { userId, body } = {}) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  const headers = {};
  if (userId) headers['x-user-id'] = userId;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(state.base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PDF = Buffer.from('%PDF-1.7\n');
const fileOf = (head, size) => Buffer.concat([head, randomBytes(size - head.length)]);

async function requestUpload(userId, contentType, size) {
  const res = await api('POST', '/uploads', { userId, body: { contentType, size } });
  assert.equal(res.status, 201, `POST /uploads with a valid ${contentType} of ${size} bytes should answer 201, got ${res.status}: ${res.text.slice(0, 300)}`);
  assert.equal(typeof res.json?.key, 'string', 'POST /uploads should answer with a key.');
  assert.equal(typeof res.json?.uploadUrl, 'string', 'POST /uploads should answer with an uploadUrl.');
  return res.json;
}

async function putTo(upload, bytes, contentType) {
  const res = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType ?? upload.headers?.['content-type'] },
    body: bytes,
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(res.status, 200, `Uploading to the presigned URL should succeed, got ${res.status}: ${(await res.text()).slice(0, 300)}`);
}

async function exists(key) {
  try {
    await admin.send(new S3.HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

/** Requests, uploads and completes a file. Returns the key and the bytes. */
async function uploaded(userId, head = PNG, contentType = 'image/png', size = 2048) {
  const bytes = fileOf(head, size);
  const upload = await requestUpload(userId, contentType, size);
  await putTo(upload, bytes);
  const done = await api('POST', '/uploads/complete', { userId, body: { key: upload.key } });
  assert.equal(done.status, 200, `POST /uploads/complete after a valid upload should answer 200, got ${done.status}: ${done.text.slice(0, 300)}`);
  return { key: upload.key, bytes };
}

test('compiles: the project compiles with tsc', () => {
  assert.equal(state.compileOutput, null, `tsc failed:\n${state.compileOutput}`);
});

test('validates-request: POST /uploads accepts only allowed types and sizes up to 10 MiB', async () => {
  const alice = user('alice');
  const none = await api('POST', '/uploads', { body: { contentType: 'image/png', size: 100 } });
  assert.equal(none.status, 401, `A request without x-user-id should get 401, got ${none.status}.`);

  const bad = [
    [{ contentType: 'text/html', size: 100 }, 'a content type that is not allowed (text/html)'],
    [{ contentType: 'image/svg+xml', size: 100 }, 'SVG, which can carry scripts'],
    [{ size: 100 }, 'a missing contentType'],
    [{ contentType: 'image/png', size: 0 }, 'size 0'],
    [{ contentType: 'image/png', size: -5 }, 'a negative size'],
    [{ contentType: 'image/png', size: 1.5 }, 'a fractional size'],
    [{ contentType: 'image/png', size: '100' }, 'a size sent as a string'],
    [{ contentType: 'image/png', size: MAX + 1 }, 'one byte over 10 MiB'],
    [{ contentType: 'image/png' }, 'a missing size'],
  ];
  for (const [body, label] of bad) {
    const res = await api('POST', '/uploads', { userId: alice, body });
    assert.equal(res.status, 400, `POST /uploads with ${label} should get 400, got ${res.status}.`);
  }
  for (const contentType of ['image/png', 'image/jpeg', 'application/pdf']) {
    const res = await api('POST', '/uploads', { userId: alice, body: { contentType, size: MAX } });
    assert.equal(res.status, 201, `POST /uploads with ${contentType} of exactly 10 MiB should get 201, got ${res.status}: ${res.text.slice(0, 200)}`);
  }
});

test('upload-url: the presigned PUT is scoped to a fresh key in the user namespace, signs type and length, and expires within 5 minutes', async () => {
  const alice = user('alice');
  const before = Date.now();
  const a = await requestUpload(alice, 'image/png', 1234);
  const b = await requestUpload(alice, 'application/pdf', 1234);

  assert.match(a.key, new RegExp(`^users/${alice}/[^/]+\\.png$`), `The key should look like users/<userId>/<generated name>.png, got "${a.key}".`);
  assert.match(b.key, new RegExp(`^users/${alice}/[^/]+\\.pdf$`), `A PDF's key should end in .pdf, got "${b.key}".`);
  const c = await requestUpload(alice, 'image/png', 1234);
  assert.notEqual(a.key, c.key, 'Two upload requests must get two different keys.');
  assert.equal(a.method, 'PUT', 'The response should say method: "PUT".');
  assert.equal(a.headers?.['content-type'], 'image/png', 'The response should tell the client which content-type header to send, under headers["content-type"].');
  const expiresAt = Date.parse(a.expiresAt);
  assert.ok(Number.isFinite(expiresAt), `expiresAt should be an ISO date string, got ${JSON.stringify(a.expiresAt)}.`);
  assert.ok(expiresAt > before && expiresAt <= Date.now() + 300_000 + 2000, 'expiresAt should be in the future and at most 5 minutes away.');

  const url = new URL(a.uploadUrl);
  const q = url.searchParams;
  assert.equal(decodeURIComponent(url.pathname), `/${BUCKET}/${a.key}`, `The URL should point at the uploads bucket and the returned key, got ${url.pathname}.`);
  assert.equal(q.get('x-id'), 'PutObject', 'The URL should be a presigned PutObject.');
  const expires = Number(q.get('X-Amz-Expires'));
  assert.ok(expires > 0 && expires <= 300, `The upload URL should expire within 300 seconds, X-Amz-Expires is ${q.get('X-Amz-Expires')}.`);
  const signed = (q.get('X-Amz-SignedHeaders') ?? '').split(';');
  assert.ok(
    signed.includes('content-type'),
    `The signature should cover content-type, so the client cannot upload another type with this URL. Signed headers: ${signed.join(';')}.`,
  );
  assert.ok(
    signed.includes('content-length'),
    `The signature should cover content-length, so the client cannot upload more bytes than it asked for. Signed headers: ${signed.join(';')}.`,
  );
  const checksum = [...q.keys()].find((k) => k.toLowerCase().startsWith('x-amz-checksum-'));
  assert.equal(
    checksum,
    undefined,
    `The URL contains ${checksum}=${q.get(checksum)}, a checksum of an empty body. Real S3 would reject every non-empty upload to it. Configure the client so it only adds checksums when an operation requires one.`,
  );

  await putTo(a, fileOf(PNG, 1234));
  assert.ok(await exists(a.key), 'After a PUT to the presigned URL the object should exist.');
});

test('complete: a valid upload is confirmed with its key, size and content type', async () => {
  const alice = user('alice');
  for (const [head, contentType] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [PDF, 'application/pdf']]) {
    const upload = await requestUpload(alice, contentType, 4096);
    await putTo(upload, fileOf(head, 4096));
    const res = await api('POST', '/uploads/complete', { userId: alice, body: { key: upload.key } });
    assert.equal(res.status, 200, `Completing a valid ${contentType} upload should answer 200, got ${res.status}: ${res.text.slice(0, 300)}`);
    assert.deepEqual(res.json, { key: upload.key, size: 4096, contentType }, 'The response should be { key, size, contentType }.');
    assert.ok(await exists(upload.key), 'A confirmed upload must stay in the bucket.');
  }
});

test('ownership: another user cannot complete or download your key, and unknown keys are 404', async () => {
  const alice = user('alice');
  const bob = user('bob');
  const upload = await requestUpload(alice, 'image/png', 2048);
  await putTo(upload, fileOf(PNG, 2048));

  const steal = await api('POST', '/uploads/complete', { userId: bob, body: { key: upload.key } });
  assert.equal(steal.status, 403, `Bob completing Alice's key should get 403, got ${steal.status}.`);
  const ok = await api('POST', '/uploads/complete', { userId: alice, body: { key: upload.key } });
  assert.equal(ok.status, 200, `Alice completing her own key should get 200, got ${ok.status}: ${ok.text.slice(0, 200)}`);
  const peek = await api('GET', `/downloads?key=${encodeURIComponent(upload.key)}`, { userId: bob });
  assert.equal(peek.status, 403, `Bob asking for a download URL for Alice's file should get 403, got ${peek.status}.`);

  const invented = `users/${alice}/${randomUUID()}.png`;
  const unknown = await api('POST', '/uploads/complete', { userId: alice, body: { key: invented } });
  assert.equal(unknown.status, 404, `Completing a key in your namespace that the server never issued should get 404, got ${unknown.status}.`);
  const unknownDl = await api('GET', `/downloads?key=${encodeURIComponent(invented)}`, { userId: alice });
  assert.equal(unknownDl.status, 404, `A download URL for a key the server never issued should get 404, got ${unknownDl.status}.`);
});

test('not-uploaded: completing before the upload is 404, and an uncompleted upload cannot be downloaded', async () => {
  const alice = user('alice');
  const upload = await requestUpload(alice, 'image/png', 2048);
  const early = await api('POST', '/uploads/complete', { userId: alice, body: { key: upload.key } });
  assert.equal(early.status, 404, `Completing a key before anything was uploaded should get 404, got ${early.status}.`);

  await putTo(upload, fileOf(PNG, 2048));
  const dl = await api('GET', `/downloads?key=${encodeURIComponent(upload.key)}`, { userId: alice });
  assert.equal(dl.status, 404, `A file that was uploaded but not completed (so not checked) should not be downloadable: expected 404, got ${dl.status}.`);
});

test('rejects-mismatch: an upload whose size, type or content differs from the request is refused and deleted', async () => {
  const alice = user('alice');
  const cases = [
    ['more bytes than declared', 'image/png', 1000, fileOf(PNG, 3000), 'image/png'],
    ['a different content-type header', 'image/png', 2000, fileOf(PNG, 2000), 'image/jpeg'],
    ['HTML bytes declared as a PNG', 'image/png', 2000, fileOf(Buffer.from('<html><script>'), 2000), 'image/png'],
    ['PNG bytes declared as a PDF', 'application/pdf', 2000, fileOf(PNG, 2000), 'application/pdf'],
  ];
  for (const [label, contentType, size, bytes, sentType] of cases) {
    const upload = await requestUpload(alice, contentType, size);
    // The emulator does not enforce signed headers, so this PUT succeeds the way a request
    // from a buggy or hostile client could where the signature is not checked.
    await putTo(upload, bytes, sentType);
    const res = await api('POST', '/uploads/complete', { userId: alice, body: { key: upload.key } });
    assert.equal(res.status, 422, `Completing an upload with ${label} should get 422, got ${res.status}: ${res.text.slice(0, 200)}`);
    assert.equal(await exists(upload.key), false, `An upload rejected for ${label} should be deleted from the bucket.`);
    const dl = await api('GET', `/downloads?key=${encodeURIComponent(upload.key)}`, { userId: alice });
    assert.equal(dl.status, 404, `A rejected upload should not be downloadable: expected 404, got ${dl.status}.`);
  }
});

test('download-url: a completed file gets a presigned GET that works and expires within 60 seconds', async () => {
  const alice = user('alice');
  const { key, bytes } = await uploaded(alice, PDF, 'application/pdf', 5000);
  const res = await api('GET', `/downloads?key=${encodeURIComponent(key)}`, { userId: alice });
  assert.equal(res.status, 200, `GET /downloads for a completed file should answer 200, got ${res.status}: ${res.text.slice(0, 200)}`);
  assert.equal(typeof res.json?.url, 'string', 'GET /downloads should answer { url, expiresAt }.');
  assert.ok(Number.isFinite(Date.parse(res.json.expiresAt)), 'expiresAt should be an ISO date string.');
  const url = new URL(res.json.url);
  assert.equal(url.searchParams.get('x-id'), 'GetObject', 'The download URL should be a presigned GetObject.');
  const expires = Number(url.searchParams.get('X-Amz-Expires'));
  assert.ok(expires > 0 && expires <= 60, `The download URL should expire within 60 seconds, X-Amz-Expires is ${url.searchParams.get('X-Amz-Expires')}.`);
  const file = await fetch(res.json.url, { signal: AbortSignal.timeout(10_000) });
  assert.equal(file.status, 200, `Fetching the download URL should succeed, got ${file.status}.`);
  assert.ok(Buffer.from(await file.arrayBuffer()).equals(bytes), 'The download URL should return the uploaded bytes.');
});
