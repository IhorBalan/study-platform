// Checks for "Structured request logging". Node built-ins only; express and pino come
// from the submission's node_modules. Node runs src/app.ts directly by stripping its types.
// The app writes to a destination supplied here, so every line can be inspected.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

/** Every chunk the app wrote, raw, and the lines that parsed. */
const raw = [];
const lines = [];
const state = { bootError: null, server: null, base: null };

const destination = {
  write(chunk) {
    const text = String(chunk);
    raw.push(text);
    for (const part of text.split('\n')) {
      if (part.trim() === '') continue;
      try {
        lines.push(JSON.parse(part));
      } catch {
        lines.push({ __unparsed: part });
      }
    }
    return true;
  },
};

before(async () => {
  try {
    const file = path.join(dir, 'src', 'app.ts');
    if (!existsSync(file)) throw new Error('src/app.ts is missing from the submission.');
    const mod = await import(pathToFileURL(file).href);
    if (typeof mod.createApp !== 'function') throw new Error('src/app.ts must export a function named createApp.');
    const app = mod.createApp({ destination });
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    state.server = server;
    state.base = `http://127.0.0.1:${server.address().port}`;
  } catch (error) {
    state.bootError = String(error?.stack ?? error).slice(0, 1500);
  }
});

after(() => {
  state.server?.closeAllConnections?.();
  state.server?.close();
});

async function send(pathname, { method = 'GET', headers = {}, body } = {}) {
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  const res = await fetch(state.base + pathname, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  await res.text();
  // The summary line is written when the response finishes; give it a moment.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return res;
}

let counter = 0;
const freshId = (label) => `chk-${label}-${process.pid}-${++counter}`;
const linesFor = (reqId) => lines.filter((line) => line.reqId === reqId);
const summaryFor = (reqId) => linesFor(reqId).filter((line) => line.msg === 'request completed');
const show = (value) => JSON.stringify(value)?.slice(0, 400);

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc -p tsconfig.json failed:\n${output.slice(0, 3000)}`);
});

test('json-lines: every line written is one JSON object with level, time and msg', async () => {
  await send('/health');
  await send('/orders/5');
  await send('/boom');
  assert.ok(lines.length > 0, 'Nothing was written to the destination passed to createApp(). Write the logs there.');
  for (const line of lines) {
    assert.ok(!line.__unparsed, `Every line must be JSON. This one is not: ${String(line.__unparsed).slice(0, 200)}`);
    assert.equal(typeof line.level, 'number', `Every line needs a numeric level (pino's default). Found: ${show(line)}`);
    assert.equal(typeof line.time, 'number', `Every line needs a numeric time. Found: ${show(line)}`);
    assert.equal(typeof line.msg, 'string', `Every line needs a msg. Found: ${show(line)}`);
  }
  for (const chunk of raw) {
    assert.ok(chunk.endsWith('\n'), 'Each line must end with a newline, so a log shipper can split the stream.');
  }
});

test('request-line: one "request completed" line per request with method, route, statusCode and durationMs', async () => {
  const cases = [
    ['/orders/42', 'GET', '/orders/:id', 200],
    ['/health', 'GET', '/health', 200],
    [`/missing/${Date.now()}/path`, 'GET', 'unmatched', 404],
    ['/signup', 'POST', '/signup', 201],
  ];
  for (const [pathname, method, route, statusCode] of cases) {
    const reqId = freshId('line');
    await send(pathname, {
      method,
      headers: { 'x-request-id': reqId },
      body: method === 'POST' ? { email: 'line@example.com', password: 'pw-line-check' } : undefined,
    });
    const summaries = summaryFor(reqId);
    assert.equal(
      summaries.length,
      1,
      `${method} ${pathname}: expected exactly one line with msg "request completed" and reqId "${reqId}", found ${summaries.length}`,
    );
    const [line] = summaries;
    assert.equal(line.method, method, `${method} ${pathname}: expected method "${method}", got ${show(line.method)}`);
    assert.equal(line.route, route, `${method} ${pathname}: expected route "${route}" (the template, not the raw path), got ${show(line.route)}`);
    assert.equal(line.statusCode, statusCode, `${method} ${pathname}: expected statusCode ${statusCode} (a number), got ${show(line.statusCode)}`);
    assert.ok(
      typeof line.durationMs === 'number' && Number.isFinite(line.durationMs) && line.durationMs >= 0,
      `${method} ${pathname}: expected durationMs as a non-negative number, got ${show(line.durationMs)}`,
    );
  }
  const slow = freshId('slow');
  await send('/orders/9', { headers: { 'x-request-id': slow } });
  const [line] = summaryFor(slow);
  assert.ok(line.durationMs >= 10, `GET /orders/9 waits at least 15 ms, but durationMs was ${line.durationMs}. Measure from when the request arrives until the response finishes, in milliseconds.`);
});

test('level-by-status: 2xx is info, 4xx is warn, 5xx is error', async () => {
  const cases = [
    ['/orders/1', 30, 'info (30)'],
    ['/orders/not-a-number', 40, 'warn (40)'],
    ['/boom', 50, 'error (50)'],
  ];
  for (const [pathname, level, name] of cases) {
    const reqId = freshId('level');
    const res = await send(pathname, { headers: { 'x-request-id': reqId } });
    const [line] = summaryFor(reqId);
    assert.ok(line, `GET ${pathname}: no "request completed" line with reqId "${reqId}" was found`);
    assert.equal(line.level, level, `GET ${pathname} answered ${res.status}: expected the summary line at ${name}, got level ${line.level}`);
  }
});

test('request-id: a safe x-request-id is reused, a missing or unsafe one is replaced, and it is sent back', async () => {
  const safe = freshId('safe');
  const reused = await send('/health', { headers: { 'x-request-id': safe } });
  assert.equal(reused.headers.get('x-request-id'), safe, `A safe incoming x-request-id ("${safe}") must be sent back unchanged in the x-request-id response header.`);

  const generated = new Set();
  for (let i = 0; i < 3; i++) {
    const res = await send('/health');
    const id = res.headers.get('x-request-id');
    assert.ok(id && id.length >= 8 && id.length <= 64, `Without an incoming id, the response needs a generated x-request-id of 8 to 64 characters, got ${show(id)}`);
    assert.equal(summaryFor(id).length, 1, `The generated id ${id} must also be the reqId of that request's log line.`);
    generated.add(id);
  }
  assert.equal(generated.size, 3, 'Each request without an incoming id needs a new id, but ids repeated.');

  const unsafe = ['x'.repeat(300), 'has spaces in it', '{"level":60}', 'semi;colon<script>'];
  for (const value of unsafe) {
    const res = await send('/health', { headers: { 'x-request-id': value } });
    const id = res.headers.get('x-request-id');
    assert.ok(id && id !== value, `An unsafe incoming id (${show(value.slice(0, 40))}) must be replaced with a fresh one, but it was reused.`);
    assert.ok(!lines.some((line) => line.reqId === value), `The unsafe id ${show(value.slice(0, 40))} still reached the log as a reqId.`);
  }
});

test('correlated: every line written during a request carries that request\'s id, even under concurrency', async () => {
  const ids = Array.from({ length: 20 }, () => freshId('conc'));
  const before = lines.length;
  await Promise.all(ids.map((reqId, i) => send(`/orders/${100 + i}`, { headers: { 'x-request-id': reqId } })));
  await new Promise((resolve) => setTimeout(resolve, 50));
  const written = lines.slice(before);
  const orderLines = written.filter((line) => line.msg !== 'request completed');
  assert.ok(orderLines.length >= 40, `Expected the "loading order" and "order loaded" lines of 20 requests, found ${orderLines.length} other lines.`);
  for (const [i, reqId] of ids.entries()) {
    const own = linesFor(reqId);
    const messages = own.map((line) => line.msg).sort();
    assert.deepEqual(
      messages,
      ['loading order', 'order loaded', 'request completed'],
      `Request ${reqId} (GET /orders/${100 + i}): expected its "loading order", "order loaded" and "request completed" lines to carry reqId "${reqId}", found ${show(messages)}`,
    );
    for (const line of own) {
      if (line.orderId !== undefined) {
        assert.equal(String(line.orderId), String(100 + i), `A line for order ${line.orderId} carries the id of the request for order ${100 + i}. Ids leak between concurrent requests.`);
      }
    }
  }
  const signup = freshId('signup');
  await send('/signup', { method: 'POST', headers: { 'x-request-id': signup }, body: { email: 'c@example.com', password: 'pw-correlate' } });
  assert.ok(linesFor(signup).some((line) => line.msg === 'user signed up'), 'The "user signed up" line must carry the request id too.');
});

test('redacts-secrets: passwords, Authorization headers and cookies never reach the log', async () => {
  const password = `pw-${process.pid}-Zebra!42`;
  const token = `tok-${process.pid}-abcdef123456`;
  const cookie = `sid-${process.pid}-cookievalue`;
  const signup = freshId('secret');
  const res = await send('/signup', {
    method: 'POST',
    headers: { 'x-request-id': signup, authorization: `Bearer ${token}`, cookie: `sid=${cookie}` },
    body: { email: 'secret@example.com', password },
  });
  assert.equal(res.status, 201, `POST /signup with a valid body: expected 201, got ${res.status}`);
  const boom = freshId('secret-boom');
  await send('/boom', { headers: { 'x-request-id': boom, authorization: `Bearer ${token}`, cookie: `sid=${cookie}` } });

  assert.ok(linesFor(signup).some((line) => line.msg === 'user signed up'), 'Keep the "user signed up" line. Remove the secret from it, not the line.');
  const errorLine = linesFor(boom).find((line) => line.msg === 'unhandled error');
  assert.ok(errorLine, 'Keep the "unhandled error" line for GET /boom.');
  assert.ok(JSON.stringify(errorLine).includes('boom'), `The "unhandled error" line must still contain the error's message ("boom"), found: ${show(errorLine)}`);

  const everything = raw.join('');
  for (const [what, secret] of [['the password', password], ['the bearer token', token], ['the cookie value', cookie]]) {
    assert.ok(!everything.includes(secret), `${what} sent with the request appeared in the log output.`);
  }
});
