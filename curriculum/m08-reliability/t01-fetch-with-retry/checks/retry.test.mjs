// Checks for "fetchWithRetry". Node built-ins only. The submission's retry.ts runs through Node's type stripping.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { mod: null, error: null, servers: [] };

before(async () => {
  const entry = path.join(dir, 'retry.ts');
  try {
    if (!existsSync(entry)) throw new Error('retry.ts was not found in the submission root.');
    state.mod = await import(pathToFileURL(entry).href);
    for (const name of ['fetchWithRetry', 'backoffDelay']) {
      if (typeof state.mod[name] !== 'function') throw new Error(`retry.ts must export a function named ${name}.`);
    }
  } catch (error) {
    state.error = `Could not load retry.ts: ${error?.message ?? error}`;
  }
});

after(async () => {
  await Promise.all(state.servers.map((s) => s.close()));
});

function ready() {
  assert.ok(!state.error, state.error);
  return state.mod;
}

/**
 * A scripted server: request n gets script[n] (the last step repeats).
 * A step is a status, 'hang', 'reset' or { status, headers }. Records each request's method, headers and body.
 */
async function serve(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const step = script[Math.min(requests.length, script.length - 1)];
    const record = { method: req.method, headers: req.headers, body: '', at: Date.now() };
    requests.push(record);
    req.setEncoding('utf8');
    req.on('data', (chunk) => (record.body += chunk));
    req.on('end', () => {
      if (step === 'hang') return;
      if (step === 'reset') return void req.socket.destroy();
      const { status, headers = {} } = typeof step === 'number' ? { status: step } : step;
      res.writeHead(status, { 'content-type': 'text/plain', ...headers });
      res.end(`body for ${status}`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const handle = {
    url: `http://127.0.0.1:${server.address().port}/thing`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  state.servers.push(handle);
  return handle;
}

const fast = { baseDelayMs: 5, maxDelayMs: 20 };

/** Fails instead of hanging when a call never settles. */
function within(promise, ms, what) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms.`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

test('passes-through: a successful response comes back unchanged after one request', async () => {
  const { fetchWithRetry } = ready();
  const s = await serve([{ status: 200, headers: { 'x-check': 'yes' } }]);
  const res = await within(fetchWithRetry(s.url), 3000, 'fetchWithRetry against a healthy server');
  assert.equal(res?.status, 200, 'Expected the 200 response to be returned.');
  assert.equal(res.headers.get('x-check'), 'yes', 'The response should be the one the server sent, headers included.');
  assert.equal(await res.text(), 'body for 200', 'The response body should still be readable by the caller.');
  assert.equal(s.requests.length, 1, `A healthy server should get exactly one request, it got ${s.requests.length}.`);
});

test('retries-transient: 5xx answers and dropped connections are retried until one succeeds', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve([503, 502, 200]);
  const res = await within(fetchWithRetry(a.url, {}, fast), 3000, 'fetchWithRetry against 503, 502, 200');
  assert.equal(res.status, 200, `After 503 and 502 the third attempt returns 200, but the call returned ${res.status}.`);
  assert.equal(a.requests.length, 3, `Expected 3 requests (503, 502, 200), got ${a.requests.length}.`);

  for (const status of [408, 429, 500, 504]) {
    const s = await serve([status, 200]);
    const r = await within(fetchWithRetry(s.url, {}, fast), 3000, `fetchWithRetry against ${status}, 200`);
    assert.equal(r.status, 200, `A ${status} should be retried, but the call returned ${r.status}.`);
  }

  const b = await serve(['reset', 'reset', 200]);
  const res2 = await within(fetchWithRetry(b.url, {}, fast), 3000, 'fetchWithRetry against two dropped connections');
  assert.equal(res2.status, 200, 'Two dropped connections followed by a 200 should end in the 200.');
  assert.equal(b.requests.length, 3, `Expected 3 requests, got ${b.requests.length}.`);
});

test('gives-up: after the allowed retries the last response is returned, or the last error thrown', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve([503]);
  const res = await within(fetchWithRetry(a.url, {}, { ...fast, retries: 2 }), 3000, 'fetchWithRetry against a server that always answers 503');
  assert.equal(res?.status, 503, 'When every attempt gets 503, the last 503 response should be returned, not thrown.');
  assert.equal(a.requests.length, 3, `retries: 2 means 3 requests in total, the server got ${a.requests.length}.`);

  const b = await serve(['reset']);
  await within(
    assert.rejects(fetchWithRetry(b.url, {}, { ...fast, retries: 2 }), 'When every attempt fails on the network, the call should reject.'),
    3000,
    'fetchWithRetry against a server that always drops the connection',
  );
  assert.equal(b.requests.length, 3, `retries: 2 means 3 attempts, the server saw ${b.requests.length}.`);

  const c = await serve([503]);
  await within(fetchWithRetry(c.url, {}, fast), 3000, 'fetchWithRetry with default retries');
  assert.equal(c.requests.length, 4, `The default is 3 retries (4 requests), the server got ${c.requests.length}.`);
});

test('no-retry-client-errors: 4xx answers other than 408 and 429 are returned at once', async () => {
  const { fetchWithRetry } = ready();
  for (const status of [400, 401, 404, 409, 422]) {
    const s = await serve([status, 200]);
    const res = await within(fetchWithRetry(s.url, {}, fast), 3000, `fetchWithRetry against ${status}`);
    assert.equal(res?.status, status, `A ${status} should be returned to the caller, got ${res?.status}.`);
    assert.equal(s.requests.length, 1, `A ${status} cannot succeed on retry, but the server got ${s.requests.length} requests.`);
  }
});

test('unsafe-methods: a POST is retried only when it carries an Idempotency-Key, and the retry repeats it exactly', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve([503, 200]);
  const plain = await within(
    fetchWithRetry(a.url, { method: 'POST', body: '{"amount":5}', headers: { 'content-type': 'application/json' } }, fast),
    3000,
    'a POST without a key',
  );
  assert.equal(plain.status, 503, 'A POST without an Idempotency-Key must not be retried; expected the 503 back.');
  assert.equal(a.requests.length, 1, `A POST without an Idempotency-Key was sent ${a.requests.length} times.`);

  for (const method of ['PATCH', 'POST']) {
    const s = await serve([503, 200]);
    const r = await fetchWithRetry(s.url, { method, body: 'x' }, fast);
    assert.equal(s.requests.length, 1, `A ${method} without an Idempotency-Key was sent ${s.requests.length} times.`);
    assert.equal(r.status, 503);
  }

  const b = await serve([503, 503, 201]);
  const keyed = await within(
    fetchWithRetry(b.url, { method: 'POST', body: '{"amount":5}', headers: { 'Idempotency-Key': 'pay-7', 'content-type': 'application/json' } }, fast),
    3000,
    'a POST with an Idempotency-Key',
  );
  assert.equal(keyed.status, 201, `A POST with an Idempotency-Key should be retried until the 201, got ${keyed.status}.`);
  assert.equal(b.requests.length, 3, `Expected 3 attempts, got ${b.requests.length}.`);
  for (const r of b.requests) {
    assert.equal(r.method, 'POST', 'Every attempt must use the original method.');
    assert.equal(r.headers['idempotency-key'], 'pay-7', 'Every attempt must carry the same Idempotency-Key.');
    assert.equal(r.body, '{"amount":5}', `Every attempt must send the original body, one sent ${JSON.stringify(r.body)}.`);
  }

  const c = await serve([503, 204]);
  const put = await fetchWithRetry(c.url, { method: 'PUT', body: 'v' }, fast);
  assert.equal(put.status, 204, 'PUT is idempotent and should be retried without a key.');
});

test('attempt-timeout: an attempt that hangs is abandoned after attemptTimeoutMs and retried', async () => {
  const { fetchWithRetry } = ready();
  const s = await serve(['hang', 200]);
  const started = Date.now();
  const res = await within(fetchWithRetry(s.url, {}, { ...fast, attemptTimeoutMs: 200 }), 4000, 'fetchWithRetry when the first attempt hangs');
  const elapsed = Date.now() - started;
  assert.equal(res.status, 200, 'The second attempt answers 200, so the call should return it.');
  assert.equal(s.requests.length, 2, `Expected the hanging attempt to be abandoned and retried once, got ${s.requests.length} requests.`);
  assert.ok(elapsed >= 180 && elapsed < 1500, `With attemptTimeoutMs 200 this should take about 200 ms, it took ${elapsed} ms.`);
});

test('deadline: the whole call, waits included, ends at deadlineMs with a TimeoutError', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve(['hang']);
  const started = Date.now();
  const error = await within(
    fetchWithRetry(a.url, {}, { ...fast, retries: 50, attemptTimeoutMs: 300, deadlineMs: 700 }).then(
      () => null,
      (e) => e,
    ),
    4000,
    'fetchWithRetry against a server that never answers',
  );
  const elapsed = Date.now() - started;
  assert.ok(error, 'A call that runs out of time must reject.');
  assert.equal(error.name, 'TimeoutError', `The rejection for a passed deadline should be named TimeoutError, it was ${error.name}.`);
  assert.ok(elapsed >= 650 && elapsed < 1200, `deadlineMs 700 should end the call after about 700 ms, it ended after ${elapsed} ms.`);

  const b = await serve([503]);
  const started2 = Date.now();
  const outcome = await within(
    fetchWithRetry(b.url, {}, { retries: 50, baseDelayMs: 400, maxDelayMs: 400, random: () => 0.99, deadlineMs: 600 }).then(
      (r) => r.status,
      (e) => e.name,
    ),
    4000,
    'fetchWithRetry with long backoff waits',
  );
  const elapsed2 = Date.now() - started2;
  assert.ok(elapsed2 < 1100, `The deadline must also cut short a backoff wait; the call took ${elapsed2} ms with deadlineMs 600.`);
  assert.equal(outcome, 'TimeoutError', `A deadline that passes during a backoff wait should reject with TimeoutError, got ${outcome}.`);
});

test('backoff-jitter: waits use full jitter on an exponential ceiling, with the random option', async () => {
  const { fetchWithRetry, backoffDelay } = ready();
  const half = () => 0.5;
  const got = [1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n, { baseDelayMs: 100, maxDelayMs: 1000, random: half }));
  assert.deepEqual(got, [50, 100, 200, 400, 500, 500], 'backoffDelay(n) with random 0.5, base 100 and max 1000 should give half of min(1000, 100 * 2^(n-1)).');
  assert.equal(backoffDelay(4, { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 }), 0, 'Full jitter can wait 0 ms when random() is 0.');
  const top = backoffDelay(3, { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0.9999 });
  assert.ok(Number.isInteger(top) && top >= 399 && top < 400, `With random 0.9999 the third retry waits just under 400 ms (an integer), got ${top}.`);
  assert.equal(backoffDelay(2, { random: half }), 100, 'The defaults are baseDelayMs 100 and maxDelayMs 2000.');

  const slow = await serve([503, 503, 503, 200]);
  const started = Date.now();
  await within(fetchWithRetry(slow.url, {}, { baseDelayMs: 200, maxDelayMs: 1000, random: () => 0.99 }), 5000, 'fetchWithRetry with long waits');
  const elapsed = Date.now() - started;
  // 0.99 * (200 + 400 + 800) is about 1386 ms of waiting.
  assert.ok(elapsed >= 1250 && elapsed < 2500, `Three retries with base 200 and random 0.99 should wait about 1.4 s in total, the call took ${elapsed} ms.`);

  const quick = await serve([503, 503, 503, 200]);
  const started2 = Date.now();
  await within(fetchWithRetry(quick.url, {}, { baseDelayMs: 200, maxDelayMs: 1000, random: () => 0 }), 5000, 'fetchWithRetry with zero waits');
  const elapsed2 = Date.now() - started2;
  assert.ok(elapsed2 < 300, `With random() returning 0 every wait is 0 ms, but the call took ${elapsed2} ms. Use the random option for the jitter.`);
});

test('retry-after: a Retry-After in seconds on 429 or 503 replaces the backoff, unless it passes the deadline', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve([{ status: 503, headers: { 'retry-after': '1' } }, 200]);
  const started = Date.now();
  const res = await within(fetchWithRetry(a.url, {}, fast), 4000, 'fetchWithRetry with Retry-After: 1');
  const elapsed = Date.now() - started;
  assert.equal(res.status, 200, 'After waiting for Retry-After the retry should succeed.');
  assert.ok(elapsed >= 950 && elapsed < 2000, `Retry-After: 1 should delay the retry by about 1 s, the call took ${elapsed} ms.`);

  const b = await serve([{ status: 429, headers: { 'retry-after': '30' } }, 200]);
  const started2 = Date.now();
  const res2 = await within(fetchWithRetry(b.url, {}, { ...fast, deadlineMs: 2000 }), 4000, 'fetchWithRetry with Retry-After: 30');
  const elapsed2 = Date.now() - started2;
  assert.equal(res2.status, 429, 'When Retry-After is longer than the remaining deadline, return that response instead of waiting.');
  assert.equal(b.requests.length, 1, `Expected no retry when Retry-After passes the deadline, the server got ${b.requests.length} requests.`);
  assert.ok(elapsed2 < 500, `Returning the 429 should be immediate, it took ${elapsed2} ms.`);
});

test('cancellation: the caller signal stops the call at once, also during a backoff wait', async () => {
  const { fetchWithRetry } = ready();
  const a = await serve([503]);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 100);
  const started = Date.now();
  const error = await within(
    fetchWithRetry(a.url, {}, { baseDelayMs: 1500, maxDelayMs: 1500, random: () => 0.99, signal: controller.signal }).then(
      () => null,
      (e) => e,
    ),
    4000,
    'a cancelled fetchWithRetry',
  );
  const elapsed = Date.now() - started;
  assert.ok(error, 'A cancelled call must reject.');
  assert.equal(error.name, 'AbortError', `A call cancelled through options.signal should reject with an AbortError, got ${error.name}.`);
  assert.ok(elapsed < 600, `The abort came after 100 ms during a 1.5 s wait; the call should stop then, it took ${elapsed} ms.`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(a.requests.length, 1, `No request may be sent after the abort, the server got ${a.requests.length}.`);

  const b = await serve(['hang']);
  const c2 = new AbortController();
  setTimeout(() => c2.abort(), 100);
  const started2 = Date.now();
  await within(
    assert.rejects(fetchWithRetry(b.url, {}, { signal: c2.signal }), { name: 'AbortError' }, 'Aborting during an attempt should reject with AbortError.'),
    3000,
    'a call cancelled during an attempt',
  );
  assert.ok(Date.now() - started2 < 600, 'Aborting during an attempt should end the call at once.');

  const d = await serve([200]);
  await assert.rejects(
    fetchWithRetry(d.url, {}, { signal: AbortSignal.abort() }),
    { name: 'AbortError' },
    'An already aborted signal should reject without a request.',
  );
  assert.equal(d.requests.length, 0, 'An already aborted signal must not send a request.');
});
