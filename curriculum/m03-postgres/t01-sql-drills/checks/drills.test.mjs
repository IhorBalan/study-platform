// Checks for "SQL drills". Node built-ins only; `pg` comes from the submission's node_modules.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const here = path.dirname(new URL(import.meta.url).pathname);
const fixture = (name) => readFileSync(path.join(here, name), 'utf8');

const state = { client: null, setupError: null };

// The reference answers. They run against the same data as the submission.
const REFERENCE = {
  '01-customer-revenue.sql': `
    with order_totals as (
      select order_id, sum(quantity * unit_price) as total from order_items group by order_id
    )
    select c.id as customer_id, c.email, count(o.id) as paid_orders, coalesce(sum(t.total), 0) as revenue
    from customers c
    left join orders o on o.customer_id = c.id and o.status = 'paid'
    left join order_totals t on t.order_id = o.id
    group by c.id, c.email
    order by revenue desc, customer_id`,
  '02-monthly-revenue.sql': `
    with monthly as (
      select date_trunc('month', o.created_at at time zone 'UTC')::date as month,
             sum(i.quantity * i.unit_price) as revenue
      from orders o join order_items i on i.order_id = o.id
      where o.status = 'paid'
      group by 1
    )
    select month, revenue, sum(revenue) over (order by month) as running_total
    from monthly order by month`,
  '03-top-products-per-category.sql': `
    with units as (
      select p.id, p.name, p.category_id, sum(i.quantity) as units_sold
      from products p
      join order_items i on i.product_id = p.id
      join orders o on o.id = i.order_id and o.status = 'paid'
      group by p.id
    ), ranked as (
      select u.*, row_number() over (partition by u.category_id order by u.units_sold desc, u.id) as rank
      from units u
    )
    select c.name as category, r.name as product, r.units_sold, r.rank
    from ranked r join categories c on c.id = r.category_id
    where r.rank <= 2
    order by c.name, r.rank`,
  '04-duplicate-emails.sql': `
    select lower(trim(email)) as email, array_agg(id order by id) as customer_ids
    from customers
    group by lower(trim(email))
    having count(*) > 1
    order by email`,
  '05-days-to-second-order.sql': `
    with numbered as (
      select customer_id, created_at,
             row_number() over (partition by customer_id order by created_at, id) as n
      from orders where status = 'paid'
    )
    select f.customer_id, f.created_at as first_order_at, s.created_at as second_order_at,
           (s.created_at at time zone 'UTC')::date - (f.created_at at time zone 'UTC')::date as days_between
    from numbered f
    join numbered s on s.customer_id = f.customer_id and s.n = 2
    where f.n = 1
    order by days_between, f.customer_id`,
};

async function loadPg() {
  const require = createRequire(path.join(dir, 'package.json'));
  const mod = await import(require.resolve('pg'));
  return mod.default ?? mod;
}

before(async () => {
  if (!process.env.DATABASE_URL) {
    state.setupError = 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.';
    return;
  }
  try {
    const pg = await loadPg();
    // Keep `date` values as 'YYYY-MM-DD' strings instead of local-midnight Date objects.
    const types = {
      getTypeParser: (oid, format) => (oid === 1082 ? (value) => value : pg.types.getTypeParser(oid, format)),
    };
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, types });
    await client.connect();
    state.client = client;
    await client.query('drop schema if exists drills cascade; create schema drills; set search_path to drills');
    await client.query(fixture('schema.sql'));
    await client.query(fixture('seed.sql'));
    await client.query(fixture('extra.sql'));
    // Deliberately not UTC: queries must say which time zone they mean.
    await client.query(`set time zone 'America/New_York'; set statement_timeout = '5s'`);
  } catch (error) {
    state.setupError = `Could not prepare the database: ${error.message}`;
  }
});

after(async () => {
  await state.client?.end();
});

function normalise(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value.map(normalise));
  const numeric =
    typeof value === 'number' || typeof value === 'bigint' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value));
  if (numeric) {
    const n = Number(value);
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  return String(value);
}

async function runReadOnly(sql) {
  const client = state.client;
  await client.query('begin read only');
  try {
    const result = await client.query(sql);
    // A file with several statements returns one result per statement; the last one counts.
    return Array.isArray(result) ? result.at(-1) : result;
  } finally {
    await client.query('rollback');
  }
}

async function checkQuery(file) {
  assert.ok(!state.setupError, state.setupError);
  const filePath = path.join(dir, 'queries', file);
  assert.ok(existsSync(filePath), `queries/${file} is missing.`);
  const sql = readFileSync(filePath, 'utf8');
  const withoutComments = sql.replace(/--.*$/gm, '').trim();
  assert.ok(withoutComments.length > 0, `queries/${file} contains no SQL yet.`);

  let actual;
  try {
    actual = await runReadOnly(sql);
  } catch (error) {
    assert.fail(`queries/${file} failed to run: ${error.message}`);
  }
  const expected = await runReadOnly(REFERENCE[file]);

  const expectedColumns = expected.fields.map((f) => f.name);
  const actualColumns = (actual.fields ?? []).map((f) => f.name);
  assert.deepEqual(
    actualColumns,
    expectedColumns,
    `queries/${file}: expected the columns ${expectedColumns.join(', ')} in that order, got ${actualColumns.join(', ') || '(none)'}.`,
  );

  const toRows = (result) => result.rows.map((row) => expectedColumns.map((c) => normalise(row[c])));
  const want = toRows(expected);
  const got = toRows(actual);
  assert.equal(got.length, want.length, `queries/${file}: expected ${want.length} rows, got ${got.length}.`);
  for (let i = 0; i < want.length; i++) {
    assert.deepEqual(
      got[i],
      want[i],
      `queries/${file}: row ${i + 1} differs. Expected ${JSON.stringify(want[i])}, got ${JSON.stringify(got[i])}. Check filters, NULL handling, time zones and ORDER BY.`,
    );
  }
}

test('customer-revenue: every customer with paid orders and revenue', () => checkQuery('01-customer-revenue.sql'));
test('monthly-revenue: monthly paid revenue with a running total', () => checkQuery('02-monthly-revenue.sql'));
test('top-products: the two best-selling products per category', () =>
  checkQuery('03-top-products-per-category.sql'));
test('duplicate-emails: addresses shared by several customers', () => checkQuery('04-duplicate-emails.sql'));
test('second-order: days between first and second paid order', () => checkQuery('05-days-to-second-order.sql'));
