// Checks for "Make slow queries fast". Node built-ins only; `pg` comes from the submission.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(new URL(import.meta.url).pathname);
const MIGRATION = path.join('migrations', '001_indexes.sql');

// The queries from queries.sql, fixed here so that edits to the submission's copy change nothing.
const QUERIES = {
  customerOrders: `select id, status, total_cents, created_at from orders
    where customer_id = 1234 order by created_at desc limit 20`,
  pendingOrders: `select id, customer_id, created_at from orders
    where status = 'pending' and created_at < now() - interval '1 hour' order by created_at limit 100`,
  emailLookup: `select id, name from customers where lower(email) = lower('User4242@example.com')`,
  tagSearch: `select id, name from products where tags @> array['clearance']`,
};

const state = { pg: null, admin: null, setupError: null, migrationError: null };

async function loadPg() {
  const require = createRequire(path.join(dir, 'package.json'));
  const mod = await import(require.resolve('pg'));
  return mod.default ?? mod;
}

/** Splits a migration into statements at semicolons that end a line. Comments are removed first. */
function statements(sql) {
  return sql
    .replace(/--.*$/gm, '')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function connect(searchPath = true) {
  const client = new state.pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  if (searchPath) await client.query('set search_path to perf, public');
  return client;
}

async function applyMigration() {
  const file = path.join(dir, MIGRATION);
  if (!existsSync(file)) return `${MIGRATION} is missing from the submission.`;
  const parts = statements(readFileSync(file, 'utf8'));
  if (!parts.some((s) => /^create\s+(unique\s+)?index/i.test(s))) {
    return `${MIGRATION} contains no CREATE INDEX statement yet.`;
  }
  // A fresh connection, so session settings in the migration cannot affect the plans.
  const client = await connect();
  try {
    await client.query(`set statement_timeout = '30s'`);
    for (const sql of parts) {
      try {
        await client.query(sql);
      } catch (error) {
        return `${MIGRATION} failed on "${sql.slice(0, 80)}": ${error.message}`;
      }
    }
    await client.query('analyze');
    return null;
  } finally {
    await client.end();
  }
}

before(async () => {
  if (!process.env.DATABASE_URL) {
    state.setupError = 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.';
    return;
  }
  try {
    state.pg = await loadPg();
    const admin = await connect(false);
    state.admin = admin;
    await admin.query('drop schema if exists perf cascade; create schema perf; set search_path to perf, public');
    await admin.query(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
    await admin.query(readFileSync(path.join(here, 'seed.sql'), 'utf8'));
  } catch (error) {
    state.setupError = `Could not prepare the database: ${error.message}`;
    return;
  }
  try {
    state.migrationError = await applyMigration();
  } catch (error) {
    state.migrationError = `${MIGRATION} could not be applied: ${error.message}`;
  }
  // Plans without parallel workers are stable across machines.
  await state.admin.query('set max_parallel_workers_per_gather = 0');
});

after(async () => {
  await state.admin?.end();
});

function ready() {
  assert.ok(!state.setupError, state.setupError);
  assert.ok(!state.migrationError, `Fix the "applies" criterion first. ${state.migrationError}`);
}

/** Returns every node of the plan as a flat list. */
async function planNodes(sql) {
  const { rows } = await state.admin.query(`explain (format json) ${sql}`);
  const nodes = [];
  const walk = (node) => {
    nodes.push(node);
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(rows[0]['QUERY PLAN'][0].Plan);
  return nodes;
}

const describe = (nodes) =>
  nodes.map((n) => `${n['Node Type']}${n['Relation Name'] ? ` on ${n['Relation Name']}` : ''}${n['Index Name'] ? ` using ${n['Index Name']}` : ''}`).join(' > ');

function assertNoSeqScan(nodes, table, what) {
  const seq = nodes.find((n) => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === table);
  assert.ok(!seq, `${what}: the plan still reads every row of ${table} (Seq Scan). Plan: ${describe(nodes)}`);
}

async function indexInfo(name) {
  const { rows } = await state.admin.query(
    `select am.amname as method, i.indpred is not null as partial
     from pg_class c join pg_index i on i.indexrelid = c.oid join pg_am am on am.oid = c.relam
     join pg_namespace n on n.oid = c.relnamespace
     where c.relname = $1 and n.nspname = 'perf'`,
    [name],
  );
  return rows[0];
}

test('applies: the migration runs and creates indexes', () => {
  assert.ok(!state.setupError, state.setupError);
  assert.ok(!state.migrationError, state.migrationError);
});

test("customer-orders: a customer's latest orders come from an index without a sort", async () => {
  ready();
  const nodes = await planNodes(QUERIES.customerOrders);
  assertNoSeqScan(nodes, 'orders', 'Query 1');
  const sort = nodes.find((n) => n['Node Type'] === 'Sort' || n['Node Type'] === 'Incremental Sort');
  assert.ok(
    !sort,
    `Query 1: the plan uses an index but still sorts the customer's orders (${sort?.['Node Type']}). An index can return them already in order. Plan: ${describe(nodes)}`,
  );
});

test('pending-orders: pending orders come from a partial index', async () => {
  ready();
  const nodes = await planNodes(QUERIES.pendingOrders);
  assertNoSeqScan(nodes, 'orders', 'Query 2');
  const used = nodes.filter((n) => n['Index Name']).map((n) => n['Index Name']);
  assert.ok(used.length > 0, `Query 2: the plan uses no index. Plan: ${describe(nodes)}`);
  const infos = await Promise.all(used.map(indexInfo));
  assert.ok(
    infos.some((info) => info?.partial),
    `Query 2: the plan uses ${used.join(', ')}, which indexes every order. Only 0.5% of orders are pending; index just those rows. Plan: ${describe(nodes)}`,
  );
});

test('email-lookup: the case-insensitive email lookup uses an index', async () => {
  ready();
  const nodes = await planNodes(QUERIES.emailLookup);
  assertNoSeqScan(nodes, 'customers', 'Query 3');
  assert.ok(nodes.some((n) => n['Index Name']), `Query 3: the plan uses no index. Plan: ${describe(nodes)}`);
});

test('tag-search: the tag search uses a GIN index', async () => {
  ready();
  const nodes = await planNodes(QUERIES.tagSearch);
  assertNoSeqScan(nodes, 'products', 'Query 4');
  const used = nodes.filter((n) => n['Index Name']).map((n) => n['Index Name']);
  const infos = await Promise.all(used.map(indexInfo));
  assert.ok(
    infos.some((info) => info?.method === 'gin'),
    `Query 4: expected the plan to use a GIN index, found ${used.join(', ') || 'none'}. Plan: ${describe(nodes)}`,
  );
});
