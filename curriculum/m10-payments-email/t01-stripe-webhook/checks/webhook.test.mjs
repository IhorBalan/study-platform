// Checks for "A Stripe webhook handler you can trust". Node built-ins only; pg and Nest come from the submission.
// A local fake of the Stripe API answers the two GET calls the handler makes, so nothing reaches the internet.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SCHEMA = 'm10_whk_chk';
const SECRET = 'whsec_check_9c2f1b7e44a0d3';
const state = { compileOutput: null, setupError: null, admin: null, app: null, base: null, fake: null };

/** The fake Stripe API's current objects. Tests set them; the handler reads them. */
const api = { sessions: new Map(), subs: new Map(), down: false, calls: 0 };

function compile() {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  if (!existsSync(path.join(dir, 'tsconfig.json'))) return 'tsconfig.json is missing from the submission.';
  if (!existsSync(tsc)) return 'node_modules/.bin/tsc was not found in the submission directory.';
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true });
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  if (result.status === 0) return null;
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 4000) || `tsc exited with status ${result.status}`;
}

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

function startFakeStripe() {
  const server = http.createServer((req, res) => {
    api.calls += 1;
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json', 'request-id': `req_fake_${api.calls}` });
      res.end(JSON.stringify(body));
    };
    if (api.down) return send(500, { error: { type: 'api_error', message: 'The fake Stripe API is down for this test.' } });
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    let match = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && match && api.sessions.has(match[1])) return send(200, api.sessions.get(match[1]));
    match = /^\/v1\/subscriptions\/([^/]+)$/.exec(pathname);
    if (req.method === 'GET' && match && api.subs.has(match[1])) return send(200, api.subs.get(match[1]));
    return send(404, { error: { type: 'invalid_request_error', message: `No such resource: ${req.method} ${pathname}` } });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function withSearchPath(url) {
  const u = new URL(url);
  u.searchParams.set('options', `-c search_path=${SCHEMA}`);
  return u.toString();
}

before(async () => {
  state.compileOutput = compile();
  if (!process.env.DATABASE_URL) {
    state.setupError = 'DATABASE_URL is not set. Start the lab database with `pnpm lab up postgres`.';
    return;
  }
  try {
    const pgModule = await importFromSubmission('pg');
    const pg = pgModule.default ?? pgModule;
    state.admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
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
    for (const table of ['orders', 'fulfilments', 'subscriptions']) {
      const found = await state.admin.query(
        'select 1 from information_schema.tables where table_schema = $1 and table_name = $2',
        [SCHEMA, table],
      );
      if (!found.rowCount) throw new Error(`the ${table} table is missing.`);
    }
  } catch (error) {
    state.setupError = `db/schema.sql could not be applied in an empty schema: ${error.message}`;
    return;
  }
  if (state.compileOutput) return;

  state.fake = await startFakeStripe();
  process.env.DATABASE_URL = withSearchPath(process.env.DATABASE_URL);
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  process.env.STRIPE_SECRET_KEY = 'sk_test_checks';
  process.env.STRIPE_API_BASE = `http://127.0.0.1:${state.fake.address().port}`;
  try {
    const entry = path.join(dir, 'dist', 'app.js');
    if (!existsSync(entry)) throw new Error('dist/app.js was not produced. Keep src/app.ts and outDir "dist".');
    await importFromSubmission('reflect-metadata');
    const { createApp } = await import(pathToFileURL(entry).href);
    if (typeof createApp !== 'function') throw new Error('src/app.ts must export a function named createApp.');
    state.app = await createApp();
    await state.app.listen(0, '127.0.0.1');
    state.base = `http://127.0.0.1:${state.app.getHttpServer().address().port}`;
  } catch (error) {
    state.setupError = `The app did not start: ${String(error?.message ?? error).slice(0, 1500)}`;
  }
});

after(async () => {
  await state.app?.close().catch(() => {});
  await new Promise((resolve) => (state.fake ? state.fake.close(resolve) : resolve()));
  await state.admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
  await state.admin?.end().catch(() => {});
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
}

// ---- helpers -------------------------------------------------------------------------------------

let seq = 0;
const uid = (prefix) => `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`;

function sign(payload, { secret = SECRET, timestamp = Math.floor(Date.now() / 1000) } = {}) {
  const v1 = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${v1}`;
}

function eventJson(type, object, id = uid('evt')) {
  return { id, object: 'event', api_version: '2026-10-28.endive', created: Math.floor(Date.now() / 1000), type, livemode: false, data: { object } };
}

/** POSTs a raw payload to the webhook route. `signature: null` leaves the header out. */
async function deliver(payload, { signature, signWith } = {}) {
  ready();
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const headers = { 'content-type': 'application/json' };
  const sig = signature === undefined ? sign(body, signWith) : signature;
  if (sig !== null) headers['stripe-signature'] = sig;
  const res = await fetch(`${state.base}/webhooks/stripe`, { method: 'POST', headers, body, signal: AbortSignal.timeout(15_000) });
  return { status: res.status, text: await res.text() };
}

const ok = (res) => res.status >= 200 && res.status < 300;

async function createOrder(id) {
  await state.admin.query(`insert into orders (id, amount_minor, currency) values ($1, 4900, 'eur')`, [id]);
}

async function orderState(id) {
  const order = await state.admin.query('select status from orders where id = $1', [id]);
  const fulfil = await state.admin.query('select count(*)::int as n from fulfilments where order_id = $1', [id]);
  return { status: order.rows[0]?.status, fulfilments: fulfil.rows[0].n };
}

async function storedEvents(id) {
  try {
    const { rows } = await state.admin.query('select count(*)::int as n from stripe_events where id = $1', [id]);
    return rows[0].n;
  } catch (error) {
    assert.fail(`Could not read stripe_events (${error.message}). db/schema.sql must create it with an id column.`);
  }
}

function setSession(id, orderId, paymentStatus) {
  api.sessions.set(id, {
    id,
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: paymentStatus,
    client_reference_id: orderId,
    amount_total: 4900,
    currency: 'eur',
    metadata: {},
  });
}

function setSubscription(id, { status, price = 'price_pro_monthly', periodEnd = 1_830_000_000, cancelAtPeriodEnd = false, customer = 'cus_check' }) {
  const sub = {
    id,
    object: 'subscription',
    customer,
    status,
    cancel_at_period_end: cancelAtPeriodEnd,
    items: {
      object: 'list',
      data: [{ id: `si_${id}`, object: 'subscription_item', price: { id: price, object: 'price' }, quantity: 1, current_period_start: periodEnd - 2_592_000, current_period_end: periodEnd }],
    },
  };
  api.subs.set(id, sub);
  return sub;
}

async function subscriptionRow(id) {
  const { rows } = await state.admin.query(
    `select stripe_customer_id, status, price_id, extract(epoch from current_period_end)::bigint as period_end, cancel_at_period_end
       from subscriptions where stripe_subscription_id = $1`,
    [id],
  );
  if (!rows[0]) return undefined;
  return { ...rows[0], period_end: Number(rows[0].period_end) };
}

/** A paid order scenario: a pending order, a paid session in the fake API and a completed event for it. */
async function paidScenario() {
  const orderId = uid('ord');
  const sessionId = uid('cs_test');
  await createOrder(orderId);
  setSession(sessionId, orderId, 'paid');
  const event = eventJson('checkout.session.completed', { id: sessionId, object: 'checkout.session', payment_status: 'paid', client_reference_id: orderId });
  return { orderId, sessionId, event };
}

// ---- criteria ------------------------------------------------------------------------------------

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('rejects-bad-signatures: a missing, wrong or tampered signature gets 400 and changes nothing', async () => {
  const { orderId, event } = await paidScenario();
  const body = JSON.stringify(event);

  const missing = await deliver(body, { signature: null });
  assert.equal(missing.status, 400, `No Stripe-Signature header: expected 400, got ${missing.status}`);

  const wrongSecret = await deliver(body, { signWith: { secret: 'whsec_somebody_else' } });
  assert.equal(wrongSecret.status, 400, `Signed with another secret: expected 400, got ${wrongSecret.status}`);

  const tampered = body.replace('"livemode":false', '"livemode":true');
  const tamperedRes = await deliver(tampered, { signature: sign(body) });
  assert.equal(tamperedRes.status, 400, `Body changed after signing: expected 400, got ${tamperedRes.status}`);

  const garbage = await deliver(body, { signature: 't=abc,v1=nothex' });
  assert.equal(garbage.status, 400, `A malformed Stripe-Signature header: expected 400, got ${garbage.status}`);

  const after = await orderState(orderId);
  assert.deepEqual(after, { status: 'pending', fulfilments: 0 }, 'A request with a bad signature changed the order');
  assert.equal(await storedEvents(event.id), 0, 'A request with a bad signature was stored in stripe_events');
});

test('rejects-old-signatures: a correctly signed request older than 5 minutes gets 400', async () => {
  const { orderId, event } = await paidScenario();
  const body = JSON.stringify(event);
  const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
  const res = await deliver(body, { signWith: { timestamp: tenMinutesAgo } });
  assert.equal(res.status, 400, `A signature with a timestamp 10 minutes old (a replay): expected 400, got ${res.status}`);
  assert.deepEqual(await orderState(orderId), { status: 'pending', fulfilments: 0 }, 'A replayed request changed the order');
});

test('raw-body: the signature is checked over the exact bytes that were sent', async () => {
  const { orderId, event } = await paidScenario();
  event.data.object.metadata = { note: 'caf\u00e9 \u2013 <b>' };
  // Pretty-printed, with \u escapes and a trailing newline: JSON.stringify(req.body) would give different bytes.
  const body = `${JSON.stringify(event, null, 2).replace('café', 'caf\\u00e9').replace('–', '\\u2013')}\n`;
  const res = await deliver(body);
  assert.ok(ok(res), `A correctly signed, pretty-printed body: expected 2xx, got ${res.status} ${res.text.slice(0, 200)}. Verify req.rawBody, not the parsed body.`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'The pretty-printed event was accepted but the order was not fulfilled');
});

test('fulfils-checkout: a paid checkout session marks the order paid and fulfils it', async () => {
  const { orderId, sessionId, event } = await paidScenario();
  const res = await deliver(event);
  assert.ok(ok(res), `checkout.session.completed for a paid session: expected 2xx, got ${res.status} ${res.text.slice(0, 200)}`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'Expected the order to be paid with exactly one fulfilment row');
  const { rows } = await state.admin.query('select stripe_session_id from orders where id = $1', [orderId]);
  assert.equal(rows[0].stripe_session_id, sessionId, 'orders.stripe_session_id should hold the Checkout Session id');
  assert.equal(await storedEvents(event.id), 1, 'The processed event id should be stored in stripe_events');
});

test('async-payments: an unpaid session is not fulfilled until async_payment_succeeded', async () => {
  const orderId = uid('ord');
  const sessionId = uid('cs_test');
  await createOrder(orderId);
  setSession(sessionId, orderId, 'unpaid');
  const completed = await deliver(eventJson('checkout.session.completed', { id: sessionId, object: 'checkout.session', payment_status: 'unpaid', client_reference_id: orderId }));
  assert.ok(ok(completed), `checkout.session.completed for an unpaid session: expected 2xx, got ${completed.status}`);
  assert.deepEqual(await orderState(orderId), { status: 'pending', fulfilments: 0 }, 'An unpaid session (a bank debit still processing) must not fulfil the order');

  setSession(sessionId, orderId, 'paid');
  const succeeded = await deliver(eventJson('checkout.session.async_payment_succeeded', { id: sessionId, object: 'checkout.session', payment_status: 'paid', client_reference_id: orderId }));
  assert.ok(ok(succeeded), `checkout.session.async_payment_succeeded: expected 2xx, got ${succeeded.status}`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'After async_payment_succeeded the order should be paid and fulfilled once');
});

test('once-per-order: two different events for one paid session fulfil the order once', async () => {
  const { orderId, sessionId, event } = await paidScenario();
  assert.ok(ok(await deliver(event)), 'The first event was not accepted');
  const second = eventJson('checkout.session.async_payment_succeeded', { id: sessionId, object: 'checkout.session', payment_status: 'paid', client_reference_id: orderId });
  const res = await deliver(second);
  assert.ok(ok(res), `A second, different event for the same session: expected 2xx, got ${res.status}`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'Two events for one session fulfilled the order twice. Fulfil only on the pending -> paid transition.');
});

test('duplicate-events: the same event delivered three times is processed once', async () => {
  const { orderId, event } = await paidScenario();
  for (let i = 1; i <= 3; i++) {
    const res = await deliver(event); // a fresh signature each time, like a real retry
    assert.ok(ok(res), `Delivery ${i} of the same event: expected 2xx (a duplicate is still acknowledged), got ${res.status}`);
  }
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'Three deliveries of one event should give one fulfilment');
  assert.equal(await storedEvents(event.id), 1, 'stripe_events should hold the event id exactly once');
});

test('concurrent-duplicates: eight simultaneous copies of one event are processed once', async () => {
  const { orderId, event } = await paidScenario();
  const body = JSON.stringify(event);
  const results = await Promise.all(Array.from({ length: 8 }, () => deliver(body)));
  const statuses = results.map((r) => r.status);
  assert.ok(results.every(ok), `Every copy should be acknowledged with 2xx, got ${statuses.join(', ')}`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'Simultaneous copies fulfilled the order more than once');
  assert.equal(await storedEvents(event.id), 1, 'stripe_events should hold the event id exactly once');
});

test('subscription-sync: subscription events store the current subscription from Stripe', async () => {
  const subId = uid('sub');
  const created = setSubscription(subId, { status: 'trialing', price: 'price_basic', periodEnd: 1_830_000_000 });
  let res = await deliver(eventJson('customer.subscription.created', created));
  assert.ok(ok(res), `customer.subscription.created: expected 2xx, got ${res.status} ${res.text.slice(0, 200)}`);
  assert.deepEqual(
    await subscriptionRow(subId),
    { stripe_customer_id: 'cus_check', status: 'trialing', price_id: 'price_basic', period_end: 1_830_000_000, cancel_at_period_end: false },
    'After customer.subscription.created the row should match the subscription (price and period come from items.data[0])',
  );

  const updated = setSubscription(subId, { status: 'active', price: 'price_pro', periodEnd: 1_832_592_000, cancelAtPeriodEnd: true });
  res = await deliver(eventJson('customer.subscription.updated', updated));
  assert.ok(ok(res), `customer.subscription.updated: expected 2xx, got ${res.status}`);
  assert.deepEqual(
    await subscriptionRow(subId),
    { stripe_customer_id: 'cus_check', status: 'active', price_id: 'price_pro', period_end: 1_832_592_000, cancel_at_period_end: true },
    'After customer.subscription.updated the row should hold the new status, price, period end and cancel_at_period_end',
  );

  const deleted = setSubscription(subId, { status: 'canceled', price: 'price_pro', periodEnd: 1_832_592_000, cancelAtPeriodEnd: true });
  res = await deliver(eventJson('customer.subscription.deleted', deleted));
  assert.ok(ok(res), `customer.subscription.deleted: expected 2xx, got ${res.status}`);
  assert.equal((await subscriptionRow(subId))?.status, 'canceled', 'After customer.subscription.deleted the status should be canceled');
});

test('out-of-order: a late event does not roll a subscription back to an older state', async () => {
  const subId = uid('sub');
  const stale = { ...setSubscription(subId, { status: 'incomplete', price: 'price_pro' }) };
  const current = setSubscription(subId, { status: 'active', price: 'price_pro', periodEnd: 1_835_000_000 });

  let res = await deliver(eventJson('customer.subscription.updated', current));
  assert.ok(ok(res), `customer.subscription.updated: expected 2xx, got ${res.status}`);
  // The created event was generated first but arrives last, carrying the old snapshot. Its `created` is not older.
  res = await deliver(eventJson('customer.subscription.created', stale));
  assert.ok(ok(res), `A late customer.subscription.created: expected 2xx, got ${res.status}`);

  const row = await subscriptionRow(subId);
  assert.equal(row?.status, 'active', `A late created event (snapshot status incomplete) rolled the subscription back to "${row?.status}". Store the subscription's current state, not the event's snapshot.`);
  assert.equal(row?.period_end, 1_835_000_000, 'current_period_end should come from the current subscription');
});

test('unknown-events: an event type the handler does not use is acknowledged and changes nothing', async () => {
  const orderId = uid('ord');
  await createOrder(orderId);
  const res = await deliver(eventJson('invoice.created', { id: uid('in'), object: 'invoice', subscription: null }));
  assert.ok(ok(res), `invoice.created: expected 2xx so that Stripe stops retrying, got ${res.status}`);
  assert.deepEqual(await orderState(orderId), { status: 'pending', fulfilments: 0 }, 'An unrelated event changed an order');
});

test('failure-retry: when processing fails the response is 5xx, nothing is stored, and the retry succeeds', async () => {
  const { orderId, event } = await paidScenario();
  api.down = true;
  let failed;
  try {
    failed = await deliver(event);
  } finally {
    api.down = false;
  }
  assert.ok(failed.status >= 500, `With the Stripe API failing, expected a 5xx so that Stripe retries, got ${failed.status}`);
  assert.equal(await storedEvents(event.id), 0, 'The event id was stored although processing failed, so the retry would be skipped as a duplicate');
  assert.deepEqual(await orderState(orderId), { status: 'pending', fulfilments: 0 }, 'A failed attempt changed the order');

  const retry = await deliver(event);
  assert.ok(ok(retry), `The retry after the API recovered: expected 2xx, got ${retry.status} ${retry.text.slice(0, 200)}`);
  assert.deepEqual(await orderState(orderId), { status: 'paid', fulfilments: 1 }, 'The retry should fulfil the order once');
});
