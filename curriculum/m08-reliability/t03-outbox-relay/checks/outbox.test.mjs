// Checks for "Outbox, relay and inbox". Node built-ins only; `pg` comes from the submission.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SCHEMA = 'm08_outbox_chk';
const state = { compileOutput: null, setupError: null, pg: null, admin: null, mods: {}, pools: [], clients: [] };

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
    for (const [table, cols] of [['orders', ['id', 'customer_id', 'total_cents']], ['outbox', ['id', 'topic', 'payload']]]) {
      const { rows } = await state.admin.query(
        'select column_name from information_schema.columns where table_schema = $1 and table_name = $2',
        [SCHEMA, table],
      );
      const names = rows.map((r) => r.column_name);
      for (const c of cols) if (!names.includes(c)) throw new Error(`table ${table} needs its ${c} column.`);
    }
    await state.admin.query('create table m08_counter (id text primary key, n int not null default 0)');
  } catch (error) {
    state.setupError = `db/schema.sql could not be applied in an empty schema: ${error.message}`;
    return;
  }
  if (state.compileOutput) return;
  try {
    for (const [file, name] of [['orders', 'placeOrder'], ['outbox', 'relayOnce'], ['inbox', 'consume']]) {
      const entry = path.join(dir, 'dist', `${file}.js`);
      if (!existsSync(entry)) throw new Error(`dist/${file}.js was not produced. Keep src/${file}.ts and outDir "dist".`);
      const mod = await import(pathToFileURL(entry).href);
      if (typeof mod[name] !== 'function') throw new Error(`src/${file}.ts must export a function named ${name}.`);
      state.mods[name] = mod[name];
    }
  } catch (error) {
    state.setupError = String(error?.message ?? error);
  }
});

after(async () => {
  await Promise.all(state.clients.map((c) => withTimeout(c.end(), 2000, 'Closing a client').catch(() => {})));
  await Promise.all(state.pools.map((p) => withTimeout(p.end(), 2000, 'Closing a pool').catch(() => {})));
  await state.admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
  await state.admin?.end();
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
  return state.mods;
}

function makePool(max = 5) {
  const pool = new state.pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max,
    options: `-c search_path=${SCHEMA} -c statement_timeout=10000 -c lock_timeout=10000`,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => state.clients.push(client));
  state.pools.push(pool);
  return pool;
}

function withTimeout(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Starts a test from an empty outbox and order table. */
async function clean() {
  await state.admin.query('delete from outbox; delete from orders');
}

function recorder() {
  const sent = [];
  return { sent, publish: async (m) => void sent.push(structuredClone({ id: m?.id, topic: m?.topic, payload: m?.payload })) };
}

const customersOf = (sent) => sent.map((m) => m.payload?.customerId);
const orderCount = async (customerId) =>
  (await state.admin.query('select count(*)::int as n from orders where customer_id = $1', [customerId])).rows[0].n;

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('writes-atomically: an order and its message commit together or not at all', async () => {
  const { placeOrder, relayOnce } = ready();
  await clean();
  const pool = makePool();
  const { orderId } = await withTimeout(placeOrder(pool, { customerId: 'ok-1', totalCents: 4200 }), 5000, 'placeOrder()');
  const row = (await state.admin.query('select customer_id, total_cents from orders where id = $1', [orderId])).rows[0];
  assert.deepEqual(row, { customer_id: 'ok-1', total_cents: 4200 }, 'placeOrder() should insert the order and return its id.');
  const { rows: pending } = await state.admin.query('select topic, payload from outbox');
  assert.equal(pending.length, 1, `placeOrder() should add exactly one outbox row, found ${pending.length}.`);
  assert.equal(pending[0].topic, 'order.placed', 'The outbox row should have the topic order.placed.');
  assert.deepEqual(pending[0].payload, { orderId, customerId: 'ok-1', totalCents: 4200 }, 'The payload should be { orderId, customerId, totalCents }.');

  // The outbox insert fails: no order may remain.
  await state.admin.query(`
    create or replace function m08_fail_outbox() returns trigger language plpgsql as $$
    begin
      if new.payload->>'customerId' = 'fail-outbox' then raise exception 'outbox write failed (simulated by the check)'; end if;
      return new;
    end $$;
    create trigger m08_fail_outbox before insert on outbox for each row execute function m08_fail_outbox();
    create or replace function m08_fail_order() returns trigger language plpgsql as $$
    begin
      if new.customer_id = 'fail-order' then raise exception 'commit failed (simulated by the check)'; end if;
      return new;
    end $$;
    create constraint trigger m08_fail_order after insert on orders deferrable initially deferred
      for each row execute function m08_fail_order();
  `);
  try {
    await assert.rejects(placeOrder(pool, { customerId: 'fail-outbox', totalCents: 1 }), 'placeOrder() should reject when the outbox insert fails.');
    assert.equal(await orderCount('fail-outbox'), 0, 'The outbox insert failed, but the order was saved anyway: an order nobody will hear about.');

    await assert.rejects(placeOrder(pool, { customerId: 'fail-order', totalCents: 1 }), 'placeOrder() should reject when the order cannot be committed.');
    assert.equal(await orderCount('fail-order'), 0, 'The order must not exist after a failed commit.');
    const { sent, publish } = recorder();
    await relayOnce(pool, publish);
    assert.ok(!customersOf(sent).includes('fail-order'), 'A message was published for an order that was never committed.');
  } finally {
    await state.admin.query('drop trigger if exists m08_fail_outbox on outbox; drop trigger if exists m08_fail_order on orders');
  }
});

test('relays: pending messages are published oldest first, once, as { id, topic, payload }', async () => {
  const { placeOrder, relayOnce } = ready();
  await clean();
  const pool = makePool();
  for (const c of ['r-1', 'r-2', 'r-3']) await placeOrder(pool, { customerId: c, totalCents: 10 });
  const { sent, publish } = recorder();
  const n = await withTimeout(relayOnce(pool, publish), 5000, 'relayOnce()');
  assert.equal(n, 3, `relayOnce() should return the number of messages it published (3), got ${n}.`);
  assert.deepEqual(customersOf(sent), ['r-1', 'r-2', 'r-3'], 'Messages should be published oldest first.');
  const ids = (await state.admin.query('select id::text as id from outbox order by id')).rows.map((r) => r.id);
  for (const m of sent) {
    assert.equal(typeof m.id, 'string', 'message.id should be the outbox row id as a string.');
    assert.equal(m.topic, 'order.placed', 'message.topic should be the outbox topic.');
  }
  if (ids.length === 3) assert.deepEqual(sent.map((m) => m.id), ids, 'message.id should be the id of the outbox row.');

  const again = await relayOnce(pool, publish);
  assert.equal(again, 0, `A second round with nothing pending should return 0, got ${again}.`);
  assert.equal(sent.length, 3, 'A second round must not publish the same messages again.');
});

test('batch-size: one round publishes at most batchSize messages, 50 by default', async () => {
  const { placeOrder, relayOnce } = ready();
  await clean();
  const pool = makePool();
  for (let i = 0; i < 12; i++) await placeOrder(pool, { customerId: `b-${i}`, totalCents: i });
  const { sent, publish } = recorder();
  assert.equal(await relayOnce(pool, publish, { batchSize: 5 }), 5, 'With batchSize 5 one round should publish 5 messages.');
  assert.deepEqual(customersOf(sent), ['b-0', 'b-1', 'b-2', 'b-3', 'b-4'], `The first round should take the five oldest messages, it published ${JSON.stringify(customersOf(sent))}.`);
  assert.equal(await relayOnce(pool, publish), 7, 'Without a batchSize the next round should publish the remaining 7.');

  for (let i = 0; i < 55; i++) await placeOrder(pool, { customerId: `big-${i}`, totalCents: i });
  assert.equal(await relayOnce(pool, async () => {}), 50, 'The default batchSize is 50.');
});

test('at-least-once: a failed publish leaves the message pending for a later round, and relayOnce resolves', async () => {
  const { placeOrder, relayOnce } = ready();
  await clean();
  const pool = makePool();
  for (const c of ['f-1', 'f-2', 'f-3']) await placeOrder(pool, { customerId: c, totalCents: 1 });
  const accepted = [];
  let failures = 0;
  const flaky = async (m) => {
    if (m?.payload?.customerId === 'f-2' && failures < 2) {
      failures++;
      throw new Error('broker unavailable (simulated by the check)');
    }
    accepted.push(m.payload.customerId);
  };
  for (let round = 0; round < 4; round++) {
    await withTimeout(relayOnce(pool, flaky), 5000, 'relayOnce()').catch((e) => {
      throw new Error(`relayOnce() must not reject when publish() fails; it rejected with: ${e.message}`);
    });
  }
  assert.equal(failures, 2, 'The failing message should be tried again in later rounds.');
  assert.deepEqual(
    [...accepted].sort(),
    ['f-1', 'f-2', 'f-3'],
    `Every message should be accepted exactly once in the end, accepted: ${JSON.stringify(accepted)}.`,
  );
  assert.equal(await relayOnce(pool, flaky), 0, 'Nothing should be pending once every message was accepted.');
});

test('concurrent-relays: four relays on four pools publish every message exactly once', async () => {
  const { placeOrder, relayOnce } = ready();
  await clean();
  const setup = makePool(10);
  const total = 200;
  await Promise.all(Array.from({ length: total }, (_, i) => placeOrder(setup, { customerId: `c-${i}`, totalCents: i })));
  const counts = new Map();
  const perRelay = [0, 0, 0, 0];
  const relays = perRelay.map(async (_, r) => {
    const pool = makePool(2);
    const publish = async (m) => {
      await new Promise((res) => setTimeout(res, 2));
      counts.set(m.id, (counts.get(m.id) ?? 0) + 1);
      perRelay[r]++;
    };
    for (let guard = 0; guard < 500; guard++) {
      if ((await relayOnce(pool, publish, { batchSize: 10 })) === 0) break;
    }
  });
  await withTimeout(Promise.all(relays), 20_000, 'Four relays draining 200 messages');
  const twice = [...counts.values()].filter((n) => n > 1).length;
  assert.equal(twice, 0, `${twice} messages were published more than once while four relays ran side by side.`);
  assert.equal(counts.size, total, `Expected all ${total} messages to be published, ${counts.size} were.`);
});

test('inbox: consume() applies a message once, inside the same transaction as its inbox record', async () => {
  const { consume } = ready();
  const a = makePool(5);
  const b = makePool(5);
  const id = `msg-${process.pid}-1`;
  await state.admin.query('insert into m08_counter (id) values ($1)', [id]);
  const bump = (counterId, thenFail = false) => async (client) => {
    await client.query('update m08_counter set n = n + 1 where id = $1', [counterId]);
    if (thenFail) throw new Error('handler failed after writing (simulated by the check)');
  };
  const n = async (counterId) => (await state.admin.query('select n from m08_counter where id = $1', [counterId])).rows[0].n;
  const message = { id, topic: 'order.placed', payload: { orderId: 1 } };

  assert.equal(await consume(a, message, bump(id)), 'processed', "The first delivery should return 'processed'.");
  assert.equal(await consume(b, { ...message }, bump(id)), 'duplicate', "A redelivery should return 'duplicate'.");
  assert.equal(await n(id), 1, `The handler's effect should be applied once, the counter is ${await n(id)}.`);

  const failing = `msg-${process.pid}-2`;
  await state.admin.query('insert into m08_counter (id) values ($1)', [failing]);
  await assert.rejects(consume(a, { ...message, id: failing }, bump(failing, true)), 'consume() should reject when the handler throws.');
  assert.equal(await n(failing), 0, "The handler threw, but its write was kept. Run apply() on the transaction's client and roll back.");
  assert.equal(await consume(a, { ...message, id: failing }, bump(failing)), 'processed', 'After a failed attempt the message must be processed on redelivery.');
  assert.equal(await n(failing), 1, 'The redelivered message should be applied once.');

  const raced = `msg-${process.pid}-3`;
  await state.admin.query('insert into m08_counter (id) values ($1)', [raced]);
  const slowBump = async (client) => {
    await client.query('update m08_counter set n = n + 1 where id = $1', [raced]);
    await new Promise((r) => setTimeout(r, 100));
  };
  const outcomes = await withTimeout(
    Promise.all(Array.from({ length: 6 }, (_, i) => consume(i % 2 ? a : b, { ...message, id: raced }, slowBump))),
    10_000,
    'six concurrent deliveries of one message',
  );
  assert.equal(await n(raced), 1, `Six simultaneous deliveries applied the message ${await n(raced)} times.`);
  assert.deepEqual(outcomes.filter((o) => o === 'processed').length, 1, "Exactly one concurrent delivery should return 'processed'.");
});
