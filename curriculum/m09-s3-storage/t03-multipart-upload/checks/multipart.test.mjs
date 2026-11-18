// Checks for "Multipart upload and lifecycle rules". Node built-ins only; the AWS SDK comes from
// the submission's node_modules. Node runs the submission's .ts files directly by stripping types.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const PREFIX = (process.env.AWS_RESOURCE_PREFIX ?? 'check-local-').toLowerCase();
const BUCKET = `${PREFIX}t03-${randomUUID().slice(0, 8)}`;
const LIFECYCLE_BUCKET = `${PREFIX}t03l-${randomUUID().slice(0, 8)}`;
const MiB = 1024 * 1024;

const S3 = createRequire(path.join(dir, 'package.json'))('@aws-sdk/client-s3');
const admin = new S3.S3Client({ forcePathStyle: true });

before(async () => {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set. Start the emulator with `pnpm lab up aws`.');
  await admin.send(new S3.CreateBucketCommand({ Bucket: BUCKET }));
  await admin.send(new S3.CreateBucketCommand({ Bucket: LIFECYCLE_BUCKET }));
});

async function emptyAndDelete(bucket) {
  const uploads = await admin.send(new S3.ListMultipartUploadsCommand({ Bucket: bucket }));
  for (const u of uploads.Uploads ?? []) {
    await admin.send(new S3.AbortMultipartUploadCommand({ Bucket: bucket, Key: u.Key, UploadId: u.UploadId }));
  }
  let token;
  do {
    const page = await admin.send(new S3.ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((o) => ({ Key: o.Key }));
    if (keys.length > 0) await admin.send(new S3.DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys, Quiet: true } }));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  await admin.send(new S3.DeleteBucketCommand({ Bucket: bucket }));
}

after(async () => {
  try {
    await emptyAndDelete(BUCKET);
    await emptyAndDelete(LIFECYCLE_BUCKET);
  } finally {
    admin.destroy();
  }
});

const loaded = new Map();
async function load(name, exportName) {
  const file = path.join(dir, 'src', `${name}.ts`);
  assert.ok(existsSync(file), `src/${name}.ts is missing from the submission.`);
  if (!loaded.has(name)) loaded.set(name, import(pathToFileURL(file).href));
  const mod = await loaded.get(name);
  assert.equal(typeof mod[exportName], 'function', `src/${name}.ts must export a function named ${exportName}.`);
  return mod[exportName];
}

/**
 * A client that records commands and part uploads. `delayMs` slows UploadPart down so overlap is
 * visible; `failPart` makes that part number fail.
 */
function spyClient({ delayMs = 0, failPart } = {}) {
  const log = { commands: [], parts: [], inFlight: 0, maxInFlight: 0, completedBytes: 0 };
  const spy = Object.create(admin);
  spy.send = async (command, ...rest) => {
    log.commands.push(command);
    if (!(command instanceof S3.UploadPartCommand)) return admin.send(command, ...rest);
    const { PartNumber, Body } = command.input;
    log.parts.push({ number: PartNumber, bytes: Body?.length ?? Body?.byteLength ?? -1 });
    log.inFlight += 1;
    log.maxInFlight = Math.max(log.maxInFlight, log.inFlight);
    try {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (PartNumber === failPart) throw new Error('injected failure in UploadPart');
      const res = await admin.send(command, ...rest);
      log.completedBytes += Body?.length ?? Body?.byteLength ?? 0;
      return res;
    } finally {
      log.inFlight -= 1;
    }
  };
  return { client: spy, log };
}

/** Yields `total` bytes of random data in chunks of `chunk` bytes, tracking how much was read. */
function source(total, chunk = MiB, { failAfter, onYield } = {}) {
  const data = randomBytes(total);
  const tracker = { read: 0, data };
  tracker.body = (async function* () {
    for (let offset = 0; offset < total; offset += chunk) {
      if (failAfter !== undefined && offset >= failAfter) throw new Error('injected failure in the source');
      const piece = data.subarray(offset, Math.min(offset + chunk, total));
      tracker.read += piece.length;
      onYield?.(tracker.read);
      yield piece;
    }
  })();
  return tracker;
}

async function stored(key) {
  const res = await admin.send(new S3.GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return { bytes: Buffer.from(await res.Body.transformToByteArray()), contentType: res.ContentType };
}

async function leftovers(key) {
  const res = await admin.send(new S3.ListMultipartUploadsCommand({ Bucket: BUCKET, Prefix: key }));
  return (res.Uploads ?? []).filter((u) => u.Key === key).length;
}

async function objectExists(key) {
  const res = await admin.send(new S3.ListObjectsV2Command({ Bucket: BUCKET, Prefix: key }));
  return (res.Contents ?? []).some((o) => o.Key === key);
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('completes: a 12 MiB body arrives intact as a 3-part upload with its content type', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');
  const key = `big/${randomUUID()}.bin`;
  const src = source(12 * MiB + 123, 256 * 1024);
  const result = await uploadLarge({ client: admin, bucket: BUCKET, key, body: src.body, partSize: 5 * MiB, contentType: 'application/x-test' });

  const { bytes, contentType } = await stored(key);
  assert.equal(bytes.length, src.data.length, `The stored object has ${bytes.length} bytes, expected ${src.data.length}.`);
  assert.equal(sha(bytes), sha(src.data), 'The stored bytes differ from the source. Check the order of the parts and that no chunk is lost or repeated.');
  assert.equal(contentType, 'application/x-test', 'The content type should be set when the upload is created.');
  assert.match(String(result?.etag), /-3"?$/, `A 3-part multipart upload has an ETag ending in -3, got ${JSON.stringify(result?.etag)}.`);
  assert.equal(result.parts, 3, `uploadLarge should resolve with parts: 3, got ${result.parts}.`);
  assert.equal(result.size, src.data.length, `uploadLarge should resolve with size: ${src.data.length}, got ${result.size}.`);
  assert.equal(await leftovers(key), 0, 'A completed upload should leave no multipart upload open.');
});

test('part-boundaries: every part except the last is exactly partSize, numbered from 1, whatever the chunk sizes', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');
  const key = `odd/${randomUUID()}.bin`;
  const data = randomBytes(16 * MiB + 7);
  const sizes = [1000, 7 * MiB, 3, 2 * MiB + 11, 4 * MiB, 1];
  async function* oddChunks() {
    let offset = 0;
    let i = 0;
    while (offset < data.length) {
      const end = Math.min(offset + sizes[i++ % sizes.length], data.length);
      yield data.subarray(offset, end);
      offset = end;
    }
  }
  const { client, log } = spyClient();
  await uploadLarge({ client, bucket: BUCKET, key, body: oddChunks(), partSize: 5 * MiB });

  const parts = [...log.parts].sort((a, b) => a.number - b.number);
  assert.deepEqual(parts.map((p) => p.number), [1, 2, 3, 4], `Expected parts 1 to 4, got ${parts.map((p) => p.number).join(', ')}.`);
  assert.deepEqual(
    parts.map((p) => p.bytes),
    [5 * MiB, 5 * MiB, 5 * MiB, MiB + 7],
    `Part sizes should be 5 MiB, 5 MiB, 5 MiB and the remaining ${MiB + 7} bytes. Got: ${parts.map((p) => p.bytes).join(', ')}.`,
  );
  const { bytes } = await stored(key);
  assert.equal(sha(bytes), sha(data), 'The stored bytes differ from the source.');
});

test('small-body: a body smaller than one part is stored correctly', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');
  const key = `small/${randomUUID()}.txt`;
  const data = Buffer.from('a small file, well under one part');
  async function* once() {
    yield data;
  }
  await uploadLarge({ client: admin, bucket: BUCKET, key, body: once(), partSize: 5 * MiB });
  const { bytes } = await stored(key);
  assert.ok(bytes.equals(data), 'A body smaller than partSize should be stored as it is.');
  assert.equal(await leftovers(key), 0, 'No multipart upload should be left open.');
});

test('min-part-size: partSize under 5 MiB is rejected with a RangeError before any request', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');
  const { client, log } = spyClient();
  const src = source(MiB);
  await assert.rejects(
    uploadLarge({ client, bucket: BUCKET, key: `x/${randomUUID()}`, body: src.body, partSize: 5 * MiB - 1 }),
    RangeError,
    'partSize below 5 MiB (5242880 bytes) should reject with a RangeError.',
  );
  assert.equal(log.commands.length, 0, `A rejected partSize should not send any request, ${log.commands.length} were sent.`);
});

test('bounded: at most `concurrency` parts are in flight, in parallel, and the source is not read far ahead', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');
  const key = `bounded/${randomUUID()}.bin`;
  const { client, log } = spyClient({ delayMs: 150 });
  let worstAhead = 0;
  const src = source(30 * MiB, MiB, {
    onYield: (read) => {
      worstAhead = Math.max(worstAhead, read - log.completedBytes);
    },
  });
  await uploadLarge({ client, bucket: BUCKET, key, body: src.body, partSize: 5 * MiB, concurrency: 2 });

  assert.ok(log.maxInFlight <= 2, `With concurrency 2, up to ${log.maxInFlight} parts were uploading at the same time.`);
  assert.equal(log.maxInFlight, 2, 'With concurrency 2 and six parts, two parts should upload at the same time. They were uploaded one after another.');
  const limit = (2 + 2) * 5 * MiB;
  assert.ok(
    worstAhead <= limit,
    `The upload read ${(worstAhead / MiB).toFixed(1)} MiB from the source beyond what S3 had confirmed. With concurrency 2 and 5 MiB parts it should stay under ${limit / MiB} MiB, so memory does not grow with the file size.`,
  );
  const { bytes } = await stored(key);
  assert.equal(sha(bytes), sha(src.data), 'The stored bytes differ from the source.');
});

test('aborts: a failure in the source or in S3 aborts the upload, leaves nothing behind and rethrows the error', async () => {
  const uploadLarge = await load('multipart', 'uploadLarge');

  const key1 = `fail/${randomUUID()}.bin`;
  const { client: c1, log: l1 } = spyClient();
  const src = source(20 * MiB, MiB, { failAfter: 11 * MiB });
  await assert.rejects(
    uploadLarge({ client: c1, bucket: BUCKET, key: key1, body: src.body, partSize: 5 * MiB }),
    /injected failure in the source/,
    'An error thrown by the source should reach the caller unchanged.',
  );
  assert.ok(l1.parts.length >= 1, 'The source failed after 11 MiB, so at least one part should have been uploaded first.');
  assert.ok(l1.commands.some((c) => c instanceof S3.AbortMultipartUploadCommand), 'After a failure, uploadLarge should send AbortMultipartUpload.');
  assert.equal(await leftovers(key1), 0, 'After a failure in the source, no multipart upload should be left open: its parts would be billed forever.');
  assert.equal(await objectExists(key1), false, 'After a failure, no object should exist at the key.');

  const key2 = `fail/${randomUUID()}.bin`;
  const { client: c2 } = spyClient({ failPart: 2, delayMs: 20 });
  await assert.rejects(
    uploadLarge({ client: c2, bucket: BUCKET, key: key2, body: source(18 * MiB).body, partSize: 5 * MiB, concurrency: 2 }),
    /injected failure in UploadPart/,
    'An error from UploadPart should reach the caller unchanged.',
  );
  assert.equal(await leftovers(key2), 0, 'After a failed part, no multipart upload should be left open.');
  assert.equal(await objectExists(key2), false, 'After a failed part, no object should exist at the key.');
});

test('lifecycle: applyHousekeeping aborts incomplete uploads after 1 day and expires tmp/ after 7 days', async () => {
  const applyHousekeeping = await load('housekeeping', 'applyHousekeeping');
  await applyHousekeeping(admin, LIFECYCLE_BUCKET);
  await applyHousekeeping(admin, LIFECYCLE_BUCKET);

  const { Rules = [] } = await admin.send(new S3.GetBucketLifecycleConfigurationCommand({ Bucket: LIFECYCLE_BUCKET }));
  const prefixOf = (r) => r.Filter?.Prefix ?? r.Filter?.And?.Prefix ?? r.Prefix ?? '';
  const enabled = Rules.filter((r) => r.Status === 'Enabled');

  const abort = enabled.find((r) => r.AbortIncompleteMultipartUpload);
  assert.ok(abort, 'Expected an enabled rule with AbortIncompleteMultipartUpload.');
  assert.equal(abort.AbortIncompleteMultipartUpload.DaysAfterInitiation, 1, 'Incomplete multipart uploads should be aborted 1 day after they start.');
  assert.equal(prefixOf(abort), '', 'The abort rule should apply to the whole bucket (an empty filter or prefix).');

  const tmp = enabled.find((r) => r.Expiration && prefixOf(r) === 'tmp/');
  assert.ok(tmp, 'Expected an enabled rule that expires objects under the prefix "tmp/".');
  assert.equal(tmp.Expiration.Days, 7, 'Objects under tmp/ should expire after 7 days.');
  assert.equal(Rules.length, 2, `Calling applyHousekeeping twice should leave exactly the two rules, found ${Rules.length}.`);
});
