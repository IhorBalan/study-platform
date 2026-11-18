import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { fetchWithRetry } from '../retry.ts';
import { startServer, type ScriptedServer } from './server.ts';

let server: ScriptedServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

test('returns a successful response', async () => {
  server = await startServer([200]);
  const res = await fetchWithRetry(server.url);
  assert.equal(res.status, 200);
  assert.equal(server.hits(), 1);
});

// TODO: add tests for retries, the retry policy, timeouts, the deadline, backoff and cancellation.
// server.ts can answer with a status, hang, drop the connection or send headers. See its comment.
