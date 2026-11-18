// Checks for "Reserve stock without lost updates". Node built-ins only; `pg` comes from the submission.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(new URL(import.meta.url).pathname);
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
    await state.admin.query('drop schema if exists inv cascade; create schema inv; set search_path to inv');
    await state.admin.query(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  } catch (error) {
    state.setupError = `Could not prepare the database: ${error.message}`;
    return;
  }
  if (state.compileOutput) return;
  const entry = path.join(dir, 'dist', 'inventory.js');
  try {
    if (!existsSync(entry)) throw new Error('dist/inventory.js was not produced. Keep src/inventory.ts and outDir "dist".');
    state.mod = await import(pathToFileURL(entry).href);
    if (typeof state.mod.createInventory !== 'function') throw new Error('src/inventory.ts must export createInventory(pool).');
    if (typeof state.mod.OutOfStockError !== 'function') throw new Error('src/inventory.ts must export the OutOfStockError class.');
  } catch (error) {
    state.setupError = String(error?.message ?? error);
  }
});

after(async () => {
  // Close every connection directly: pool.end() would wait forever for a client that was never released.
  await Promise.all(state.clients.map((c) => withTimeout(c.end(), 2000, 'Closing a client').catch(() => {})));
  await Promise.all(state.pools.map((p) => withTimeout(p.end(), 2000, 'Closing a pool').catch(() => {})));
  await state.admin?.end();
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
}

/** A fresh pool whose connections use the check's schema, and an inventory built on it. */
function makeInventory(max = 10) {
  const pool = new state.pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    options: '-c search_path=inv -c statement_timeout=5000 -c lock_timeout=5000',
    connectionTimeoutMillis: 5000,
  });
  state.pools.push(pool);
  pool.on('connect', (client) => state.clients.push(client));
  return { pool, inventory: state.mod.createInventory(pool) };
}

async function resetProduct(id, stock) {
  await state.admin.query('delete from reservations where product_id = $1', [id]);
  await state.admin.query('delete from products where id = $1', [id]);
  await state.admin.query('insert into products (id, name, stock) values ($1, $2, $3)', [id, `Product ${id}`, stock]);
}

const stockOf = async (id) => (await state.admin.query('select stock from products where id = $1', [id])).rows[0]?.stock;
const reservationCount = async (id) =>
  (await state.admin.query('select count(*)::int as n from reservations where product_id = $1', [id])).rows[0].n;

/** Fails the test instead of hanging when a call never settles (for example, a client that is never released). */
function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('reserves: a reservation takes stock and an oversized one is refused', async () => {
  ready();
  const { inventory } = makeInventory();
  await resetProduct(1, 5);
  const r = await inventory.reserve(1, 2, 'basic-1');
  assert.equal(Number(r?.productId), 1, 'reserve() should return the reservation with its productId.');
  assert.equal(Number(r?.quantity), 2, 'reserve() should return the reservation with its quantity.');
  assert.equal(r?.orderRef, 'basic-1', 'reserve() should return the reservation with its orderRef.');
  assert.ok(Number.isInteger(Number(r?.id)) && Number(r.id) > 0, 'reserve() should return the id of the new reservation row.');
  assert.equal(await stockOf(1), 3, 'After reserving 2 of 5, stock should be 3.');
  assert.equal(await inventory.stockOf(1), 3, 'stockOf(1) should return the current stock.');

  await assert.rejects(
    inventory.reserve(1, 4, 'basic-2'),
    (error) => error instanceof state.mod.OutOfStockError,
    'Reserving 4 when 3 are left should reject with OutOfStockError.',
  );
  assert.equal(await stockOf(1), 3, 'A refused reservation must not change the stock.');
  assert.equal(await reservationCount(1), 1, 'A refused reservation must not create a reservation row.');

  await inventory.reserve(1, 3, 'basic-3');
  assert.equal(await stockOf(1), 0, 'Reserving exactly the remaining stock should be allowed.');
});

test('no-lost-update: concurrent reservations never sell more than the stock', async () => {
  ready();
  const { inventory } = makeInventory(10);

  await resetProduct(2, 10);
  const results = await withTimeout(
    Promise.allSettled(Array.from({ length: 30 }, (_, i) => inventory.reserve(2, 1, `race-a-${i}`))),
    15_000,
    '30 concurrent reservations',
  );
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  const other = results.filter((r) => r.status === 'rejected' && !(r.reason instanceof state.mod.OutOfStockError));
  const firstOther = String(other[0]?.reason?.message ?? '');
  const exhausted = /timeout exceeded when trying to connect/i.test(firstOther)
    ? ' The pool ran out of connections: is every client from pool.connect() released, also after an error?'
    : '';
  assert.equal(other.length, 0, `Concurrent reservations should only fail with OutOfStockError, got: ${firstOther}.${exhausted}`);
  assert.equal(ok, 10, `30 concurrent reservations of 1 unit against a stock of 10: expected 10 to succeed, ${ok} did.`);
  assert.equal(await stockOf(2), 0, `Stock should end at 0, found ${await stockOf(2)}. Some updates were lost.`);
  assert.equal(await reservationCount(2), 10, 'There should be exactly one reservation row per successful call.');

  await resetProduct(3, 25);
  const quantities = [3, 5, 2, 7, 4, 6, 1, 8, 2, 3, 5, 4, 6, 2, 1, 3, 7, 2, 4, 5];
  const mixed = await withTimeout(
    Promise.allSettled(quantities.map((q, i) => inventory.reserve(3, q, `race-b-${i}`))),
    15_000,
    '20 concurrent reservations of mixed sizes',
  );
  const reserved = mixed.reduce((sum, r, i) => (r.status === 'fulfilled' ? sum + quantities[i] : sum), 0);
  const left = await stockOf(3);
  assert.ok(left >= 0, `Stock went negative: ${left}.`);
  assert.equal(reserved + left, 25, `Reserved ${reserved} units and ${left} are left, but the product started with 25.`);
  const rows = (await state.admin.query('select coalesce(sum(quantity), 0)::int as n from reservations where product_id = 3')).rows[0].n;
  assert.equal(rows, reserved, `The reservation rows add up to ${rows} units, but ${reserved} were reported as reserved.`);
});

test('atomic: a failed reservation leaves no trace', async () => {
  ready();
  const { inventory } = makeInventory();
  await resetProduct(4, 10);
  await inventory.reserve(4, 2, 'dup-1');
  await assert.rejects(inventory.reserve(4, 3, 'dup-1'), 'Reusing an order_ref should reject (order_ref is unique).');
  assert.equal(await stockOf(4), 8, `The duplicate reservation failed, but stock is ${await stockOf(4)} instead of 8. The stock change and the insert must succeed or fail together.`);
  await assert.rejects(inventory.reserve(4, -5, 'negative-1'), 'A negative quantity should be rejected.');
  assert.equal(await stockOf(4), 8, `A reservation with quantity -5 failed, but stock changed to ${await stockOf(4)}.`);
  assert.equal(await reservationCount(4), 1, 'Only the first reservation should exist.');
});

test('parameterised: values are sent as parameters, not pasted into SQL', async () => {
  ready();
  const { inventory } = makeInventory();
  await resetProduct(5, 10);
  const ref = "O'Brien-7'); delete from products; --";
  try {
    await inventory.reserve(5, 1, ref);
  } catch (error) {
    assert.fail(`Reserving with orderRef ${JSON.stringify(ref)} failed: ${error.message}. Quotes in values must not break the SQL.`);
  }
  const { rows } = await state.admin.query('select order_ref from reservations where product_id = 5');
  assert.deepEqual(rows.map((r) => r.order_ref), [ref], 'The orderRef should be stored exactly as given.');
  assert.equal(await stockOf(5), 9, 'Stock should be 9 after reserving one unit.');
});

test('releases-clients: every pooled client is returned, also after errors', async () => {
  ready();
  const { pool, inventory } = makeInventory(2);
  await resetProduct(6, 5);
  const calls = [];
  for (let i = 0; i < 12; i++) {
    // A mix of successes, out-of-stock errors and duplicate order refs.
    calls.push(inventory.reserve(6, 1, `leak-${i % 8}`).catch(() => {}));
  }
  await withTimeout(
    Promise.all(calls),
    10_000,
    '12 reservations on a pool of 2 connections (a client that is never released blocks the pool)',
  );
  await withTimeout(inventory.reserve(6, 100, 'leak-final').catch(() => {}), 5_000, 'A reservation after the errors');
  assert.equal(pool.waitingCount, 0, `${pool.waitingCount} callers are still waiting for a connection.`);
  assert.equal(pool.idleCount, pool.totalCount, `${pool.totalCount - pool.idleCount} pooled clients were never released.`);
});
