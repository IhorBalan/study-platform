// Checks for "Guards and ownership in NestJS". Node built-ins only.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { compileOutput: null, bootError: null, app: null, base: null, tokens: {} };

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

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
  await importFromSubmission('reflect-metadata');
  const { NestFactory } = await importFromSubmission('@nestjs/core');
  const { AppModule } = await import(pathToFileURL(entry).href);
  if (typeof AppModule !== 'function') throw new Error('src/app.module.ts must export a class named AppModule.');
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

async function request(method, url, { body, token, headers = {} } = {}) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  const allHeaders = { ...headers };
  if (body !== undefined) allHeaders['content-type'] = 'application/json';
  if (token !== undefined) allHeaders.authorization = `Bearer ${token}`;
  const res = await fetch(state.base + url, {
    method,
    headers: allHeaders,
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
  return { status: res.status, text, json };
}

const show = (res) => res.text.slice(0, 200) || '(empty body)';

async function login(username) {
  state.tokens[username] ??= (async () => {
    const res = await request('POST', '/auth/login', { body: { username, password: `${username}-password` } });
    assert.equal(res.status, 200, `POST /auth/login as ${username}: expected 200, got ${res.status}: ${show(res)}`);
    assert.equal(typeof res.json?.accessToken, 'string', `POST /auth/login as ${username}: expected { accessToken }, got ${show(res)}`);
    return res.json.accessToken;
  })();
  return state.tokens[username];
}

async function createDoc(username, title) {
  const res = await request('POST', '/documents', { token: await login(username), body: { title, body: `${title} body` } });
  assert.equal(res.status, 201, `POST /documents as ${username}: expected 201, got ${res.status}: ${show(res)}`);
  assert.equal(typeof res.json?.id, 'string', `POST /documents as ${username}: expected the created document with an id, got ${show(res)}`);
  return res.json;
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('public-routes: health and login work without a token, and a wrong password gets 401', async () => {
  const health = await request('GET', '/health');
  assert.equal(health.status, 200, `GET /health without a token: expected 200, got ${health.status}`);
  await login('alice');
  const wrong = await request('POST', '/auth/login', { body: { username: 'alice', password: 'not-her-password' } });
  assert.equal(wrong.status, 401, `POST /auth/login with a wrong password: expected 401, got ${wrong.status}`);
  const unknown = await request('POST', '/auth/login', { body: { username: 'mallory', password: 'whatever' } });
  assert.equal(unknown.status, 401, `POST /auth/login for an unknown user: expected 401, got ${unknown.status}`);
});

test('requires-auth: every other route answers 401 without a valid bearer token', async () => {
  const alice = await login('alice');
  const [header, payload, signature] = alice.split('.');
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  const asCarol = Buffer.from(JSON.stringify({ ...claims, sub: 'u-carol' })).toString('base64url');
  const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const attempts = [
    ['no Authorization header', {}],
    ['a token that is not a token', { token: 'not-a-token' }],
    ['a token with its payload changed to another user', { token: `${header}.${asCarol}.${signature}` }],
    ['a token with alg "none" and no signature', { token: `${noneHeader}.${asCarol}.` }],
    ['a token with a damaged signature', { token: `${header}.${payload}.${signature.slice(0, -4)}AAAA` }],
    ['the token in a Basic header', { headers: { authorization: `Basic ${alice}` } }],
  ];
  for (const route of ['/me', '/documents', '/admin/users']) {
    for (const [what, options] of attempts) {
      const res = await request('GET', route, options);
      assert.equal(res.status, 401, `GET ${route} with ${what}: expected 401, got ${res.status}`);
    }
  }
  const post = await request('POST', '/documents', { body: { title: 'sneaky' } });
  assert.equal(post.status, 401, `POST /documents without a token: expected 401, got ${post.status}`);
});

test('current-user: GET /me returns the user from the token, and request headers cannot change who that is', async () => {
  for (const [username, role] of [['alice', 'member'], ['carol', 'admin']]) {
    const res = await request('GET', '/me', { token: await login(username) });
    assert.equal(res.status, 200, `GET /me as ${username}: expected 200, got ${res.status}: ${show(res)}`);
    assert.equal(res.json?.username, username, `GET /me as ${username}: expected username "${username}", got ${show(res)}`);
    assert.equal(res.json?.role, role, `GET /me as ${username}: expected role "${role}", got ${show(res)}`);
    assert.ok(!/hash|salt|password/i.test(res.text), `GET /me as ${username}: the response must not contain password material: ${show(res)}`);
  }
  const spoofed = await request('GET', '/me', {
    token: await login('alice'),
    headers: { 'x-user-id': 'u-carol', 'x-role': 'admin' },
  });
  assert.equal(spoofed.json?.username, 'alice', 'GET /me with X-User-Id and X-Role headers: identity must come from the token only');
});

test('role-guard: /admin/users is 403 for members, 200 for admins and 401 for anonymous callers', async () => {
  const member = await request('GET', '/admin/users', { token: await login('alice') });
  assert.equal(member.status, 403, `GET /admin/users as alice (member): expected 403, got ${member.status}`);
  const spoof = await request('GET', '/admin/users', { token: await login('bob'), headers: { 'x-role': 'admin' } });
  assert.equal(spoof.status, 403, `GET /admin/users as bob with an X-Role: admin header: expected 403, got ${spoof.status}`);
  const admin = await request('GET', '/admin/users', { token: await login('carol') });
  assert.equal(admin.status, 200, `GET /admin/users as carol (admin): expected 200, got ${admin.status}: ${show(admin)}`);
  assert.ok(Array.isArray(admin.json) && admin.json.length === 3, `GET /admin/users: expected an array of the 3 users, got ${show(admin)}`);
  assert.ok(!/hash|salt|password/i.test(admin.text), `GET /admin/users must not return password material: ${show(admin)}`);
  const anonymous = await request('GET', '/admin/users');
  assert.equal(anonymous.status, 401, `GET /admin/users without a token: expected 401 (not signed in), got ${anonymous.status}`);
});

test('owner-access: owners can create, list, read, update and delete their own documents', async () => {
  const alice = await login('alice');
  const doc = await createDoc('alice', 'Alice plan');
  const list = await request('GET', '/documents', { token: alice });
  assert.equal(list.status, 200, `GET /documents as alice: expected 200, got ${list.status}`);
  assert.ok(list.json?.some((d) => d.id === doc.id), 'GET /documents as alice: her new document is missing from the list');
  const read = await request('GET', `/documents/${doc.id}`, { token: alice });
  assert.equal(read.status, 200, `GET /documents/:id as the owner: expected 200, got ${read.status}`);
  const patched = await request('PATCH', `/documents/${doc.id}`, { token: alice, body: { title: 'Alice plan v2' } });
  assert.equal(patched.status, 200, `PATCH /documents/:id as the owner: expected 200, got ${patched.status}: ${show(patched)}`);
  assert.equal(patched.json?.title, 'Alice plan v2', 'PATCH /documents/:id as the owner: the title was not updated');
  const removed = await request('DELETE', `/documents/${doc.id}`, { token: alice });
  assert.equal(removed.status, 204, `DELETE /documents/:id as the owner: expected 204, got ${removed.status}`);
  const gone = await request('GET', `/documents/${doc.id}`, { token: alice });
  assert.equal(gone.status, 404, `GET /documents/:id after delete: expected 404, got ${gone.status}`);
});

test('bola-blocked: another member cannot see, list, change or delete a document, and gets 404', async () => {
  const bob = await login('bob');
  const doc = await createDoc('alice', 'Alice secret');
  const list = await request('GET', '/documents', { token: bob });
  assert.equal(list.status, 200, `GET /documents as bob: expected 200, got ${list.status}`);
  assert.ok(!list.json?.some((d) => d.ownerId !== 'u-bob'), "GET /documents as bob: the list contains documents bob does not own");
  const read = await request('GET', `/documents/${doc.id}`, { token: bob });
  assert.equal(read.status, 404, `GET /documents/:id of alice's document as bob: expected 404, got ${read.status}`);
  const patched = await request('PATCH', `/documents/${doc.id}`, { token: bob, body: { title: 'pwned' } });
  assert.equal(patched.status, 404, `PATCH /documents/:id of alice's document as bob: expected 404, got ${patched.status}`);
  const removed = await request('DELETE', `/documents/${doc.id}`, { token: bob });
  assert.equal(removed.status, 404, `DELETE /documents/:id of alice's document as bob: expected 404, got ${removed.status}`);
  const still = await request('GET', `/documents/${doc.id}`, { token: await login('alice') });
  assert.equal(still.status, 200, "alice's document must still exist after bob's attempts");
  assert.equal(still.json?.title, 'Alice secret', "alice's document was changed by bob");
});

test('admin-override: an admin can read and delete any document', async () => {
  const carol = await login('carol');
  const doc = await createDoc('bob', 'Bob notes');
  const read = await request('GET', `/documents/${doc.id}`, { token: carol });
  assert.equal(read.status, 200, `GET /documents/:id of bob's document as carol (admin): expected 200, got ${read.status}`);
  const removed = await request('DELETE', `/documents/${doc.id}`, { token: carol });
  assert.equal(removed.status, 204, `DELETE /documents/:id of bob's document as carol (admin): expected 204, got ${removed.status}`);
});
