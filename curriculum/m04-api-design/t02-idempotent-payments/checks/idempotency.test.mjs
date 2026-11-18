// Checks for "Idempotent payments". Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { compileOutput: null, loadError: null, AppModule: null, NestFactory: null };

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60_000,
  });
  if (result.status === 0) return null;
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return output.slice(0, 4000) || `tsc exited with status ${result.status}`;
}

before(async () => {
  state.compileOutput = compile();
  if (state.compileOutput) return;
  try {
    const entry = path.join(dir, 'dist', 'app.module.js');
    if (!existsSync(entry)) throw new Error('dist/app.module.js was not produced. Keep src/app.module.ts and outDir "dist".');
    await importFromSubmission('reflect-metadata');
    state.NestFactory = (await importFromSubmission('@nestjs/core')).NestFactory;
    state.AppModule = (await import(pathToFileURL(entry).href)).AppModule;
    if (typeof state.AppModule !== 'function') throw new Error('src/app.module.ts must export a class named AppModule.');
  } catch (error) {
    state.loadError = String(error?.message ?? error).slice(0, 1500);
  }
});

/** Creates a fresh app (fresh store) for one test and always closes it. */
async function withApp(fn) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.loadError, `The app could not be loaded: ${state.loadError}`);
  const app = await state.NestFactory.create(state.AppModule, { logger: false, abortOnError: false });
  await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
  try {
    return await fn(base);
  } finally {
    await app.close();
  }
}

async function call(base, method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, type: res.headers.get('content-type') ?? '', headers: res.headers, text, json };
}

const show = (res) => res.text.slice(0, 200) || '(empty body)';


let keyCounter = 0;
const newKey = () => `chk-${process.pid}-${Date.now()}-${(keyCounter += 1)}`;

function pay(base, body, key) {
  return call(base, 'POST', '/payments', body, key === undefined ? {} : { 'idempotency-key': key });
}

async function paymentCount(base) {
  const res = await call(base, 'GET', '/payments');
  assert.equal(res.status, 200, `GET /payments: expected status 200, got ${res.status}`);
  assert.ok(Array.isArray(res.json), `GET /payments: expected a JSON array, got: ${show(res)}`);
  return res.json.length;
}

function expectCreated(res, what) {
  assert.equal(res.status, 201, `${what}: expected status 201, got ${res.status}: ${show(res)}`);
  assert.equal(typeof res.json?.id, 'string', `${what}: expected the created payment with an "id", got: ${show(res)}`);
  return res.json;
}

function expectProblem(res, status, what) {
  assert.equal(res.status, status, `${what}: expected status ${status}, got ${res.status}: ${show(res)}`);
  assert.match(res.type, /^application\/problem\+json/, `${what}: expected Content-Type application/problem+json, got "${res.type}"`);
}

const EUR = { amount: 1999, currency: 'EUR', description: 'Annual plan' };

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('creates-payment: a POST with a new key creates one payment, and different keys create separate payments', async () => {
  await withApp(async (base) => {
    const a = expectCreated(await pay(base, EUR, newKey()), 'POST /payments with a new Idempotency-Key');
    assert.equal(a.amount, 1999, 'POST /payments: the created payment should echo the amount');
    const b = expectCreated(await pay(base, EUR, newKey()), 'POST /payments with a second, different key and the same body');
    assert.notEqual(a.id, b.id, 'Two different Idempotency-Keys must create two different payments, even with the same body');
    assert.equal(await paymentCount(base), 2, 'After two POSTs with different keys, GET /payments should list 2 payments');
  });
});

test('requires-key: a POST without a usable Idempotency-Key is rejected with 400 and charges nothing', async () => {
  await withApp(async (base) => {
    expectProblem(await pay(base, EUR), 400, 'POST /payments without an Idempotency-Key header');
    expectProblem(await pay(base, EUR, ''), 400, 'POST /payments with an empty Idempotency-Key');
    expectProblem(await pay(base, EUR, 'k'.repeat(256)), 400, 'POST /payments with a 256-character Idempotency-Key');
    assert.equal(await paymentCount(base), 0, 'Rejected requests must not create payments');
    expectCreated(await pay(base, EUR, 'k'.repeat(255)), 'POST /payments with a 255-character Idempotency-Key');
  });
});

test('replays: a retry with the same key and body returns the original response and charges once', async () => {
  await withApp(async (base) => {
    const key = newKey();
    const first = expectCreated(await pay(base, EUR, key), 'POST /payments (first attempt)');
    const retry = await pay(base, EUR, key);
    assert.equal(retry.status, 201, `POST /payments retried with the same key: expected the original status 201, got ${retry.status}`);
    assert.deepEqual(retry.json, first, 'POST /payments retried with the same key: expected exactly the original response body');
    const reordered = await pay(base, { description: 'Annual plan', currency: 'EUR', amount: 1999 }, key);
    assert.deepEqual(
      reordered.json,
      first,
      'POST /payments retried with the same key and the same fields in a different order: expected a replay (JSON key order does not change the request)',
    );
    assert.equal(await paymentCount(base), 1, 'Three requests with one key must create exactly 1 payment');
  });
});

test('replay-header: a replayed response carries Idempotent-Replayed: true and the original does not', async () => {
  await withApp(async (base) => {
    const key = newKey();
    const first = await pay(base, EUR, key);
    expectCreated(first, 'POST /payments (first attempt)');
    assert.notEqual(first.headers.get('idempotent-replayed'), 'true', 'The first response must not say Idempotent-Replayed: true');
    const retry = await pay(base, EUR, key);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true', `A replayed response must carry "Idempotent-Replayed: true", got ${retry.headers.get('idempotent-replayed')}`);
  });
});

test('rejects-different-body: reusing a key with a different body gets 422 and changes nothing', async () => {
  await withApp(async (base) => {
    const key = newKey();
    const first = expectCreated(await pay(base, EUR, key), 'POST /payments (first attempt)');
    expectProblem(await pay(base, { ...EUR, amount: 2999 }, key), 422, 'POST /payments reusing a key with a different amount');
    expectProblem(await pay(base, { amount: 1999, currency: 'EUR' }, key), 422, 'POST /payments reusing a key without the description');
    assert.equal(await paymentCount(base), 1, 'Reusing a key with a different body must not create a payment');
    const again = await pay(base, EUR, key);
    assert.deepEqual(again.json, first, 'After the 422s, the original body with the original key should still replay the first payment');
  });
});

test('concurrent-duplicates: while the first request is in flight, a duplicate gets 409 and the card is charged once', async () => {
  await withApp(async (base) => {
    const key = newKey();
    const results = await Promise.all([pay(base, EUR, key), pay(base, EUR, key), pay(base, EUR, key)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409], `Three simultaneous POSTs with one key: expected one 201 and two 409, got ${statuses.join(', ')}`);
    for (const res of results.filter((r) => r.status === 409)) expectProblem(res, 409, 'The concurrent duplicate');
    assert.equal(await paymentCount(base), 1, 'Three simultaneous POSTs with one key must create exactly 1 payment');
    const created = results.find((r) => r.status === 201).json;
    const later = await pay(base, EUR, key);
    assert.deepEqual(later.json, created, 'Once the first request finished, a retry should replay its response');
  });
});

test('failed-request-releases-key: a request rejected with 400 does not use up its key', async () => {
  await withApp(async (base) => {
    const key = newKey();
    const bad = await pay(base, { amount: -5, currency: 'euro' }, key);
    assert.equal(bad.status, 400, `POST /payments with an invalid body: expected status 400, got ${bad.status}`);
    const fixed = await pay(base, EUR, key);
    const first = expectCreated(fixed, 'POST /payments with a valid body, reusing the key of a request that failed validation');
    const retry = await pay(base, EUR, key);
    assert.equal(retry.headers.get('idempotent-replayed'), 'true', 'The successful request should now be stored: its retry must be a replay');
    assert.deepEqual(retry.json, first, 'The retry should replay the successful payment');
    assert.equal(await paymentCount(base), 1, 'Only the valid request should create a payment');
  });
});
