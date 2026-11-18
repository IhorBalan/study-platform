// Checks for "Reconcile payments against Stripe". Node built-ins only; pg comes from the submission.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SCHEMA = 'm10_rec_chk';
const WINDOW = { from: new Date('2026-11-01T00:00:00Z'), to: new Date('2026-11-02T00:00:00Z') };
const state = { compileOutput: null, setupError: null, pg: null, admin: null, pool: null, mod: null, schemaSql: null };

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
    const schemaFile = path.join(dir, 'db', 'schema.sql');
    if (!existsSync(schemaFile)) throw new Error('db/schema.sql was not found.');
    state.schemaSql = readFileSync(schemaFile, 'utf8');
    await state.admin.query(state.schemaSql);
  } catch (error) {
    state.setupError = `Database setup failed: ${error.message}`;
    return;
  }
  state.pool = new state.pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3, options: `-c search_path=${SCHEMA}` });
  state.pool.on('error', () => {});
  if (state.compileOutput) return;
  try {
    const entry = path.join(dir, 'dist', 'reconcile.js');
    if (!existsSync(entry)) throw new Error('dist/reconcile.js was not produced. Keep src/reconcile.ts and outDir "dist".');
    state.mod = await import(pathToFileURL(entry).href);
    if (typeof state.mod.reconcile !== 'function') throw new Error('src/reconcile.ts must export a function named reconcile.');
  } catch (error) {
    state.setupError = String(error?.message ?? error);
  }
});

after(async () => {
  await state.pool?.end().catch(() => {});
  await state.admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
  await state.admin?.end().catch(() => {});
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
}

// ---- fixtures ------------------------------------------------------------------------------------

let chargeSeq = 0;
function charge(pi, amount, currency, status = 'succeeded', refunded = 0) {
  chargeSeq += 1;
  return {
    id: `ch_chk_${String(chargeSeq).padStart(3, '0')}`,
    object: 'charge',
    payment_intent: pi,
    amount,
    amount_refunded: refunded,
    currency,
    status,
    created: 1793530000 + chargeSeq,
    refunded: refunded > 0 && refunded >= amount,
  };
}

/** Empties the table and inserts payments. Returns the new ids in order. */
async function seed(payments) {
  await state.admin.query('truncate payments restart identity');
  const ids = [];
  for (const [i, p] of payments.entries()) {
    const { rows } = await state.admin.query(
      `insert into payments (order_id, stripe_payment_intent_id, amount_minor, currency, status, refunded_minor, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [`ord_${i + 1}`, p.pi, p.amount, p.currency, p.status, p.refunded ?? 0, p.createdAt ?? '2026-11-01T12:00:00Z'],
    );
    ids.push(rows[0].id);
  }
  return ids;
}

async function run(charges, window = WINDOW) {
  ready();
  const report = await state.mod.reconcile(state.pool, charges, window);
  assert.ok(report && typeof report === 'object', `reconcile() should resolve a report object, got ${JSON.stringify(report)}`);
  for (const key of ['missing', 'mismatched', 'orphaned']) {
    assert.ok(Array.isArray(report[key]), `report.${key} should be an array, got ${JSON.stringify(report[key])}`);
  }
  return report;
}

const show = (value) => JSON.stringify(value);
const sortBy = (list, key) => [...list].sort((a, b) => String(a[key]).localeCompare(String(b[key]), 'en', { numeric: true }));

// ---- criteria ------------------------------------------------------------------------------------

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('matches-clean: payments that agree with Stripe are counted as matched and nothing else is reported', async () => {
  ready();
  const charges = [
    charge('pi_a', 4900, 'eur'),
    charge('pi_b', 12000, 'eur', 'succeeded', 2000),
    charge('pi_c', 2500, 'eur', 'succeeded', 2500),
  ];
  await seed([
    { pi: 'pi_a', amount: 4900, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_b', amount: 12000, currency: 'EUR', status: 'partially_refunded', refunded: 2000 },
    { pi: 'pi_c', amount: 2500, currency: 'EUR', status: 'refunded', refunded: 2500 },
  ]);
  const report = await run(charges);
  assert.equal(report.matched, 3, `Expected 3 matched payments, got ${show(report.matched)}`);
  assert.deepEqual(
    { missing: report.missing, mismatched: report.mismatched, orphaned: report.orphaned },
    { missing: [], mismatched: [], orphaned: [] },
    'A day where everything agrees (including a partial and a full refund) should report no differences',
  );
});

test('missing: succeeded charges without a local payment are reported as missing', async () => {
  ready();
  const lost = charge('pi_lost', 3000, 'eur');
  const lostToo = charge('pi_lost_2', 800, 'usd');
  await seed([{ pi: 'pi_ok', amount: 1000, currency: 'EUR', status: 'succeeded' }]);
  const report = await run([charge('pi_ok', 1000, 'eur'), lost, lostToo]);
  assert.deepEqual(
    sortBy(report.missing, 'chargeId').map(({ chargeId, paymentIntentId, amountMinor, currency }) => ({ chargeId, paymentIntentId, amountMinor, currency })),
    [
      { chargeId: lost.id, paymentIntentId: 'pi_lost', amountMinor: 3000, currency: 'eur' },
      { chargeId: lostToo.id, paymentIntentId: 'pi_lost_2', amountMinor: 800, currency: 'usd' },
    ],
    `Expected the two charges with no local payment in report.missing, got ${show(report.missing)}`,
  );
  assert.equal(report.matched, 1, `Expected 1 matched payment, got ${report.matched}`);
});

test('mismatched: amount, currency, status and refund differences are reported per field', async () => {
  ready();
  const cAmount = charge('pi_amount', 5000, 'eur');
  const cCurrency = charge('pi_currency', 5000, 'usd');
  const cStatus = charge('pi_status', 5000, 'eur');
  const cRefund = charge('pi_refund', 5000, 'eur', 'succeeded', 1500);
  const [pAmount, pCurrency, pStatus, pRefund] = await seed([
    { pi: 'pi_amount', amount: 4500, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_currency', amount: 5000, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_status', amount: 5000, currency: 'EUR', status: 'pending' },
    { pi: 'pi_refund', amount: 5000, currency: 'EUR', status: 'succeeded' }, // refunded in the Dashboard
  ]);
  const report = await run([cAmount, cCurrency, cStatus, cRefund]);
  const got = sortBy(report.mismatched, 'paymentId').map((m) => ({
    paymentId: Number(m.paymentId),
    paymentIntentId: m.paymentIntentId,
    chargeId: m.chargeId,
    fields: [...(m.fields ?? [])].sort(),
  }));
  assert.deepEqual(
    got,
    [
      { paymentId: pAmount, paymentIntentId: 'pi_amount', chargeId: cAmount.id, fields: ['amount'] },
      { paymentId: pCurrency, paymentIntentId: 'pi_currency', chargeId: cCurrency.id, fields: ['currency'] },
      { paymentId: pStatus, paymentIntentId: 'pi_status', chargeId: cStatus.id, fields: ['status'] },
      { paymentId: pRefund, paymentIntentId: 'pi_refund', chargeId: cRefund.id, fields: ['refunded', 'status'] },
    ],
    `Unexpected report.mismatched: ${show(report.mismatched)}`,
  );
  assert.equal(report.matched, 0, `None of these payments agree with Stripe, but matched is ${report.matched}`);
});

test('currency-case: EUR in the table and eur at Stripe are the same currency', async () => {
  ready();
  await seed([
    { pi: 'pi_upper', amount: 2000, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_lower', amount: 2000, currency: 'eur', status: 'succeeded' },
  ]);
  const report = await run([charge('pi_upper', 2000, 'eur'), charge('pi_lower', 2000, 'eur')]);
  assert.equal(report.matched, 2, `Expected both payments to match, got matched=${report.matched} and mismatched=${show(report.mismatched)}`);
});

test('orphaned: local payments that claim money without a succeeded charge are orphaned', async () => {
  ready();
  const [ghost, handMade, , , refundedGhost] = await seed([
    { pi: 'pi_ghost', amount: 700, currency: 'EUR', status: 'succeeded' },
    { pi: null, amount: 900, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_pending', amount: 900, currency: 'EUR', status: 'pending' },
    { pi: 'pi_failed', amount: 900, currency: 'EUR', status: 'failed' },
    { pi: 'pi_declined', amount: 1200, currency: 'EUR', status: 'refunded', refunded: 1200 },
  ]);
  // pi_declined only has a failed charge at Stripe: no money ever moved for it.
  const report = await run([charge('pi_declined', 1200, 'eur', 'failed')]);
  assert.deepEqual(
    sortBy(report.orphaned, 'paymentId').map((o) => ({ paymentId: Number(o.paymentId), paymentIntentId: o.paymentIntentId ?? null })),
    [
      { paymentId: ghost, paymentIntentId: 'pi_ghost' },
      { paymentId: handMade, paymentIntentId: null },
      { paymentId: refundedGhost, paymentIntentId: 'pi_declined' },
    ],
    `Expected the three payments that claim money Stripe never received, got ${show(report.orphaned)}. Pending and failed payments claim no money.`,
  );
});

test('ignores-failed-charges: failed attempts are neither missing nor compared', async () => {
  ready();
  const failedFirst = charge('pi_retry', 990, 'usd', 'failed');
  const thenSucceeded = charge('pi_retry', 990, 'usd', 'succeeded');
  const neverPaid = charge('pi_never', 1500, 'eur', 'failed');
  await seed([
    { pi: 'pi_retry', amount: 990, currency: 'USD', status: 'succeeded' },
    { pi: 'pi_never', amount: 1500, currency: 'EUR', status: 'failed' },
  ]);
  const report = await run([failedFirst, thenSucceeded, neverPaid, charge('pi_nobody', 400, 'eur', 'failed')]);
  assert.equal(report.matched, 1, `The succeeded retry should match its payment, got matched=${report.matched}`);
  assert.deepEqual(
    { missing: report.missing, mismatched: report.mismatched, orphaned: report.orphaned },
    { missing: [], mismatched: [], orphaned: [] },
    'Failed charges moved no money, so they must not be reported as missing or compared with payments',
  );
});

test('totals: net totals per currency are integers in minor units', async () => {
  ready();
  await seed([
    { pi: 'pi_t1', amount: 1999, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_t2', amount: 1999, currency: 'EUR', status: 'partially_refunded', refunded: 999 },
    { pi: 'pi_t3', amount: 4500, currency: 'JPY', status: 'succeeded' },
    { pi: 'pi_t4', amount: 1000, currency: 'EUR', status: 'pending' },
    { pi: 'pi_t5', amount: 350, currency: 'EUR', status: 'succeeded' },
  ]);
  const report = await run([
    charge('pi_t1', 1999, 'eur'),
    charge('pi_t2', 1999, 'eur', 'succeeded', 999),
    charge('pi_t3', 4500, 'jpy'),
    charge('pi_t4', 1000, 'eur'),
    charge('pi_t6', 80, 'usd'),
  ]);
  assert.deepEqual(
    report.totals,
    {
      eur: { stripeNetMinor: 1999 + 1000 + 1000, localNetMinor: 1999 + 1000 + 350 },
      jpy: { stripeNetMinor: 4500, localNetMinor: 4500 },
      usd: { stripeNetMinor: 80, localNetMinor: 0 },
    },
    `Unexpected report.totals: ${show(report.totals)}. Totals are numbers (not strings) per lower-case currency, net of refunds; local totals count only payments that claim money.`,
  );
});

test('async-charges: charges can be an async iterable that pages through the API', async () => {
  ready();
  await seed([
    { pi: 'pi_p1', amount: 100, currency: 'EUR', status: 'succeeded' },
    { pi: 'pi_p2', amount: 200, currency: 'EUR', status: 'succeeded' },
  ]);
  const page1 = [charge('pi_p1', 100, 'eur')];
  const page2 = [charge('pi_p2', 200, 'eur'), charge('pi_p3', 300, 'eur')];
  let consumed = 0;
  async function* listCharges() {
    for (const page of [page1, page2]) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      for (const c of page) {
        consumed += 1;
        yield c;
      }
    }
  }
  const report = await run(listCharges());
  assert.equal(consumed, 3, `Expected all 3 charges to be read from the async iterable, ${consumed} were`);
  assert.equal(report.matched, 2, `Expected 2 matched payments, got ${report.matched}`);
  assert.deepEqual(report.missing.map((m) => m.paymentIntentId), ['pi_p3'], `Expected pi_p3 to be missing, got ${show(report.missing)}`);
});

test('expanded-intent: a charge whose payment_intent is an expanded object still matches', async () => {
  ready();
  await seed([{ pi: 'pi_obj', amount: 1234, currency: 'EUR', status: 'succeeded' }]);
  const c = charge('pi_obj', 1234, 'eur');
  c.payment_intent = { id: 'pi_obj', object: 'payment_intent', amount: 1234, currency: 'eur', status: 'succeeded' };
  const report = await run([c]);
  assert.equal(report.matched, 1, `A charge listed with expand: ['data.payment_intent'] should match by payment_intent.id, got ${show(report)}`);
});

test('window: payments outside the window are not orphaned, but a charge still finds its payment', async () => {
  ready();
  const [, early] = await seed([
    { pi: 'pi_yesterday', amount: 500, currency: 'EUR', status: 'succeeded', createdAt: '2026-10-31T09:00:00Z' },
    { pi: 'pi_edge', amount: 700, currency: 'EUR', status: 'succeeded', createdAt: '2026-10-31T23:59:58Z' },
    { pi: 'pi_tomorrow', amount: 900, currency: 'EUR', status: 'succeeded', createdAt: '2026-11-02T00:00:00Z' },
  ]);
  // pi_edge was stamped two seconds before the window locally, but its charge is inside it.
  const report = await run([charge('pi_edge', 700, 'eur')]);
  assert.deepEqual(report.orphaned, [], `Payments created outside the window must not be reported as orphaned, got ${show(report.orphaned)}`);
  assert.deepEqual(report.missing, [], `The charge for pi_edge should find payment ${early} even though it was created just before the window, got missing=${show(report.missing)}`);
  assert.equal(report.matched, 1, `Expected pi_edge to match, got matched=${report.matched}`);
});
