// Checks for "Find and fix a slow, leaking service". Node built-ins only.
// The service runs in a child process started with --expose-gc. A small harness inside
// that process samples event-loop delay with monitorEventLoopDelay and reports heap use
// after a forced GC, so the numbers describe the service and not this file.
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { describe, loadCatalogue } from './reference-catalogue.mjs';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');

/** Total event-loop blocking allowed while 15 /related requests are served. The starter blocks for well over 1.5 s. */
const BLOCKED_LIMIT_MS = 600;
/** Heap growth allowed after 3,000 page requests. 500 cached pages are about 15 MB; the starter grows by about 90 MB. */
const HEAP_GROWTH_LIMIT_MB = 45;

const HARNESS = `
import { monitorEventLoopDelay } from 'node:perf_hooks';
const { createServer } = await import(process.argv[2]);
if (typeof createServer !== 'function') {
  console.error('server.mjs must export a function named createServer');
  process.exit(2);
}
// Two views of the same thing. monitorEventLoopDelay gives the worst single delay.
// The interval adds up how long timers were late in total, which does not depend on
// how fast this machine sorts: fifteen blocks of 100 ms are 1.5 s on any machine.
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let blockedMs = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  blockedMs += Math.max(0, now - last - 10);
  last = now;
}, 10);
const server = createServer();
process.on('message', (message) => {
  if (message === 'reset') {
    delay.reset();
    blockedMs = 0;
    process.send({ type: 'reset' });
  } else if (message === 'stats') {
    const stats = { type: 'stats', blockedMs, maxMs: delay.max / 1e6 };
    for (let i = 0; i < 3; i++) globalThis.gc();
    stats.heapUsed = process.memoryUsage().heapUsed;
    process.send(stats);
  }
});
server.listen(0, '127.0.0.1', () => process.send({ type: 'port', port: server.address().port }));
`;

const harnessFile = path.join(dir, `.check-harness-${process.pid}.mjs`);
const state = { child: null, base: null, bootError: null, stderr: '' };
const waiting = new Map();

function startService() {
  return new Promise((resolve, reject) => {
    const entry = pathToFileURL(path.join(dir, 'server.mjs')).href;
    const child = fork(harnessFile, [entry], {
      cwd: dir,
      execArgv: ['--expose-gc', '--max-old-space-size=384'],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    state.child = child;
    child.stderr.on('data', (chunk) => {
      state.stderr = (state.stderr + chunk).slice(-2000);
    });
    const timer = setTimeout(() => reject(new Error(`server.mjs did not start listening within 20 s. stderr: ${state.stderr}`)), 20_000);
    child.on('message', (message) => {
      if (message.type === 'port') {
        clearTimeout(timer);
        resolve(`http://127.0.0.1:${message.port}`);
        return;
      }
      waiting.get(message.type)?.(message);
      waiting.delete(message.type);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`the service exited with code ${code}. stderr: ${state.stderr}`));
      for (const resolveWait of waiting.values()) resolveWait({ exited: true });
      waiting.clear();
    });
  });
}

function ask(type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the service did not answer "${type}" within 20 s`)), 20_000);
    waiting.set(type, (message) => {
      clearTimeout(timer);
      if (message.exited) reject(new Error(`the service exited. stderr: ${state.stderr}`));
      else resolve(message);
    });
    state.child.send(type);
  });
}

before(async () => {
  try {
    if (!existsSync(path.join(dir, 'server.mjs'))) throw new Error('server.mjs is missing from the submission.');
    writeFileSync(harnessFile, HARNESS);
    state.base = await startService();
  } catch (error) {
    state.bootError = String(error?.message ?? error).slice(0, 1500);
  }
});

after(() => {
  state.child?.kill('SIGKILL');
  rmSync(harnessFile, { force: true });
});

async function get(pathname) {
  assert.ok(!state.bootError, `The service did not start: ${state.bootError}`);
  const res = await fetch(state.base + pathname, { signal: AbortSignal.timeout(30_000) });
  return { status: res.status, text: await res.text() };
}

/** Runs `count` requests with `concurrency` in flight at a time. */
async function load(count, concurrency, pathFor) {
  let next = 0;
  const failures = [];
  async function worker() {
    while (next < count) {
      const i = next++;
      const res = await get(pathFor(i));
      if (res.status !== 200) failures.push(`${pathFor(i)} answered ${res.status}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  assert.equal(failures.length, 0, `Some requests under load failed: ${failures.slice(0, 3).join('; ')}`);
}

// The expected answers, computed from the original catalogue in this process.
const catalogue = loadCatalogue();
let ranked;
function expectedRelated(id) {
  const product = catalogue[id - 1];
  ranked ??= catalogue.slice().sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name) || a.id - b.id);
  return ranked
    .filter((other) => other.category === product.category && other.id !== product.id)
    .slice(0, 5)
    .map(({ id: otherId, name, rating }) => ({ id: otherId, name, rating }));
}
const expectedPage = (id) => ({ ...catalogue[id - 1], description: describe(catalogue[id - 1]) });

test('responses-unchanged: pages, related products and 404s are exactly as before', async () => {
  for (const id of [1, 77, 4242, 99_999, 100_000]) {
    const related = await get(`/products/${id}/related`);
    assert.equal(related.status, 200, `GET /products/${id}/related: expected 200, got ${related.status}`);
    assert.deepEqual(JSON.parse(related.text), { id, related: expectedRelated(id) }, `GET /products/${id}/related: the related products changed. They must stay the five best-rated others in the category, ties broken by name, then id.`);
    for (const query of ['', '?utm_source=newsletter', '?ref=check']) {
      const page = await get(`/products/${id}${query}`);
      assert.equal(page.status, 200, `GET /products/${id}${query}: expected 200, got ${page.status}`);
      assert.deepEqual(JSON.parse(page.text), expectedPage(id), `GET /products/${id}${query}: the page body changed.`);
    }
  }
  for (const pathname of ['/products/0', '/products/100001', '/products/abc', '/nope']) {
    const res = await get(pathname);
    assert.equal(res.status, 404, `GET ${pathname}: expected 404, got ${res.status}`);
  }
  const health = await get('/health');
  assert.equal(health.status, 200, `GET /health: expected 200, got ${health.status}`);
});

test('loop-responsive: serving related products does not block the event loop', async (t) => {
  await get('/products/5/related');
  await ask('reset');
  const started = performance.now();
  await load(15, 3, (i) => `/products/${((i * 6151) % 100_000) + 1}/related`);
  const elapsed = performance.now() - started;
  const stats = await ask('stats');
  t.diagnostic(`blocked ${stats.blockedMs.toFixed(0)} ms in total, longest delay ${stats.maxMs.toFixed(0)} ms, ${elapsed.toFixed(0)} ms for the requests`);
  assert.ok(
    stats.blockedMs < BLOCKED_LIMIT_MS,
    `While 15 GET /products/:id/related requests were served, the event loop was blocked for ${stats.blockedMs.toFixed(0)} ms in total (longest single delay ${stats.maxMs.toFixed(0)} ms). It must stay under ${BLOCKED_LIMIT_MS} ms: something synchronous and expensive runs on every request.`,
  );
});

test('bounded-memory: the heap stops growing when many different pages are requested', async (t) => {
  // Warm up: the first requests allocate buffers and compile code.
  await load(300, 8, (i) => `/products/${i + 1}?warm=${i}`);
  const baseline = (await ask('stats')).heapUsed;
  await load(3000, 8, (i) => `/products/${((i * 7919) % 100_000) + 1}?utm_campaign=c${i}`);
  const grown = (await ask('stats')).heapUsed;
  const growthMb = (grown - baseline) / 1024 / 1024;
  t.diagnostic(`heap grew by ${growthMb.toFixed(1)} MB`);
  assert.ok(
    growthMb < HEAP_GROWTH_LIMIT_MB,
    `After 3,000 requests for different product pages (each URL with its own query string), the heap grew by ${growthMb.toFixed(0)} MB after a full GC. It must stay under ${HEAP_GROWTH_LIMIT_MB} MB: something keeps every response alive.`,
  );
});
