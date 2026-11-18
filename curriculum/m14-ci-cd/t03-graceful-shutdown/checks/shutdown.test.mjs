import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');
const ENTRY = path.join(submissionDir, 'server.mjs');

const running = new Set();

/** Starts server.mjs with PORT=0 and waits for its "listening" log line. */
async function startServer(env = {}) {
  assert.ok(fs.existsSync(ENTRY), 'expected server.mjs in the submission');
  const child = spawn(process.execPath, [ENTRY], {
    cwd: submissionDir,
    env: { ...process.env, PORT: '0', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  running.add(child);
  let output = '';
  const exited = new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      running.delete(child);
      resolve({ code, signal, at: Date.now() });
    });
  });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server.mjs did not log {"msg":"listening","port":...} within 5 s. Output so far:\n${output.slice(-500)}`)), 5000);
    const onData = (chunk) => {
      output += chunk;
      for (const line of output.split('\n')) {
        try {
          const entry = JSON.parse(line);
          if (entry?.msg === 'listening' && Number.isInteger(entry.port) && entry.port > 0) {
            clearTimeout(timer);
            resolve(entry.port);
            return;
          }
        } catch {
          // not a JSON line
        }
      }
    };
    child.stdout.setEncoding('utf8').on('data', onData);
    child.stderr.setEncoding('utf8').on('data', (c) => (output += c));
    exited.then(({ code, signal }) => {
      clearTimeout(timer);
      reject(new Error(`server.mjs exited before listening (code ${code}, signal ${signal}). Output:\n${output.slice(-500)}`));
    });
  });
  return { child, port, exited, output: () => output };
}

function stop(server) {
  if (server && server.child.exitCode === null && server.child.signalCode === null) server.child.kill('SIGKILL');
}

process.on('exit', () => {
  for (const child of running) child.kill('SIGKILL');
});

function get(port, target, { agent = false, timeoutMs = 10_000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: target, agent }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => {
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, json, at: Date.now() });
      });
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`GET ${target} got no response within ${timeoutMs} ms`)));
    req.on('error', reject);
  });
}

/** Resolves with the exit, or with null if the process is still running after `ms`. */
function exitWithin(server, ms) {
  return Promise.race([server.exited, sleep(ms).then(() => null)]);
}

function describeExit(exit) {
  if (!exit) return 'it was still running';
  return exit.signal ? `it was killed by ${exit.signal} without handling it` : `it exited with code ${exit.code}`;
}

test('starts-healthy: the server listens on PORT and both health endpoints answer 200', async () => {
  const server = await startServer();
  try {
    const live = await get(server.port, '/healthz/live');
    assert.equal(live.status, 200, `GET /healthz/live: expected 200, got ${live.status}`);
    const ready = await get(server.port, '/healthz/ready');
    assert.equal(ready.status, 200, `GET /healthz/ready before shutdown: expected 200, got ${ready.status}`);
    const work = await get(server.port, '/work?ms=50');
    assert.equal(work.status, 200, `GET /work?ms=50: expected 200, got ${work.status}`);
  } finally {
    stop(server);
  }
});

test('readiness-fails: after SIGTERM readiness answers 503 while the server keeps serving for SHUTDOWN_DELAY_MS', async () => {
  const server = await startServer({ SHUTDOWN_DELAY_MS: '1500', SHUTDOWN_TIMEOUT_MS: '5000' });
  try {
    const signalledAt = Date.now();
    server.child.kill('SIGTERM');
    await sleep(200);
    let ready;
    try {
      ready = await get(server.port, '/healthz/ready', { timeoutMs: 1000 });
    } catch (error) {
      assert.fail(`200 ms after SIGTERM, with SHUTDOWN_DELAY_MS=1500, GET /healthz/ready failed (${error.message}); the server must keep accepting during the delay`);
    }
    assert.equal(ready.status, 503, `GET /healthz/ready after SIGTERM: expected 503, got ${ready.status}`);
    const live = await get(server.port, '/healthz/live', { timeoutMs: 1000 });
    assert.equal(live.status, 200, `GET /healthz/live during the shutdown delay: expected 200 (the process is still alive), got ${live.status}`);
    const work = await get(server.port, '/work?ms=20', { timeoutMs: 1000 });
    assert.equal(work.status, 200, `a new request during the shutdown delay: expected 200, got ${work.status}`);

    const exit = await exitWithin(server, 3000);
    assert.ok(exit && exit.code === 0, `after the delay, with nothing in flight, the server must exit with code 0, but ${describeExit(exit)}`);
    assert.ok(
      exit.at - signalledAt >= 1300,
      `the server exited ${exit.at - signalledAt} ms after SIGTERM; it must keep serving for SHUTDOWN_DELAY_MS (1500 ms) first`,
    );
  } finally {
    stop(server);
  }
});

test('stops-accepting: once the delay is over, new connections are refused', async () => {
  const server = await startServer({ SHUTDOWN_DELAY_MS: '0', SHUTDOWN_TIMEOUT_MS: '5000' });
  try {
    const inflight = get(server.port, '/work?ms=1500').catch((e) => e);
    await sleep(200);
    server.child.kill('SIGTERM');
    await sleep(200);
    let late;
    try {
      late = await get(server.port, '/healthz/live', { timeoutMs: 1000 });
    } catch (error) {
      late = error;
    }
    assert.ok(
      late instanceof Error,
      `200 ms after SIGTERM (SHUTDOWN_DELAY_MS=0) a new connection was still accepted and answered ${late.status}; stop listening when the delay ends`,
    );
    const exit = await exitWithin(server, 0);
    assert.ok(
      !exit,
      `new connections were refused only because the process had already stopped (${describeExit(exit)}); it must stop listening but stay up while a request is in flight`,
    );
    await inflight;
  } finally {
    stop(server);
  }
});

test('finishes-inflight: a request that is running when SIGTERM arrives completes, then the process exits 0', async () => {
  const server = await startServer({ SHUTDOWN_DELAY_MS: '0', SHUTDOWN_TIMEOUT_MS: '5000' });
  try {
    const inflight = get(server.port, '/work?ms=1500');
    await sleep(200);
    server.child.kill('SIGTERM');
    let res;
    try {
      res = await inflight;
    } catch (error) {
      const exit = await exitWithin(server, 100);
      assert.fail(`the in-flight request failed (${error.message}) when SIGTERM arrived; ${describeExit(exit)}`);
    }
    assert.equal(res.status, 200, `the in-flight request: expected 200, got ${res.status}`);
    assert.equal(res.json?.done, true, 'the in-flight request must get its normal body');
    const exit = await exitWithin(server, 1000);
    assert.ok(exit && exit.code === 0, `after the last request finished the server must exit with code 0 within 1 s, but ${describeExit(exit)}`);
  } finally {
    stop(server);
  }
});

test('keep-alive: idle and busy keep-alive connections do not hold the process open', async () => {
  // An idle keep-alive connection.
  const idle = await startServer({ SHUTDOWN_DELAY_MS: '0', SHUTDOWN_TIMEOUT_MS: '8000' });
  const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    const first = await get(idle.port, '/healthz/live', { agent });
    assert.equal(first.status, 200);
    idle.child.kill('SIGTERM');
    const exit = await exitWithin(idle, 1000);
    assert.ok(
      exit && exit.code === 0,
      `with one idle keep-alive connection open, the server must exit with code 0 within 1 s of SIGTERM, but ${describeExit(exit)}`,
    );
  } finally {
    stop(idle);
    agent.destroy();
  }

  // A keep-alive connection with a request in flight.
  const busy = await startServer({ SHUTDOWN_DELAY_MS: '0', SHUTDOWN_TIMEOUT_MS: '8000' });
  const agent2 = new http.Agent({ keepAlive: true, maxSockets: 1 });
  try {
    await get(busy.port, '/healthz/live', { agent: agent2 });
    const inflight = get(busy.port, '/work?ms=800', { agent: agent2 });
    await sleep(150);
    busy.child.kill('SIGTERM');
    const res = await inflight;
    assert.equal(res.status, 200, `the in-flight keep-alive request: expected 200, got ${res.status}`);
    const exit = await exitWithin(busy, 1000);
    assert.ok(
      exit && exit.code === 0,
      `after answering the last request on a keep-alive connection the server must exit with code 0 within 1 s, but ${describeExit(exit)}; the connection must not stay open`,
    );
  } finally {
    stop(busy);
    agent2.destroy();
  }
});

test('deadline: a request that outlives SHUTDOWN_TIMEOUT_MS does not block the exit, which then has code 1', async () => {
  const server = await startServer({ SHUTDOWN_DELAY_MS: '0', SHUTDOWN_TIMEOUT_MS: '1000' });
  try {
    const stuck = get(server.port, '/work?ms=20000', { timeoutMs: 5000 }).catch((e) => e);
    await sleep(200);
    const signalledAt = Date.now();
    server.child.kill('SIGTERM');
    const exit = await exitWithin(server, 2500);
    assert.ok(exit, 'with SHUTDOWN_TIMEOUT_MS=1000 the server was still running 2.5 s after SIGTERM');
    assert.equal(
      exit.code,
      1,
      `when the deadline forces the exit the code must be 1, but ${describeExit(exit)}`,
    );
    assert.ok(
      exit.at - signalledAt >= 800,
      `the server exited ${exit.at - signalledAt} ms after SIGTERM; it must give in-flight requests up to SHUTDOWN_TIMEOUT_MS (1000 ms)`,
    );
    await stuck;
  } finally {
    stop(server);
  }
});
