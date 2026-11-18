// Checks for "Build a notes module". Node built-ins only.
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

async function createNote(input) {
  const res = await request('POST', '/notes', input);
  assert.equal(res.status, 201, `POST /notes with a valid note: expected status 201, got ${res.status}`);
  assert.ok(
    res.json && typeof res.json === 'object' && !Array.isArray(res.json),
    `POST /notes: expected a JSON object in the response, got: ${res.text.slice(0, 200) || '(empty body)'}`,
  );
  return res.json;
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('create-note: POST /notes stores a note and answers 201 with it', async () => {
  const note = await createNote({ title: 'Buy milk', body: 'Two litres' });
  assert.ok(
    typeof note.id === 'string' && note.id.length > 0,
    `POST /notes: expected "id" to be a non-empty string, got ${JSON.stringify(note.id)}`,
  );
  assert.equal(note.title, 'Buy milk', 'POST /notes: the response must echo the title that was sent');
  assert.equal(note.body, 'Two litres', 'POST /notes: the response must echo the body that was sent');
  assert.ok(
    typeof note.createdAt === 'string' && !Number.isNaN(Date.parse(note.createdAt)),
    `POST /notes: expected "createdAt" to be an ISO 8601 string, got ${JSON.stringify(note.createdAt)}`,
  );

  const second = await createNote({ title: 'No body' });
  assert.equal(second.body, '', 'POST /notes without a body: expected "body" to be an empty string');
  assert.notEqual(second.id, note.id, 'Two notes received the same id');
});

test('list-notes: GET /notes returns every note in creation order', async () => {
  const first = await createNote({ title: 'List one' });
  const second = await createNote({ title: 'List two' });
  const res = await request('GET', '/notes');
  assert.equal(res.status, 200, `GET /notes: expected status 200, got ${res.status}`);
  assert.ok(Array.isArray(res.json), `GET /notes: expected a JSON array, got: ${res.text.slice(0, 200)}`);
  const ids = res.json.map((n) => n?.id);
  const a = ids.indexOf(first.id);
  const b = ids.indexOf(second.id);
  assert.ok(a !== -1 && b !== -1, 'GET /notes: a note that was just created is missing from the list');
  assert.ok(a < b, 'GET /notes: expected notes in the order they were created');
  assert.deepEqual(res.json[a], first, 'GET /notes: a listed note differs from what POST /notes returned');
});

test('get-note: GET /notes/:id returns the note', async () => {
  const note = await createNote({ title: 'Read me', body: 'Later' });
  const res = await request('GET', `/notes/${note.id}`);
  assert.equal(res.status, 200, `GET /notes/:id for an existing note: expected status 200, got ${res.status}`);
  assert.deepEqual(res.json, note, 'GET /notes/:id: the note differs from what POST /notes returned');
});

test('get-missing-404: GET /notes/:id answers 404 for an unknown id', async () => {
  await createNote({ title: 'Something else' });
  const res = await request('GET', '/notes/no-such-note');
  assert.equal(res.status, 404, `GET /notes/no-such-note: expected status 404, got ${res.status}`);
  assert.ok(
    res.json && typeof res.json === 'object',
    `GET /notes/no-such-note: expected a JSON error body, got: ${res.text.slice(0, 200) || '(empty body)'}`,
  );
});

test('delete-note: DELETE /notes/:id answers 204 and removes the note', async () => {
  const keep = await createNote({ title: 'Keep me' });
  const note = await createNote({ title: 'Delete me' });
  const res = await request('DELETE', `/notes/${note.id}`);
  assert.equal(res.status, 204, `DELETE /notes/:id for an existing note: expected status 204, got ${res.status}`);
  assert.equal(res.text, '', 'DELETE /notes/:id: a 204 response must have no body');

  const again = await request('GET', `/notes/${note.id}`);
  assert.equal(again.status, 404, `GET /notes/:id after deleting it: expected status 404, got ${again.status}`);
  const list = await request('GET', '/notes');
  const ids = Array.isArray(list.json) ? list.json.map((n) => n?.id) : [];
  assert.ok(!ids.includes(note.id), 'GET /notes still lists a note after it was deleted');
  assert.ok(ids.includes(keep.id), 'Deleting one note removed another note as well');
});

test('delete-missing-404: DELETE /notes/:id answers 404 for an unknown id', async () => {
  const res = await request('DELETE', '/notes/no-such-note');
  assert.equal(res.status, 404, `DELETE /notes/no-such-note: expected status 404, got ${res.status}`);

  const note = await createNote({ title: 'Delete me twice' });
  await request('DELETE', `/notes/${note.id}`);
  const second = await request('DELETE', `/notes/${note.id}`);
  assert.equal(second.status, 404, `Deleting the same note a second time: expected status 404, got ${second.status}`);
});
