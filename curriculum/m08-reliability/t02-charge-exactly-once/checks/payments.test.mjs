// Checks for "Charge exactly once". Node built-ins only; `pg` comes from the submission.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SCHEMA = 'm08_pay_chk';
const LEASE_MS = 300;
const state = { compileOutput: null, setupError: null, pg: null, admin: null, mod: null, pools: [], clients: [] };

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 4000) || `tsc exited with status ${result.status}`;
}

before(async () => {
  state.compileOutput = compile();
  if (!process.env.DATABASE_URL) {
    state.setupError = 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.';
    return;
  }
  try {
    const require = createRequire(path.join(dir, 'package.json'));
    const pgModule = await import(pathToFileURL(require.resolve('pg')).href);
    state.pg = pgModule.default ?? pgModule;
    state.admin = new state.pg.Client({ connectionString: process.env.DATABASE_URL });
    await state.admin.connect();
    await state.admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}; set search_path to ${SCHEMA}`);
  } catch (error) {
    state.setupError = `Could not connect to the database: ${error.message}`;
    return;
  }
  try {
    const schemaFile = path.join(dir, 'db', 'schema.sql');
    if (!existsSync(schemaFile)) throw new Error('db/schema.sql was not found.');
    await state.admin.query(readFileSync(schemaFile, 'utf8'));
    const cols = await state.admin.query(
      `select column_name from information_schema.columns where table_schema = $1 and table_name = 'payments'`,
      [SCHEMA],
    );
    const names = cols.rows.map((r) => r.column_name);
    for (const c of ['id', 'customer_id', 'amount_cents', 'charge_id']) {
      if (!names.includes(c)) throw new Error(`the payments table needs its ${c} column.`);
    }
  } catch (error) {
    state.setupError = `db/schema.sql could not be applied in an empty schema: ${error.message}`;
    return;
  }
  if (state.compileOutput) return;
  const entry = path.join(dir, 'dist', 'payments.js');
  try {
    if (!existsSync(entry)) throw new Error('dist/payments.js was not produced. Keep src/payments.ts and outDir "dist".');
    state.mod = await import(pathToFileURL(entry).href);
    for (const name of ['createPayments', 'IdempotencyConflictError', 'RequestInProgressError']) {
      if (typeof state.mod[name] !== 'function') throw new Error(`src/payments.ts must export ${name}.`);
    }
  } catch (error) {
    state.setupError = String(error?.message ?? error);
  }
});

after(async () => {
  // Close every connection directly: pool.end() would wait for a client stuck behind a gateway call that never returns.
  await Promise.all(state.clients.map((c) => withTimeout(c.end(), 2000, 'Closing a client').catch(() => {})));
  await Promise.all(state.pools.map((p) => withTimeout(p.end(), 2000, 'Closing a pool').catch(() => {})));
  await state.admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
  await state.admin?.end();
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
}

function makePool(max = 5) {
  const pool = new state.pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    options: `-c search_path=${SCHEMA} -c statement_timeout=5000 -c lock_timeout=5000`,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => state.clients.push(client));
  state.pools.push(pool);
  return pool;
}

/** A gateway that deduplicates by idempotencyKey, like a real one, and counts real charges per customer. */
function makeGateway({ delayMs = 0 } = {}) {
  const charges = new Map();
  const gw = {
    calls: [],
    hooks: [], // per-call overrides: (request, index) => 'hang' | 'lose-response' | undefined
    charges,
    realChargesFor: (customerId) => [...charges.values()].filter((c) => c.customerId === customerId).length,
    async charge(request) {
      const index = gw.calls.length;
      gw.calls.push({ ...request });
      const mode = gw.hooks.map((h) => h(request, index)).find(Boolean);
      if (mode === 'hang') return new Promise(() => {});
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      if (typeof request?.idempotencyKey !== 'string' || request.idempotencyKey.length === 0) {
        throw new Error('The gateway needs a non-empty idempotencyKey string.');
      }
      let charge = charges.get(request.idempotencyKey);
      if (!charge) {
        charge = { chargeId: `ch_${charges.size + 1}_${Math.random().toString(36).slice(2, 8)}`, customerId: request.customerId };
        charges.set(request.idempotencyKey, charge);
      }
      if (mode === 'lose-response') throw new Error('socket hang up (the charge went through, the response was lost)');
      return { chargeId: charge.chargeId };
    },
  };
  return gw;
}

let seq = 0;
const customer = (label) => `cus_${label}_${process.pid}_${++seq}`;
const paymentsFor = async (customerId) =>
  (await state.admin.query('select id, amount_cents, charge_id from payments where customer_id = $1 order by id', [customerId])).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Calls pay until it succeeds, waiting while it answers RequestInProgressError. */
async function payUntilDone(pay, input, ms = 4000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      return await withTimeout(pay(input), 3000, 'pay()');
    } catch (error) {
      last = error;
      if (!(error instanceof state.mod.RequestInProgressError)) throw error;
      await sleep(50);
    }
  }
  throw new Error(`pay() still answered RequestInProgressError after ${ms} ms with leaseMs ${LEASE_MS}: ${last?.message}`);
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('charges: a new key charges once and returns the stored payment', async () => {
  ready();
  const gw = makeGateway();
  const { pay } = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  const cus = customer('charges');
  const r = await withTimeout(pay({ customerId: cus, key: 'k-1', amountCents: 1250 }), 5000, 'pay()');
  const rows = await paymentsFor(cus);
  assert.equal(rows.length, 1, `Expected one payments row, found ${rows.length}.`);
  assert.equal(gw.realChargesFor(cus), 1, 'Expected exactly one charge at the gateway.');
  assert.equal(Number(r?.paymentId), rows[0].id, 'paymentId should be the id of the new payments row.');
  assert.equal(r.chargeId, rows[0].charge_id, "chargeId should be the gateway's charge id, as stored in payments.");
  assert.equal(r.amountCents, 1250, 'amountCents should be returned.');
  assert.equal(r.replayed, false, 'A first request is not a replay; replayed should be false.');
  assert.equal(gw.calls[0].customerId, cus, 'The gateway should be called with the customerId.');
  assert.equal(gw.calls[0].amountCents, 1250, 'The gateway should be called with the amount.');

  await pay({ customerId: cus, key: 'k-2', amountCents: 300 });
  assert.equal((await paymentsFor(cus)).length, 2, 'A different key is a different payment.');
  assert.equal(gw.realChargesFor(cus), 2, 'A different key must reach the gateway with a different idempotencyKey.');
});

test('replays: a retry with the same key and amount returns the stored result without calling the gateway', async () => {
  ready();
  const gw = makeGateway();
  const pool = makePool();
  const cus = customer('replay');
  const first = await state.mod.createPayments(pool, gw, { leaseMs: LEASE_MS }).pay({ customerId: cus, key: 'k', amountCents: 800 });
  // A second instance of the service: nothing may be remembered in memory.
  const second = await state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS }).pay({ customerId: cus, key: 'k', amountCents: 800 });
  assert.equal(gw.calls.length, 1, `A replay must not call the gateway at all; it was called ${gw.calls.length} times.`);
  assert.equal(second.replayed, true, 'The retry should come back with replayed: true.');
  assert.equal(Number(second.paymentId), Number(first.paymentId), 'The replay should return the original paymentId.');
  assert.equal(second.chargeId, first.chargeId, 'The replay should return the original chargeId.');
  assert.equal(second.amountCents, 800, 'The replay should return the original amount.');
  assert.equal((await paymentsFor(cus)).length, 1, 'A replay must not add a payments row.');
});

test('conflict: the same key with a different amount is rejected with IdempotencyConflictError', async () => {
  ready();
  const gw = makeGateway();
  const { pay } = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  const cus = customer('conflict');
  await pay({ customerId: cus, key: 'k', amountCents: 500 });
  await assert.rejects(
    pay({ customerId: cus, key: 'k', amountCents: 50_000 }),
    (e) => e instanceof state.mod.IdempotencyConflictError,
    'Reusing a key for another amount should reject with IdempotencyConflictError.',
  );
  assert.equal(gw.calls.length, 1, 'A conflicting request must not reach the gateway.');
  assert.equal((await paymentsFor(cus)).length, 1, 'A conflicting request must not add a payment.');
});

test('scoped-keys: two customers may use the same key', async () => {
  ready();
  const gw = makeGateway();
  const { pay } = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  const a = customer('scope-a');
  const b = customer('scope-b');
  const ra = await pay({ customerId: a, key: 'order-1', amountCents: 100 });
  const rb = await pay({ customerId: b, key: 'order-1', amountCents: 100 });
  assert.equal(rb.replayed, false, "Customer B's request was answered with customer A's stored result.");
  assert.notEqual(Number(ra.paymentId), Number(rb.paymentId), 'Each customer should get their own payment.');
  assert.equal(gw.realChargesFor(b), 1, 'Customer B must be charged: keys are scoped per customer, also at the gateway.');
});

test('concurrent-duplicates: simultaneous requests with one key on two instances charge once', async () => {
  ready();
  const gw = makeGateway({ delayMs: 150 });
  const one = state.mod.createPayments(makePool(5), gw, { leaseMs: 5000 });
  const two = state.mod.createPayments(makePool(5), gw, { leaseMs: 5000 });
  const cus = customer('race');
  const input = { customerId: cus, key: 'double-click', amountCents: 4200 };
  const results = await withTimeout(
    Promise.allSettled(Array.from({ length: 10 }, (_, i) => (i % 2 ? one : two).pay({ ...input }))),
    10_000,
    '10 concurrent pay() calls',
  );
  const ok = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  const other = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof state.mod.RequestInProgressError));
  assert.equal(other.length, 0, `Concurrent duplicates may only fail with RequestInProgressError, got: ${other[0]?.reason?.message}`);
  assert.equal(gw.realChargesFor(cus), 1, `The customer was charged ${gw.realChargesFor(cus)} times for one key.`);
  assert.equal((await paymentsFor(cus)).length, 1, 'One key must give exactly one payments row.');
  assert.ok(ok.length >= 1, 'At least one of the concurrent requests should succeed.');
  assert.equal(ok.filter((r) => r.replayed === false).length, 1, 'Exactly one successful result should be the original (replayed: false).');
  assert.equal(new Set(ok.map((r) => Number(r.paymentId))).size, 1, 'Every successful result must name the same payment.');

  const many = customer('many');
  await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? one : two).pay({ customerId: many, key: `k${i}`, amountCents: 100 + i })));
  assert.equal((await paymentsFor(many)).length, 8, 'Eight different keys at once should give eight payments.');
});

test('lost-response: after a lost gateway response, a retry with the same key completes without a second charge', async () => {
  ready();
  const gw = makeGateway();
  const cus = customer('lost');
  gw.hooks.push((req, index) => (index === 0 ? 'lose-response' : undefined));
  const { pay } = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  const input = { customerId: cus, key: 'k', amountCents: 999 };
  await assert.rejects(withTimeout(pay(input), 5000, 'pay()'), 'When the gateway call fails, pay() should reject.');
  const r = await payUntilDone(pay, input);
  assert.equal(gw.realChargesFor(cus), 1, 'The retry charged the card a second time. The gateway must see the same idempotencyKey again.');
  const rows = await paymentsFor(cus);
  assert.equal(rows.length, 1, `Expected one payment after the retry, found ${rows.length}.`);
  assert.equal(r.chargeId, rows[0].charge_id, 'The retry should record and return the charge the gateway made the first time.');
  assert.equal(gw.calls[0].idempotencyKey, gw.calls.at(-1).idempotencyKey, 'Both attempts should send the gateway the same idempotencyKey.');
});

test('lease-takeover: a key held by a crashed request is refused while leased and taken over after the lease', async () => {
  ready();
  const gw = makeGateway();
  const cus = customer('crash');
  gw.hooks.push((req, index) => (index === 0 ? 'hang' : undefined));
  const input = { customerId: cus, key: 'k', amountCents: 1500 };

  // Instance A starts the payment, and its gateway call never returns: think of a process that died.
  const a = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  a.pay({ ...input }).catch(() => {});
  const t0 = Date.now();
  while (gw.calls.length === 0 && Date.now() - t0 < 3000) await sleep(10);
  assert.equal(gw.calls.length, 1, 'The first pay() should have called the gateway.');

  // Instance B retries at once: the lease is still running.
  const b = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  await assert.rejects(
    withTimeout(b.pay({ ...input }), 3000, 'pay() on a second instance while the key is leased (does the first request hold a transaction or lock?)'),
    (e) => e instanceof state.mod.RequestInProgressError,
    'While the first request holds a live lease, a duplicate should get RequestInProgressError.',
  );

  // After the lease, B takes over and completes.
  const r = await payUntilDone(b.pay, { ...input });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed >= LEASE_MS - 50, `The key was taken over after ${elapsed} ms, before its ${LEASE_MS} ms lease expired.`);
  assert.equal(r.replayed, false, 'The takeover does the work, so replayed is false.');
  assert.equal(gw.realChargesFor(cus), 1, 'The takeover must charge the card exactly once.');
  assert.equal((await paymentsFor(cus)).length, 1, 'The takeover should record exactly one payment.');
});

test('finishes-atomically: if recording the payment fails, the key is not marked done and a retry records it', async () => {
  ready();
  await state.admin.query(`
    create or replace function m08_fail_payment() returns trigger language plpgsql as $$
    begin
      if new.amount_cents = 6666 then raise exception 'disk full (simulated by the check)'; end if;
      return new;
    end $$;
    drop trigger if exists m08_fail_payment on payments;
    create trigger m08_fail_payment before insert on payments for each row execute function m08_fail_payment();
  `);
  const gw = makeGateway();
  const cus = customer('atomic');
  const { pay } = state.mod.createPayments(makePool(), gw, { leaseMs: LEASE_MS });
  const input = { customerId: cus, key: 'k', amountCents: 6666 };
  try {
    await assert.rejects(withTimeout(pay(input), 5000, 'pay()'), 'pay() should reject when the payments insert fails.');
  } finally {
    await state.admin.query('drop trigger if exists m08_fail_payment on payments');
  }
  const r = await payUntilDone(pay, input);
  const rows = await paymentsFor(cus);
  assert.equal(rows.length, 1, `After the retry there should be one payment row, found ${rows.length}. Was the key marked done without a payment?`);
  assert.equal(Number(r.paymentId), rows[0].id, 'The retry must return the payment that now exists, not a stored result for one that was never written.');
  assert.equal(gw.realChargesFor(cus), 1, 'The retry must not charge the card again.');
});
