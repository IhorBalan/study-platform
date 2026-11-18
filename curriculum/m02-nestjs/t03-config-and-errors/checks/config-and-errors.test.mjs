// Checks for "Typed configuration and problem details". Node built-ins only.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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

const CONFIG_KEYS = ['NODE_ENV', 'PORT', 'MAX_NOTES', 'ADMIN_TOKEN'];
/** A valid token. Its value must never show up in any output. */
const GOOD_TOKEN = 'tok_3f9a71c05be84d2296aa';
const MAX_NOTES = 3;

async function boot() {
  // The app under test runs with this environment. PORT is left unset on purpose.
  for (const key of CONFIG_KEYS) delete process.env[key];
  Object.assign(process.env, { NODE_ENV: 'test', MAX_NOTES: String(MAX_NOTES), ADMIN_TOKEN: GOOD_TOKEN });
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

const show = (res) => res.text.slice(0, 300) || '(empty body)';

/**
 * Creates the app in a child process with exactly the given configuration
 * variables, so each case starts from a clean module cache.
 */
const BOOT_SCRIPT = `
const [coreUrl, metadataUrl, entryUrl] = process.argv.slice(1);
try {
  await import(metadataUrl);
  const { NestFactory } = await import(coreUrl);
  const { AppModule } = await import(entryUrl);
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await app.init();
  await app.close();
  console.log('BOOT_OK');
  process.exit(0);
} catch (error) {
  console.error('BOOT_FAILED');
  console.error(error);
  process.exit(1);
}
`;

function bootWith(vars) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  const require = createRequire(path.join(dir, 'package.json'));
  const urls = [
    pathToFileURL(require.resolve('@nestjs/core')).href,
    pathToFileURL(require.resolve('reflect-metadata')).href,
    pathToFileURL(path.join(dir, 'dist', 'app.module.js')).href,
  ];
  const env = { ...process.env };
  for (const key of CONFIG_KEYS) delete env[key];
  Object.assign(env, vars);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', BOOT_SCRIPT, ...urls], {
      cwd: dir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && output.includes('BOOT_OK'), output });
    });
  });
}

const describeVars = (vars) =>
  Object.entries(vars)
    .map(([key, value]) => (key === 'ADMIN_TOKEN' ? `${key}=(${value.length} characters)` : `${key}=${value}`))
    .join(' ') || '(no variables set)';

function assertProblem(res, status, what) {
  assert.equal(res.status, status, `${what}: expected status ${status}, got ${res.status}`);
  assert.ok(
    res.type.toLowerCase().startsWith('application/problem+json'),
    `${what}: expected content type application/problem+json, got "${res.type}"`,
  );
  assert.ok(
    res.json && typeof res.json === 'object' && !Array.isArray(res.json),
    `${what}: expected a JSON object in the body, got: ${show(res)}`,
  );
  assert.equal(
    res.json.status,
    status,
    `${what}: the "status" member must equal the HTTP status ${status}, got ${JSON.stringify(res.json.status)}`,
  );
  assert.ok(
    typeof res.json.title === 'string' && res.json.title.length > 0,
    `${what}: expected "title" to be a non-empty string, got ${JSON.stringify(res.json.title)}`,
  );
  assert.ok(
    typeof res.json.type === 'string' && res.json.type.length > 0,
    `${what}: expected "type" to be a URI string such as "about:blank", got ${JSON.stringify(res.json.type)}`,
  );
  if ('detail' in res.json) {
    assert.equal(typeof res.json.detail, 'string', `${what}: when "detail" is present it must be a string`);
  }
}

async function deleteAllNotes() {
  const list = await request('GET', '/notes');
  assert.ok(Array.isArray(list.json), `GET /notes: expected a JSON array, got: ${show(list)}`);
  for (const note of list.json) await request('DELETE', `/notes/${note.id}`);
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('env-defaults: the app starts when only ADMIN_TOKEN is set', async () => {
  const vars = { ADMIN_TOKEN: GOOD_TOKEN };
  const result = await bootWith(vars);
  assert.ok(
    result.ok,
    `Creating the app with ${describeVars(vars)} should succeed, because every other variable has a default. Output:\n${result.output.slice(0, 600)}`,
  );
  const full = { NODE_ENV: 'production', PORT: '8080', MAX_NOTES: '5', ADMIN_TOKEN: GOOD_TOKEN };
  const second = await bootWith(full);
  assert.ok(second.ok, `Creating the app with ${describeVars(full)} should succeed. Output:\n${second.output.slice(0, 600)}`);
});

test('env-fails-fast: invalid configuration stops the app from being created and names the variable', async () => {
  const cases = [
    [{}, 'ADMIN_TOKEN'],
    [{ ADMIN_TOKEN: 'too-short' }, 'ADMIN_TOKEN'],
    [{ ADMIN_TOKEN: GOOD_TOKEN, PORT: 'abc' }, 'PORT'],
    [{ ADMIN_TOKEN: GOOD_TOKEN, PORT: '70000' }, 'PORT'],
    [{ ADMIN_TOKEN: GOOD_TOKEN, MAX_NOTES: '0' }, 'MAX_NOTES'],
    [{ ADMIN_TOKEN: GOOD_TOKEN, MAX_NOTES: '2.5' }, 'MAX_NOTES'],
    [{ ADMIN_TOKEN: GOOD_TOKEN, NODE_ENV: 'staging' }, 'NODE_ENV'],
  ];
  const results = await Promise.all(cases.map(([vars]) => bootWith(vars)));
  cases.forEach(([vars, name], index) => {
    const result = results[index];
    assert.ok(!result.ok, `Creating the app with ${describeVars(vars)} should fail, but it started`);
    assert.ok(
      result.output.includes(name),
      `Creating the app with ${describeVars(vars)} failed, but the error does not mention ${name}. Output:\n${result.output.slice(0, 600)}`,
    );
  });
});

test('env-reports-all: one start-up error names every invalid variable', async () => {
  const vars = { PORT: 'abc', MAX_NOTES: '-1', NODE_ENV: 'staging' };
  const result = await bootWith(vars);
  assert.ok(!result.ok, `Creating the app with ${describeVars(vars)} should fail, but it started`);
  for (const name of ['ADMIN_TOKEN', 'PORT', 'MAX_NOTES', 'NODE_ENV']) {
    assert.ok(
      result.output.includes(name),
      `With ${describeVars(vars)} the start-up error should name all four variables, but ${name} is missing. Output:\n${result.output.slice(0, 600)}`,
    );
  }
});

test('env-secret-hidden: start-up errors never print the value of ADMIN_TOKEN', async () => {
  const shortToken = 'sk-9Qx7vT2m';
  const cases = [{ ADMIN_TOKEN: shortToken }, { ADMIN_TOKEN: GOOD_TOKEN, PORT: 'abc' }];
  for (const vars of cases) {
    const result = await bootWith(vars);
    assert.ok(!result.ok, `Creating the app with ${describeVars(vars)} should fail, but it started`);
    const named = Object.keys(vars).length === 1 ? 'ADMIN_TOKEN' : 'PORT';
    assert.ok(
      result.output.includes(named),
      `Creating the app with ${describeVars(vars)} failed, but the error does not mention ${named}. Output:\n${result.output.slice(0, 600)}`,
    );
    assert.ok(
      !result.output.includes(vars.ADMIN_TOKEN),
      `Creating the app with ${describeVars(vars)} printed the value of ADMIN_TOKEN. Report the variable name, never its value.`,
    );
  }
});

test('health-environment: GET /health reports the configured environment', async () => {
  const res = await request('GET', '/health');
  assert.equal(res.status, 200, `GET /health: expected status 200, got ${res.status}`);
  assert.deepEqual(
    res.json,
    { status: 'ok', environment: 'test' },
    `GET /health with NODE_ENV=test: expected {"status":"ok","environment":"test"}, got: ${show(res)}`,
  );
});

test('problem-not-found: 404 responses are problem documents', async () => {
  assertProblem(await request('GET', '/notes/no-such-note'), 404, 'GET /notes/no-such-note');
  assertProblem(await request('DELETE', '/notes/no-such-note'), 404, 'DELETE /notes/no-such-note');
  assertProblem(await request('GET', '/no-such-route'), 404, 'GET /no-such-route (no handler matches)');
});

test('problem-validation: 400 responses are problem documents that name the field', async () => {
  const res = await request('POST', '/notes', { body: 'No title' });
  assertProblem(res, 400, 'POST /notes without a title');
  assert.ok(
    res.text.includes('title'),
    `POST /notes without a title: the problem document should mention "title", got: ${show(res)}`,
  );
  const extra = await request('POST', '/notes', { title: 'Fine', colour: 'red' });
  assertProblem(extra, 400, 'POST /notes with an extra field "colour"');
  assert.ok(
    extra.text.includes('colour'),
    `POST /notes with an extra field "colour": the problem document should mention "colour", got: ${show(extra)}`,
  );
});

test('problem-unexpected: an unexpected error becomes a 500 problem that leaks nothing', async () => {
  const source = path.join(dir, 'src', 'debug', 'debug.controller.ts');
  assert.ok(
    existsSync(source) && readFileSync(source, 'utf8').includes('hunter2-do-not-leak'),
    'src/debug/debug.controller.ts must stay exactly as the starter shipped it',
  );
  const res = await request('GET', '/debug/boom');
  assertProblem(res, 500, 'GET /debug/boom');
  const leaks = [
    ['hunter2', 'part of the error message'],
    ['ECONNREFUSED', 'part of the error message'],
    ['db.internal', 'an internal host name'],
    ['debug.controller', 'a file name from the stack trace'],
    ['    at ', 'a stack trace'],
  ];
  for (const [needle, what] of leaks) {
    assert.ok(!res.text.includes(needle), `GET /debug/boom: the response body contains ${what}. A 500 must not describe what went wrong inside.`);
  }
});

test('notes-limit: a full store answers 409 with a problem document', async () => {
  await deleteAllNotes();
  const created = [];
  for (let i = 1; i <= MAX_NOTES; i += 1) {
    const res = await request('POST', '/notes', { title: `Note ${i}` });
    assert.equal(res.status, 201, `POST /notes for note ${i} of ${MAX_NOTES} with MAX_NOTES=${MAX_NOTES}: expected status 201, got ${res.status}`);
    created.push(res.json);
  }
  const full = await request('POST', '/notes', { title: 'One too many' });
  assertProblem(full, 409, `POST /notes when ${MAX_NOTES} notes exist and MAX_NOTES=${MAX_NOTES}`);
  const list = await request('GET', '/notes');
  assert.equal(list.json?.length, MAX_NOTES, `After the rejected request the store should still hold ${MAX_NOTES} notes, got ${list.json?.length}`);

  const invalid = await request('POST', '/notes', { title: '' });
  assert.equal(invalid.status, 400, `An invalid note sent to a full store: expected status 400 (validation runs first), got ${invalid.status}`);

  await request('DELETE', `/notes/${created[0].id}`);
  const again = await request('POST', '/notes', { title: 'Room again' });
  assert.equal(again.status, 201, `POST /notes after deleting one note from a full store: expected status 201, got ${again.status}`);
});

test('success-unchanged: successful responses keep their shape and content type', async () => {
  await deleteAllNotes();
  const res = await request('POST', '/notes', { title: 'Plain JSON', body: 'As before' });
  assert.equal(res.status, 201, `POST /notes with a valid note: expected status 201, got ${res.status}`);
  assert.ok(
    res.type.toLowerCase().startsWith('application/json'),
    `POST /notes with a valid note: expected content type application/json, got "${res.type}"`,
  );
  assert.equal(res.json?.title, 'Plain JSON', 'POST /notes: the response must echo the title that was sent');
  const removed = await request('DELETE', `/notes/${res.json.id}`);
  assert.equal(removed.status, 204, `DELETE /notes/:id: expected status 204, got ${removed.status}`);
});
