// Checks for "Validate the notes API". Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

/** Filled in by the `before` hook. Tests read it through `request()`. */
const state = { compileOutput: null, bootError: null, app: null, base: null };

/** Imports a package from the submission's node_modules, so the check and the app share one copy. */
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

async function boot() {
  const entry = path.join(dir, 'dist', 'app.module.js');
  if (!existsSync(entry)) {
    throw new Error('dist/app.module.js was not produced. Keep src/app.module.ts and outDir "dist".');
  }
  await importFromSubmission('reflect-metadata');
  const { NestFactory } = await importFromSubmission('@nestjs/core');
  const { AppModule } = await import(pathToFileURL(entry).href);
  if (typeof AppModule !== 'function') {
    throw new Error('src/app.module.ts must export a class named AppModule.');
  }
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  state.app = app;
  await app.listen(0, '127.0.0.1');
  state.base = `http://127.0.0.1:${app.getHttpServer().address().port}`;
}

before(async () => {
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
});

async function request(method, url, body) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  const res = await fetch(state.base + url, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
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
  return { status: res.status, type: res.headers.get('content-type') ?? '', text, json };
}

const show = (res) => res.text.slice(0, 200) || '(empty body)';

async function noteCount() {
  const res = await request('GET', '/notes');
  assert.equal(res.status, 200, `GET /notes: expected status 200, got ${res.status}`);
  assert.ok(Array.isArray(res.json), `GET /notes: expected a JSON array, got: ${show(res)}`);
  return res.json.length;
}

/** Posts `input` and expects a 400 that stores nothing. Returns the response. */
async function expectRejected(input, what) {
  const before = await noteCount();
  const res = await request('POST', '/notes', input);
  assert.equal(res.status, 400, `POST /notes with ${what}: expected status 400, got ${res.status}`);
  const after = await noteCount();
  assert.equal(after, before, `POST /notes with ${what}: the request was rejected, but a note was stored anyway`);
  return res;
}

async function expectAccepted(input, what) {
  const res = await request('POST', '/notes', input);
  assert.equal(res.status, 201, `POST /notes with ${what}: expected status 201, got ${res.status}`);
  return res.json;
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('accepts-valid: valid notes are still created, including at the length limits', async () => {
  const note = await expectAccepted({ title: 'Buy milk', body: 'Two litres' }, 'a valid title and body');
  assert.equal(note?.title, 'Buy milk', 'POST /notes: the response must echo the title that was sent');
  assert.equal(note?.body, 'Two litres', 'POST /notes: the response must echo the body that was sent');
  const fetched = await request('GET', `/notes/${note.id}`);
  assert.equal(fetched.status, 200, `GET /notes/:id for the new note: expected status 200, got ${fetched.status}`);

  await expectAccepted({ title: 'Only a title' }, 'a title and no body');
  await expectAccepted({ title: 'x' }, 'a title of 1 character');
  await expectAccepted({ title: 'x'.repeat(100) }, 'a title of 100 characters');
  await expectAccepted({ title: 'Long body', body: 'y'.repeat(2000) }, 'a body of 2000 characters');
  await expectAccepted({ title: 'Empty body', body: '' }, 'an empty body');
});

test('rejects-missing-title: a note without a title is rejected with 400', async () => {
  await expectRejected({}, 'an empty object');
  await expectRejected({ body: 'No title here' }, 'a body and no title');
});

test('rejects-title-length: the title must have 1 to 100 characters', async () => {
  await expectRejected({ title: '' }, 'an empty title');
  await expectRejected({ title: 'x'.repeat(101) }, 'a title of 101 characters');
});

test('rejects-body-length: the body must have at most 2000 characters', async () => {
  await expectRejected({ title: 'Too long', body: 'y'.repeat(2001) }, 'a body of 2001 characters');
});

test('rejects-wrong-types: title and body must be strings', async () => {
  await expectRejected({ title: 42 }, 'a number as the title');
  await expectRejected({ title: null }, 'null as the title');
  await expectRejected({ title: ['a', 'b'] }, 'an array as the title');
  await expectRejected({ title: 'Fine', body: 42 }, 'a number as the body');
  await expectRejected({ title: 'Fine', body: { text: 'nested' } }, 'an object as the body');
});

test('rejects-unknown-fields: a field that is not title or body is rejected with 400', async () => {
  await expectRejected({ title: 'Fine', colour: 'red' }, 'an extra field "colour"');
  await expectRejected({ title: 'Fine', id: 'chosen-by-client' }, 'a client-chosen "id"');
  await expectRejected({ title: 'Fine', createdAt: '2000-01-01T00:00:00.000Z' }, 'a client-chosen "createdAt"');
});

test('error-names-field: the 400 response is JSON and names the field at fault', async () => {
  const cases = [
    [{ body: 'No title' }, 'a missing title', 'title'],
    [{ title: 'Fine', body: 'y'.repeat(2001) }, 'a body that is too long', 'body'],
    [{ title: 'Fine', colour: 'red' }, 'an extra field "colour"', 'colour'],
  ];
  for (const [input, what, field] of cases) {
    const res = await request('POST', '/notes', input);
    assert.equal(res.status, 400, `POST /notes with ${what}: expected status 400, got ${res.status}`);
    assert.ok(/json/i.test(res.type), `POST /notes with ${what}: expected a JSON content type, got "${res.type}"`);
    assert.ok(
      res.json && typeof res.json === 'object',
      `POST /notes with ${what}: expected a JSON object in the error body, got: ${show(res)}`,
    );
    assert.ok(
      res.text.includes(field),
      `POST /notes with ${what}: the error body should mention "${field}" so the client knows what to fix, got: ${show(res)}`,
    );
  }
});

test('other-routes-intact: reading and deleting notes still work', async () => {
  const note = await expectAccepted({ title: 'Still here' }, 'a valid title');
  const missing = await request('GET', '/notes/no-such-note');
  assert.equal(missing.status, 404, `GET /notes/no-such-note: expected status 404, got ${missing.status}`);
  const removed = await request('DELETE', `/notes/${note.id}`);
  assert.equal(removed.status, 204, `DELETE /notes/:id: expected status 204, got ${removed.status}`);
});
