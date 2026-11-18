// Checks for "Send the order confirmation once". Node built-ins only; pg and nodemailer come from the submission.
// Messages are read back from Mailpit's API, filtered by recipients that contain CHECK_RUN_ID, and deleted afterwards.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const SCHEMA = 'm10_mail_chk';
const RUN = (process.env.CHECK_RUN_ID ?? `local${Date.now().toString(36)}`).toLowerCase().replace(/[^a-z0-9-]/g, '');
const MAILPIT = (process.env.MAILPIT_URL ?? '').replace(/\/$/, '');
const state = { compileOutput: null, setupError: null, admin: null, pool: null, mod: null, mailer: null, nodemailer: null, transports: [] };

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

before(async () => {
  state.compileOutput = compile();
  const missingEnv = ['DATABASE_URL', 'SMTP_HOST', 'SMTP_PORT', 'MAILPIT_URL'].filter((name) => !process.env[name]);
  if (missingEnv.length) {
    state.setupError = `${missingEnv.join(', ')} not set. Start the services with \`pnpm lab up postgres\` and \`pnpm lab up mailpit\`.`;
    return;
  }
  try {
    const pgModule = await importFromSubmission('pg');
    const pg = pgModule.default ?? pgModule;
    state.admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await state.admin.connect();
    await state.admin.query(`drop schema if exists ${SCHEMA} cascade; create schema ${SCHEMA}; set search_path to ${SCHEMA}`);
    const schemaFile = path.join(dir, 'db', 'schema.sql');
    if (!existsSync(schemaFile)) throw new Error('db/schema.sql was not found.');
    await state.admin.query(readFileSync(schemaFile, 'utf8'));
    state.pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, options: `-c search_path=${SCHEMA}` });
    state.pool.on('error', () => {});
  } catch (error) {
    state.setupError = `Database setup failed: ${error.message}`;
    return;
  }
  try {
    const res = await fetch(`${MAILPIT}/api/v1/info`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
  } catch (error) {
    state.setupError = `Mailpit is not reachable at ${MAILPIT}: ${error.message}`;
    return;
  }
  if (state.compileOutput) return;
  try {
    for (const file of ['order-email.js', 'mailer.js']) {
      if (!existsSync(path.join(dir, 'dist', file))) throw new Error(`dist/${file} was not produced. Keep src/${file.replace('.js', '.ts')} and outDir "dist".`);
    }
    state.mod = await import(pathToFileURL(path.join(dir, 'dist', 'order-email.js')).href);
    state.mailer = await import(pathToFileURL(path.join(dir, 'dist', 'mailer.js')).href);
    for (const name of ['sendOrderConfirmation', 'renderOrderConfirmation']) {
      if (typeof state.mod[name] !== 'function') throw new Error(`src/order-email.ts must export ${name}.`);
    }
    if (typeof state.mailer.createSmtpTransport !== 'function') throw new Error('src/mailer.ts must export createSmtpTransport.');
    const nm = await importFromSubmission('nodemailer');
    state.nodemailer = nm.default ?? nm;
  } catch (error) {
    state.setupError = String(error?.message ?? error);
  }
});

after(async () => {
  for (const t of state.transports) t.close?.();
  if (MAILPIT && RUN) {
    const q = encodeURIComponent(`to:${RUN}`);
    await fetch(`${MAILPIT}/api/v1/search?query=${q}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {});
  }
  await state.pool?.end().catch(() => {});
  await state.admin?.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
  await state.admin?.end().catch(() => {});
});

function ready() {
  assert.ok(!state.compileOutput, 'The project did not compile. Fix the "compiles" criterion first.');
  assert.ok(!state.setupError, state.setupError);
}

// ---- helpers -------------------------------------------------------------------------------------

let seq = 0;
const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${(++seq).toString(36)}`;
const recipient = (label) => `buyer-${RUN}-${label}@example.test`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function smtp() {
  const t = state.mailer.createSmtpTransport();
  state.transports.push(t);
  return t;
}

/** A transport aimed at a port where nothing listens, like an SMTP server that is down. */
async function deadTransport() {
  const port = await new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
  const t = state.nodemailer.createTransport({ host: '127.0.0.1', port, secure: false, connectionTimeout: 2000, greetingTimeout: 2000, socketTimeout: 2000 });
  state.transports.push(t);
  return t;
}

function makeOrder(label, overrides = {}) {
  return {
    orderId: uid('ord'),
    to: recipient(label),
    customerName: 'Grace Hopper',
    currency: 'eur',
    items: [
      { name: 'Mug', quantity: 2, unitAmountMinor: 1250 },
      { name: 'Sticker pack', quantity: 3, unitAmountMinor: 199 },
    ],
    ...overrides,
  };
}

async function search(to) {
  const q = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${q}`, { signal: AbortSignal.timeout(5000) });
  assert.ok(res.ok, `Mailpit search failed with status ${res.status}`);
  return (await res.json()).messages ?? [];
}

/** Waits until at least one message to `to` arrived, then a little longer so that any duplicates arrive too. */
async function messagesTo(to, { settleMs = 400, timeoutMs = 4000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let found = await search(to);
  while (found.length === 0 && Date.now() < deadline) {
    await sleep(100);
    found = await search(to);
  }
  if (found.length) {
    await sleep(settleMs);
    found = await search(to);
  }
  return found;
}

async function fullMessage(id) {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`, { signal: AbortSignal.timeout(5000) });
  assert.ok(res.ok, `Mailpit could not return message ${id}: status ${res.status}`);
  return res.json();
}

const decodeEntities = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&euro;/g, '€')
    .replace(/&yen;/g, '¥')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function money(amountMinor, currency) {
  const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() });
  return fmt.format(amountMinor / 10 ** fmt.resolvedOptions().maximumFractionDigits);
}

// ---- criteria ------------------------------------------------------------------------------------

test('compiles: the project compiles with tsc', () => {
  assert.ok(!state.compileOutput, `tsc -p tsconfig.json failed:\n${state.compileOutput}`);
});

test('sends-over-smtp: the confirmation reaches Mailpit with the right sender, recipient and subject', async () => {
  ready();
  const order = makeOrder('basic');
  const result = await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
  assert.equal(result, 'sent', `sendOrderConfirmation should resolve "sent" for a new order, got ${JSON.stringify(result)}`);
  const found = await messagesTo(order.to);
  assert.equal(found.length, 1, `Expected one message to ${order.to} in Mailpit, found ${found.length}. Send through createSmtpTransport() (SMTP_HOST, SMTP_PORT).`);
  const msg = await fullMessage(found[0].ID);
  assert.equal(msg.From?.Address, 'orders@shop.example', `Expected the sender orders@shop.example, got ${JSON.stringify(msg.From)}`);
  assert.equal(msg.From?.Name, 'Shop', `Expected the sender name "Shop", got ${JSON.stringify(msg.From?.Name)}`);
  assert.deepEqual(msg.To?.map((t) => t.Address), [order.to], `Expected exactly one recipient, ${order.to}`);
  assert.equal(msg.Subject, `Order ${order.orderId} confirmed`, `Unexpected subject: ${JSON.stringify(msg.Subject)}`);
  assert.equal(msg.MessageID, `order-confirmation-${order.orderId}@shop.example`, `Expected the Message-ID <order-confirmation-${order.orderId}@shop.example>, got ${JSON.stringify(msg.MessageID)}`);
});

test('content: text and HTML parts list the items and the total formatted from minor units', async () => {
  ready();
  const eur = makeOrder('content-eur');
  const jpy = makeOrder('content-jpy', { currency: 'JPY', items: [{ name: 'Tea set', quantity: 1, unitAmountMinor: 4800 }, { name: 'Cup', quantity: 2, unitAmountMinor: 650 }] });
  for (const order of [eur, jpy]) {
    await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
    const [summary] = await messagesTo(order.to);
    assert.ok(summary, `No message to ${order.to} arrived in Mailpit`);
    const msg = await fullMessage(summary.ID);
    const totalMinor = order.items.reduce((s, i) => s + i.quantity * i.unitAmountMinor, 0);
    const total = money(totalMinor, order.currency);
    assert.ok(msg.Text?.trim(), 'The message has no plain-text part. Send both text and html.');
    assert.ok(msg.HTML?.trim(), 'The message has no HTML part. Send both text and html.');
    assert.ok(msg.Text.includes(`Total: ${total}`), `The text part should contain "Total: ${total}" (${order.currency}), got:\n${msg.Text.slice(0, 400)}`);
    assert.ok(decodeEntities(msg.HTML).includes(total), `The HTML part should show the total ${total}, got:\n${msg.HTML.slice(0, 400)}`);
    for (const item of order.items) {
      assert.ok(msg.Text.includes(item.name), `The text part should list "${item.name}"`);
      assert.ok(decodeEntities(msg.HTML).includes(item.name), `The HTML part should list "${item.name}"`);
    }
  }
});

test('escapes-html: the customer name is escaped in HTML and kept as typed in the text part', async () => {
  ready();
  const name = 'Eve <img src=x onerror=alert(1)> & "Co"';
  const order = makeOrder('escape', { customerName: name });
  await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
  const [summary] = await messagesTo(order.to);
  assert.ok(summary, `No message to ${order.to} arrived in Mailpit`);
  const msg = await fullMessage(summary.ID);
  assert.ok(!msg.HTML.includes('<img src=x'), 'The HTML part contains the customer name as raw markup. Escape user data in templates.');
  assert.ok(msg.HTML.includes('&lt;img src=x onerror=alert(1)&gt; &amp;'), `Expected the escaped name (&lt;img ... &gt; &amp;) in the HTML part, got:\n${msg.HTML.slice(0, 400)}`);
  assert.ok(msg.Text.includes(name), 'The text part should contain the customer name exactly as given');
});

test('once-per-order: a second call for the same order sends nothing and resolves "skipped"', async () => {
  ready();
  const order = makeOrder('twice');
  const first = await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
  const second = await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
  assert.deepEqual([first, second], ['sent', 'skipped'], `Expected "sent" then "skipped", got ${JSON.stringify([first, second])}`);
  const found = await messagesTo(order.to, { settleMs: 600 });
  assert.equal(found.length, 1, `Two calls for one order delivered ${found.length} messages`);
});

test('concurrent-sends: six simultaneous calls for one order deliver one message', async () => {
  ready();
  const order = makeOrder('race');
  const results = await Promise.all(Array.from({ length: 6 }, () => state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order)));
  assert.equal(results.filter((r) => r === 'sent').length, 1, `Exactly one call should resolve "sent", got ${JSON.stringify(results)}`);
  const found = await messagesTo(order.to, { settleMs: 800 });
  assert.equal(found.length, 1, `Six simultaneous calls delivered ${found.length} messages`);
});

test('retry-after-failure: a failed send rejects, and a later call for the order sends it', async () => {
  ready();
  const order = makeOrder('retry');
  await assert.rejects(
    state.mod.sendOrderConfirmation({ pool: state.pool, transport: await deadTransport() }, order),
    'With the SMTP server unreachable, sendOrderConfirmation should reject so the job can retry',
  );
  const retry = await state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, order);
  assert.equal(retry, 'sent', `After a failed attempt, the retry should send and resolve "sent", got ${JSON.stringify(retry)}. A failed send must not leave the order marked as sent.`);
  const found = await messagesTo(order.to);
  assert.equal(found.length, 1, `Expected one message after the retry, found ${found.length}`);
});

test('orders-independent: different orders to the same customer each get their own email', async () => {
  ready();
  const to = recipient('many');
  const a = makeOrder('many', { to });
  const b = makeOrder('many', { to });
  const results = await Promise.all([a, b].map((o) => state.mod.sendOrderConfirmation({ pool: state.pool, transport: smtp() }, o)));
  assert.deepEqual(results, ['sent', 'sent'], `Two different orders should both be sent, got ${JSON.stringify(results)}`);
  const found = await messagesTo(to, { settleMs: 600 });
  assert.deepEqual(
    found.map((m) => m.Subject).sort(),
    [`Order ${a.orderId} confirmed`, `Order ${b.orderId} confirmed`].sort(),
    'Expected one email per order',
  );
});
