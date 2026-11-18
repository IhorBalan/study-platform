// Checks for "Fix a vulnerable invoices API". Node built-ins only.
// Each attack must fail, and the normal requests next to it must keep working.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { compileOutput: null, bootError: null, app: null, base: null, users: {} };
const run = (process.env.CHECK_RUN_ID ?? String(Date.now())).replace(/[^a-z0-9]/gi, '').slice(-12).toLowerCase();

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
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.');
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

async function request(method, url, { body, token } = {}) {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(state.base + url, {
    method,
    headers,
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

const show = (res) => res.text.slice(0, 300) || '(empty body)';
const q = (params) => `?${new URLSearchParams(params)}`;
const email = (name) => `${name}.${run}@example.test`;
const SECRET_PATTERN = /password_hash|passwordHash|\$scrypt\$|"salt"/;

/** Signs up (once per name) and logs in. Returns { token, user }. */
async function account(name) {
  state.users[name] ??= (async () => {
    const credentials = { email: email(name), password: `${name}-long-password` };
    const signup = await request('POST', '/auth/signup', { body: { ...credentials, name } });
    assert.equal(signup.status, 201, `POST /auth/signup for ${name}: expected 201, got ${signup.status}: ${show(signup)}`);
    const login = await request('POST', '/auth/login', { body: credentials });
    assert.equal(login.status, 200, `POST /auth/login for ${name}: expected 200, got ${login.status}: ${show(login)}`);
    assert.equal(typeof login.json?.token, 'string', `POST /auth/login: expected { token }, got ${show(login)}`);
    return { token: login.json.token, user: signup.json };
  })();
  return state.users[name];
}

async function invoice(name, customer, amountCents) {
  const { token } = await account(name);
  const res = await request('POST', '/invoices', { token, body: { customer, amountCents } });
  assert.equal(res.status, 201, `POST /invoices as ${name}: expected 201, got ${res.status}: ${show(res)}`);
  return res.json;
}

/** Alice and Bob each have a few invoices. Created once, shared by the tests. */
let seeded;
function seed() {
  seeded ??= (async () => {
    const alice = [
      await invoice('alice', 'Acme Corp', 12_000),
      await invoice('alice', "O'Brien Ltd", 5_000),
      await invoice('alice', 'Globex', 30_000),
    ];
    const bob = [await invoice('bob', 'Initech', 99_999), await invoice('bob', 'Acme Corp', 1)];
    return { alice, bob };
  })();
  return seeded;
}

const customers = (res) => (Array.isArray(res.json) ? res.json.map((i) => i.customer) : res.json);

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('normal-flows: sign-up, login, profile, invoices, search and sort still work', async () => {
  const { token, user } = await account('alice');
  assert.equal(user?.email, email('alice'), `POST /auth/signup: expected the new user in the response, got ${JSON.stringify(user)}`);
  assert.equal(user?.role, 'member', `POST /auth/signup: a new user must have role "member", got ${JSON.stringify(user?.role)}`);
  const me = await request('GET', '/me', { token });
  assert.equal(me.status, 200, `GET /me: expected 200, got ${me.status}`);
  assert.equal(me.json?.email, email('alice'), `GET /me: expected alice, got ${show(me)}`);
  const renamed = await request('PATCH', '/me', { token, body: { name: 'Alice A.' } });
  assert.equal(renamed.status, 200, `PATCH /me with { name }: expected 200, got ${renamed.status}: ${show(renamed)}`);
  assert.equal(renamed.json?.name, 'Alice A.', `PATCH /me with { name }: expected the new name, got ${show(renamed)}`);

  const { alice } = await seed();
  const all = await request('GET', '/invoices', { token });
  assert.equal(all.status, 200, `GET /invoices: expected 200, got ${all.status}: ${show(all)}`);
  assert.equal(all.json?.length, 3, `GET /invoices as alice: expected her 3 invoices, got ${JSON.stringify(customers(all))}`);

  const acme = await request('GET', `/invoices${q({ search: 'acme' })}`, { token });
  assert.deepEqual(customers(acme), ['Acme Corp'], `GET /invoices?search=acme as alice: expected ["Acme Corp"], got ${show(acme)}`);
  const quote = await request('GET', `/invoices${q({ search: "O'Brien" })}`, { token });
  assert.equal(quote.status, 200, `GET /invoices?search=O'Brien: expected 200, got ${quote.status}: ${show(quote)}`);
  assert.deepEqual(customers(quote), ["O'Brien Ltd"], `GET /invoices?search=O'Brien: expected ["O'Brien Ltd"], got ${show(quote)}`);

  const byAmount = await request('GET', `/invoices${q({ sort: 'amount_cents' })}`, { token });
  assert.deepEqual(customers(byAmount), ["O'Brien Ltd", 'Acme Corp', 'Globex'], `GET /invoices?sort=amount_cents: wrong order, got ${show(byAmount)}`);
  const byAmountDesc = await request('GET', `/invoices${q({ sort: '-amount_cents' })}`, { token });
  assert.deepEqual(customers(byAmountDesc), ['Globex', 'Acme Corp', "O'Brien Ltd"], `GET /invoices?sort=-amount_cents: wrong order, got ${show(byAmountDesc)}`);
  const byCustomer = await request('GET', `/invoices${q({ sort: 'customer' })}`, { token });
  assert.deepEqual(customers(byCustomer), ['Acme Corp', 'Globex', "O'Brien Ltd"], `GET /invoices?sort=customer: wrong order, got ${show(byCustomer)}`);

  const one = await request('GET', `/invoices/${alice[0].id}`, { token });
  assert.equal(one.status, 200, `GET /invoices/:id for alice's own invoice: expected 200, got ${one.status}`);
  assert.equal(one.json?.customer, 'Acme Corp', `GET /invoices/:id: expected her invoice, got ${show(one)}`);
  const temp = await invoice('alice', 'Temporary', 10);
  const removed = await request('DELETE', `/invoices/${temp.id}`, { token });
  assert.equal(removed.status, 204, `DELETE /invoices/:id for alice's own invoice: expected 204, got ${removed.status}`);
});

test('sqli-search: the search parameter cannot change the query', async () => {
  const { token } = await account('alice');
  await seed();
  const payloads = [
    "' OR '1'='1",
    "' OR 1=1 --",
    "%' OR owner_id <> 0 --",
    "x' UNION SELECT id, email, password_hash, 0, now() FROM users --",
    "x' UNION SELECT id, id, email, id, password_hash, now() FROM users --",
    "'; DELETE FROM invoices; --",
  ];
  for (const search of payloads) {
    const res = await request('GET', `/invoices${q({ search })}`, { token });
    assert.ok(res.status === 200 || res.status === 400, `GET /invoices?search=${search}: expected 200 or 400, got ${res.status}`);
    const found = Array.isArray(res.json) ? res.json : [];
    assert.ok(
      !found.some((i) => ['Initech'].includes(i.customer) || i.amountCents === 99_999 || i.amountCents === 1),
      `GET /invoices?search=${search} returned bob's invoices to alice: ${show(res)}`,
    );
    assert.ok(found.length === 0, `GET /invoices?search=${search}: no invoice has that text in its customer name, but ${found.length} came back: ${show(res)}`);
    assert.ok(!SECRET_PATTERN.test(res.text) && !res.text.includes('@example.test'), `GET /invoices?search=${search} leaked user data: ${show(res)}`);
  }
  const bob = await account('bob');
  const bobs = await request('GET', '/invoices', { token: bob.token });
  assert.equal(bobs.json?.length, 2, `After the attacks bob must still have his 2 invoices, found ${show(bobs)}`);
});

test('sqli-sort: sort accepts only the listed columns and anything else gets 400', async () => {
  const { token } = await account('alice');
  await seed();
  const attacks = [
    'amount_cents; DELETE FROM invoices',
    '(SELECT 1)',
    "(CASE WHEN (SELECT substr(password_hash,1,1) FROM users LIMIT 1)='$' THEN amount_cents ELSE customer END)",
    'owner_id',
    'password_hash',
    'amount_cents DESC',
    '1',
  ];
  for (const sort of attacks) {
    const res = await request('GET', `/invoices${q({ sort })}`, { token });
    assert.equal(res.status, 400, `GET /invoices?sort=${sort}: expected 400, got ${res.status}: ${show(res)}`);
  }
  const all = await request('GET', '/invoices', { token });
  assert.equal(all.json?.length, 3, `After the sort attacks alice must still have her 3 invoices, found ${show(all)}`);
});

test('mass-assignment: clients cannot set role or other server-owned fields', async () => {
  const sneaky = { email: email('mallory'), password: 'mallory-long-password', name: 'Mallory' };
  const signup = await request('POST', '/auth/signup', { body: { ...sneaky, role: 'admin' } });
  assert.equal(signup.status, 400, `POST /auth/signup with "role": "admin": expected 400, got ${signup.status}: ${show(signup)}`);
  const withId = await request('POST', '/auth/signup', { body: { ...sneaky, id: 1 } });
  assert.equal(withId.status, 400, `POST /auth/signup with "id": expected 400, got ${withId.status}: ${show(withId)}`);
  const login = await request('POST', '/auth/login', { body: { email: sneaky.email, password: sneaky.password } });
  assert.equal(login.status, 401, `The rejected sign-ups must not have created an account, but login answered ${login.status}`);

  const { token } = await account('carl');
  for (const body of [{ role: 'admin' }, { name: 'Carl', role: 'admin' }, { password_hash: 'x' }, { 'role = \'admin\', name': 'x' }]) {
    const res = await request('PATCH', '/me', { token, body });
    assert.equal(res.status, 400, `PATCH /me with ${JSON.stringify(body)}: expected 400, got ${res.status}: ${show(res)}`);
  }
  const me = await request('GET', '/me', { token });
  assert.equal(me.json?.role, 'member', `After the PATCH attempts carl must still be a member, got ${show(me)}`);
  const admin = await request('GET', '/admin/invoices', { token });
  assert.equal(admin.status, 403, `GET /admin/invoices as carl: expected 403, got ${admin.status}`);
  const invoiceOwner = await request('POST', '/invoices', { token, body: { customer: 'Hooli', amountCents: 5, ownerId: 1 } });
  assert.equal(invoiceOwner.status, 400, `POST /invoices with "ownerId": expected 400, got ${invoiceOwner.status}: ${show(invoiceOwner)}`);
});

test('bola: a user cannot read or delete another user\'s invoice by id', async () => {
  // Fresh invoices, so an earlier test that damaged the table cannot blur this result.
  const bob = [await invoice('bob', 'Umbrella', 4_200), await invoice('bob', 'Stark', 7_700)];
  const alice = await account('alice');
  for (const target of bob) {
    const read = await request('GET', `/invoices/${target.id}`, { token: alice.token });
    assert.equal(read.status, 404, `GET /invoices/${target.id} (bob's) as alice: expected 404, got ${read.status}: ${show(read)}`);
    const removed = await request('DELETE', `/invoices/${target.id}`, { token: alice.token });
    assert.equal(removed.status, 404, `DELETE /invoices/${target.id} (bob's) as alice: expected 404, got ${removed.status}`);
  }
  const bobAccount = await account('bob');
  const still = await request('GET', `/invoices/${bob[0].id}`, { token: bobAccount.token });
  assert.equal(still.status, 200, `bob's invoice must survive alice's DELETE, but GET as bob answered ${still.status}`);
  const missing = await request('GET', '/invoices/999999', { token: alice.token });
  assert.equal(missing.status, 404, `GET /invoices/999999: expected 404, got ${missing.status}`);
});

test('no-secrets: responses never contain password hashes', async () => {
  const fresh = { email: email('dana'), password: 'dana-long-password', name: 'Dana' };
  const signup = await request('POST', '/auth/signup', { body: fresh });
  assert.equal(signup.status, 201, `POST /auth/signup: expected 201, got ${signup.status}: ${show(signup)}`);
  assert.ok(!SECRET_PATTERN.test(signup.text), `POST /auth/signup returned password material: ${show(signup)}`);
  const login = await request('POST', '/auth/login', { body: { email: fresh.email, password: fresh.password } });
  assert.ok(!SECRET_PATTERN.test(login.text), `POST /auth/login returned password material: ${show(login)}`);
  const me = await request('GET', '/me', { token: login.json?.token });
  assert.equal(me.status, 200, `GET /me: expected 200, got ${me.status}`);
  assert.ok(!SECRET_PATTERN.test(me.text), `GET /me returned password material: ${show(me)}`);
  const renamed = await request('PATCH', '/me', { token: login.json?.token, body: { name: 'Dana B.' } });
  assert.ok(!SECRET_PATTERN.test(renamed.text), `PATCH /me returned password material: ${show(renamed)}`);
});
