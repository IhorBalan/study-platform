import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { backoffDelay, fetchWithRetry } from '../retry.ts';
import { startServer, type ScriptedServer } from './server.ts';

const fast = { baseDelayMs: 5, maxDelayMs: 20 };
let server: ScriptedServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('backoffDelay', () => {
  test('doubles the ceiling per retry and caps it', () => {
    const half = () => 0.5;
    const delays = [1, 2, 3, 4, 5].map((n) => backoffDelay(n, { baseDelayMs: 100, maxDelayMs: 600, random: half }));
    assert.deepEqual(delays, [50, 100, 200, 300, 300]);
  });

  test('never exceeds the ceiling', () => {
    assert.ok(backoffDelay(3, { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0.9999 }) < 400);
    assert.equal(backoffDelay(3, { baseDelayMs: 100, maxDelayMs: 1000, random: () => 0 }), 0);
  });
});

describe('fetchWithRetry', () => {
  test('retries 503 until it succeeds', async () => {
    server = await startServer([503, 503, 200]);
    const res = await fetchWithRetry(server.url, {}, fast);
    assert.equal(res.status, 200);
    assert.equal(server.hits(), 3);
  });

  test('retries a dropped connection', async () => {
    server = await startServer(['reset', 200]);
    const res = await fetchWithRetry(server.url, {}, fast);
    assert.equal(res.status, 200);
    assert.equal(server.hits(), 2);
  });

  test('does not retry client errors', async () => {
    for (const status of [400, 404, 422]) {
      server = await startServer([status, 200]);
      const res = await fetchWithRetry(server.url, {}, fast);
      assert.equal(res.status, status);
      assert.equal(server.hits(), 1, `status ${status} was retried`);
      await server.close();
      server = undefined;
    }
  });

  test('returns the last response when retries run out', async () => {
    server = await startServer([503]);
    const res = await fetchWithRetry(server.url, {}, { ...fast, retries: 2 });
    assert.equal(res.status, 503);
    assert.equal(server.hits(), 3);
  });

  test('a POST is retried only with an Idempotency-Key', async () => {
    server = await startServer([503, 200]);
    const plain = await fetchWithRetry(server.url, { method: 'POST', body: '{}' }, fast);
    assert.equal(plain.status, 503);
    assert.equal(server.hits(), 1);

    const keyed = await fetchWithRetry(server.url, { method: 'POST', body: '{}', headers: { 'Idempotency-Key': 'k1' } }, fast);
    assert.equal(keyed.status, 200);
    assert.equal(server.hits(), 2);
  });

  test('an attempt that hangs is timed out and retried', async () => {
    server = await startServer(['hang', 200]);
    const res = await fetchWithRetry(server.url, {}, { ...fast, attemptTimeoutMs: 100 });
    assert.equal(res.status, 200);
  });

  test('the deadline stops everything', async () => {
    server = await startServer(['hang']);
    const started = Date.now();
    await assert.rejects(
      fetchWithRetry(server.url, {}, { ...fast, retries: 50, attemptTimeoutMs: 100, deadlineMs: 300 }),
      { name: 'TimeoutError' },
    );
    assert.ok(Date.now() - started < 800);
  });

  test('honours Retry-After in seconds', async () => {
    server = await startServer([{ status: 503, headers: { 'retry-after': '1' } }, 200]);
    const started = Date.now();
    const res = await fetchWithRetry(server.url, {}, fast);
    assert.equal(res.status, 200);
    assert.ok(Date.now() - started >= 950);
  });

  test('a cancelled call stops during the backoff', async () => {
    server = await startServer([503]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const started = Date.now();
    await assert.rejects(
      fetchWithRetry(server.url, {}, { baseDelayMs: 1000, maxDelayMs: 1000, random: () => 0.99, signal: controller.signal }),
      { name: 'AbortError' },
    );
    assert.ok(Date.now() - started < 500);
    assert.equal(server.hits(), 1);
  });
});
