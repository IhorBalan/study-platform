import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const HEALTH_BOUND_MS = 300;
const HEAVY_TARGET_MS = 1500;
const HEAVY_TIMEOUT_MS = 40_000;
const MAX_ROUNDS = 20_000_000;

/** Reference implementation of the digest defined in the task. */
function referenceHash(input, rounds) {
  let digest = createHash('sha256').update(input, 'utf8').digest();
  for (let i = 1; i < rounds; i++) digest = createHash('sha256').update(digest).digest();
  return digest.toString('hex');
}

/** Picks a round count that takes roughly HEAVY_TARGET_MS on this machine. */
function calibrateRounds() {
  const sample = 50_000;
  referenceHash('warm-up', 5_000);
  const started = performance.now();
  referenceHash('calibrate', sample);
  const perRound = (performance.now() - started) / sample;
  const rounds = Math.round(HEAVY_TARGET_MS / perRound);
  return Math.min(MAX_ROUNDS, Math.max(200_000, rounds));
}

// The server runs in its own process, so that a blocked event loop in the
// submission cannot distort the timers in this file. The runner is a real file
// rather than `node -e`, because worker threads inherit the parent's exec flags.
const RUNNER = `
  const { createServer } = await import(process.argv[2]);
  if (typeof createServer !== 'function') {
    console.error('server.mjs must export a function named createServer');
    process.exit(2);
  }
  const server = createServer();
  server.listen(0, '127.0.0.1', () => console.log('PORT=' + server.address().port));
`;

// SUBMISSION_DIR is the one location the sandbox guarantees to be writable.
const runnerFile = path.join(submissionDir, `.check-run-server-${process.pid}.mjs`);
writeFileSync(runnerFile, RUNNER);

const children = new Set();

function startServer() {
  return new Promise((resolve, reject) => {
    const entry = pathToFileURL(path.join(submissionDir, 'server.mjs')).href;
    const child = spawn(process.execPath, [runnerFile, entry], {
      cwd: submissionDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      stop(child);
      reject(new Error(`the server did not start listening within 10 s. stderr: ${stderr.slice(-400)}`));
    }, 10_000);
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const match = /PORT=(\d+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve({ child, port: Number(match[1]) });
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      children.delete(child);
      reject(new Error(`the server process exited with code ${code} before listening. stderr: ${stderr.slice(-400)}`));
    });
  });
}

function stop(child) {
  children.delete(child);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

after(() => {
  for (const child of children) stop(child);
  rmSync(runnerFile, { force: true });
});

async function withServer(fn) {
  const { child, port } = await startServer();
  try {
    return await fn(port);
  } finally {
    stop(child);
  }
}

function get(port, target, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get({ host: '127.0.0.1', port, path: target, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', fail);
      res.on('end', () => {
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, json, text, ms: performance.now() - started });
      });
    });
    const fail = (error) => {
      clearTimeout(timer);
      reject(new Error(`GET ${target} failed: ${error.message}`));
    };
    const timer = setTimeout(() => {
      req.destroy();
      fail(new Error(`no response within ${timeoutMs} ms`));
    }, timeoutMs);
    req.on('error', fail);
  });
}

function hashPath(input, rounds) {
  return `/hash?input=${encodeURIComponent(input)}&rounds=${rounds}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('hash-correct: GET /hash returns the same digest as the original implementation', async () => {
  await withServer(async (port) => {
    const cases = [
      ['abc', 1],
      ['abc', 2],
      ['', 3],
      ['grüße & more', 1000],
      ['abc', 25_001],
    ];
    for (const [input, rounds] of cases) {
      const res = await get(port, hashPath(input, rounds));
      assert.equal(res.status, 200, `GET /hash for input ${JSON.stringify(input)}, rounds ${rounds}: expected status 200, got ${res.status}`);
      assert.deepEqual(
        res.json,
        { input, rounds, hash: referenceHash(input, rounds) },
        `GET /hash for input ${JSON.stringify(input)}, rounds ${rounds}: the body must be { input, rounds, hash } with the digest of the original implementation`,
      );
    }
  });
});

test('rejects-bad-input: missing or invalid input and rounds still get 400', async () => {
  await withServer(async (port) => {
    const bad = [
      '/hash?rounds=10',
      '/hash?input=abc',
      '/hash?input=abc&rounds=0',
      '/hash?input=abc&rounds=-5',
      '/hash?input=abc&rounds=1.5',
      '/hash?input=abc&rounds=many',
      `/hash?input=abc&rounds=${MAX_ROUNDS + 1}`,
    ];
    for (const target of bad) {
      const res = await get(port, target);
      assert.equal(res.status, 400, `GET ${target}: expected status 400, got ${res.status}`);
    }
    const health = await get(port, '/health');
    assert.equal(health.status, 200, `GET /health: expected status 200, got ${health.status}`);
    assert.deepEqual(health.json, { status: 'ok' }, 'GET /health must return { "status": "ok" }');
  });
});

// One heavy request with /health probes alongside it. Two criteria read the outcome.
let scenarioPromise;
function heavyScenario() {
  scenarioPromise ??= withServer(async (port) => {
    const rounds = calibrateRounds();
    const input = 'heavy-load';

    const warm = await get(port, '/health');
    assert.equal(warm.status, 200, `GET /health before the load: expected status 200, got ${warm.status}`);

    let heavyDone = false;
    const heavy = get(port, hashPath(input, rounds), HEAVY_TIMEOUT_MS).finally(() => {
      heavyDone = true;
    });
    heavy.catch(() => {});

    // Give the heavy request time to reach the handler, then probe until it finishes.
    await sleep(100);
    const probes = [];
    while (!heavyDone && probes.length < 2000) {
      const probe = await get(port, '/health', HEAVY_TIMEOUT_MS).catch((error) => ({ error }));
      // A probe only counts if it was sent while the heavy request was still running.
      probes.push(probe);
      if (probe.error) break;
      await sleep(20);
    }

    const heavyResult = await heavy.catch((error) => ({ error }));
    return { input, rounds, probes, heavyResult };
  });
  return scenarioPromise;
}

test('stays-responsive: GET /health answers within 300 ms while a heavy hash is running', { timeout: 100_000 }, async () => {
  const { rounds, probes, heavyResult } = await heavyScenario();

  const failed = probes.find((p) => p.error);
  assert.ok(!failed, `a /health request failed while /hash (rounds=${rounds}) was running: ${failed?.error?.message}`);
  assert.ok(probes.length > 0, 'no /health request could be sent while the heavy /hash request was running');
  for (const probe of probes) {
    assert.equal(probe.status, 200, `GET /health during the heavy request: expected status 200, got ${probe.status}`);
  }

  const slowest = Math.max(...probes.map((p) => p.ms));
  assert.ok(
    slowest <= HEALTH_BOUND_MS,
    `GET /health took ${Math.round(slowest)} ms while /hash (rounds=${rounds}) was running; ` +
      `expected at most ${HEALTH_BOUND_MS} ms. The event loop is still blocked for long stretches.`,
  );
  assert.ok(
    probes.length >= 3,
    `only ${probes.length} /health request(s) completed while /hash (rounds=${rounds}) ran` +
      (heavyResult.ms ? ` for ${Math.round(heavyResult.ms)} ms` : '') +
      '; expected at least 3. The hash must do the full amount of work.',
  );
});

test('heavy-result-correct: the heavy hash that ran during the responsiveness check is correct', { timeout: 100_000 }, async () => {
  const { input, rounds, heavyResult } = await heavyScenario();
  assert.ok(!heavyResult.error, `the heavy /hash request (rounds=${rounds}) failed: ${heavyResult.error?.message}`);
  assert.equal(heavyResult.status, 200, `heavy /hash request (rounds=${rounds}): expected status 200, got ${heavyResult.status}`);
  assert.equal(
    heavyResult.json?.hash,
    referenceHash(input, rounds),
    `heavy /hash request (input "${input}", rounds=${rounds}): the digest differs from the original implementation`,
  );
});

test('concurrent-hashes: several hashes requested at the same time are all correct', { timeout: 100_000 }, async () => {
  await withServer(async (port) => {
    const rounds = Math.max(20_000, Math.round(calibrateRounds() / 10));
    const jobs = ['alpha', 'beta', 'gamma', 'delta'].map((input, i) => ({ input, rounds: rounds + i }));
    const results = await Promise.all(jobs.map((job) => get(port, hashPath(job.input, job.rounds), HEAVY_TIMEOUT_MS)));
    results.forEach((res, i) => {
      const { input, rounds: r } = jobs[i];
      assert.equal(res.status, 200, `concurrent /hash for input "${input}": expected status 200, got ${res.status}`);
      assert.deepEqual(
        res.json,
        { input, rounds: r, hash: referenceHash(input, r) },
        `concurrent /hash for input "${input}", rounds ${r}: wrong body. Each request must get its own input, rounds and digest.`,
      );
    });
  });
});
