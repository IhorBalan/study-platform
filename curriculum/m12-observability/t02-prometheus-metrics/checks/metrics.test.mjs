// Checks for "Expose Prometheus metrics". Node built-ins only; express and prom-client come
// from the submission's node_modules. Node runs src/app.ts directly by stripping its types.
// The checks send traffic, scrape /metrics like Prometheus would and parse the text format.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const state = { bootError: null, mod: null, servers: [], base: null };

async function listen(app) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  state.servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  try {
    const file = path.join(dir, 'src', 'app.ts');
    if (!existsSync(file)) throw new Error('src/app.ts is missing from the submission.');
    state.mod = await import(pathToFileURL(file).href);
    if (typeof state.mod.createApp !== 'function') throw new Error('src/app.ts must export a function named createApp.');
    state.base = await listen(state.mod.createApp());
  } catch (error) {
    state.bootError = String(error?.stack ?? error).slice(0, 1500);
  }
});

after(() => {
  for (const server of state.servers) {
    server.closeAllConnections?.();
    server.close();
  }
});

function ready() {
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
}

async function send(pathname, { method = 'GET', base = state.base } = {}) {
  ready();
  const res = await fetch(base + pathname, {
    method,
    headers: method === 'POST' ? { 'content-type': 'application/json' } : {},
    body: method === 'POST' ? JSON.stringify({ item: 'book' }) : undefined,
    signal: AbortSignal.timeout(5000),
  });
  await res.text();
  return res.status;
}

/** Parses the Prometheus text exposition format into types and samples. */
function parse(text) {
  const types = new Map();
  const samples = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('# TYPE ')) {
      const [, , name, type] = line.split(/\s+/);
      types.set(name, type);
      continue;
    }
    if (line.startsWith('#') || line.trim() === '') continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\S+)?$/.exec(line);
    if (!match) {
      samples.push({ name: '__unparsed', line });
      continue;
    }
    const labels = {};
    for (const [, key, value] of (match[2] ?? '').matchAll(/([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) {
      labels[key] = value;
    }
    samples.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return { types, samples };
}

async function scrape(base = state.base) {
  ready();
  const res = await fetch(`${base}/metrics`, { signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  return { status: res.status, type: res.headers.get('content-type') ?? '', text, ...parse(text) };
}

const find = (scraped, name, labels) =>
  scraped.samples.filter((s) => s.name === name && Object.entries(labels).every(([k, v]) => s.labels[k] === v));
const valueOf = (scraped, name, labels) => find(scraped, name, labels).reduce((sum, s) => sum + s.value, 0);

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc -p tsconfig.json failed:\n${output.slice(0, 3000)}`);
});

test('metrics-endpoint: GET /metrics serves the Prometheus text format with the three HTTP metrics', async () => {
  await send('/health');
  const scraped = await scrape();
  assert.equal(scraped.status, 200, `GET /metrics: expected 200, got ${scraped.status}`);
  assert.ok(scraped.type.startsWith('text/plain'), `GET /metrics: expected a text/plain content type (the registry's contentType), got "${scraped.type}"`);
  const unparsed = scraped.samples.find((s) => s.name === '__unparsed');
  assert.ok(!unparsed, `GET /metrics: this line is not in the exposition format: ${unparsed?.line?.slice(0, 200)}`);
  for (const [name, type] of [
    ['http_requests_total', 'counter'],
    ['http_request_duration_seconds', 'histogram'],
    ['http_requests_in_flight', 'gauge'],
  ]) {
    assert.equal(scraped.types.get(name), type, `GET /metrics: expected "# TYPE ${name} ${type}", found ${scraped.types.has(name) ? `type ${scraped.types.get(name)}` : 'no such metric'}`);
  }
});

test('request-counter: http_requests_total counts each request once by method, route and status_code', async () => {
  const before = await scrape();
  const series = [
    [{ method: 'GET', route: '/orders/:id', status_code: '200' }, ['/orders/1', '/orders/2', '/orders/3']],
    [{ method: 'GET', route: '/orders/:id', status_code: '404' }, ['/orders/abc']],
    [{ method: 'POST', route: '/orders', status_code: '201' }, ['/orders', '/orders']],
    [{ method: 'GET', route: '/fail', status_code: '500' }, ['/fail', '/fail']],
  ];
  for (const [labels, paths] of series) {
    for (const p of paths) await send(p, { method: labels.method });
  }
  const afterScrape = await scrape();
  for (const [labels, paths] of series) {
    const delta = valueOf(afterScrape, 'http_requests_total', labels) - valueOf(before, 'http_requests_total', labels);
    assert.equal(
      delta,
      paths.length,
      `http_requests_total${JSON.stringify(labels)}: expected it to grow by ${paths.length} after ${labels.method} ${paths.join(', ')}, it grew by ${delta}`,
    );
  }
});

test('duration-histogram: http_request_duration_seconds puts fast and slow requests in the right buckets', async () => {
  const slow = { method: 'GET', route: '/reports/:id', status_code: '200' };
  const fast = { method: 'GET', route: '/health', status_code: '200' };
  const before = await scrape();
  await Promise.all([send('/reports/1'), send('/reports/2')]);
  for (let i = 0; i < 3; i++) await send('/health');
  const now = await scrape();
  const delta = (name, labels) => valueOf(now, name, labels) - valueOf(before, name, labels);
  const bucket = (labels, le) => delta('http_request_duration_seconds_bucket', { ...labels, le });

  for (const le of ['0.1', '0.25', '1', '+Inf']) {
    assert.ok(
      find(now, 'http_request_duration_seconds_bucket', { ...slow, le }).length === 1,
      `Expected a bucket with le="${le}" for the /reports/:id series. Use buckets that include 0.1, 0.25 and 1 (the defaults do).`,
    );
  }
  assert.equal(delta('http_request_duration_seconds_count', slow), 2, 'Two GET /reports/:id requests must add 2 to http_request_duration_seconds_count for that series.');
  assert.equal(bucket(slow, '0.25'), 0, 'GET /reports/:id takes over 300 ms, yet it was counted in the le="0.25" bucket. Observe seconds, not milliseconds, from arrival until the response finishes.');
  assert.equal(bucket(slow, '1'), 2, 'Two GET /reports/:id requests of about 300 ms must be counted in the le="1" bucket.');
  assert.equal(bucket(slow, '+Inf'), 2, 'The le="+Inf" bucket must equal the count.');
  const sum = delta('http_request_duration_seconds_sum', slow);
  assert.ok(sum >= 0.55 && sum < 2, `http_request_duration_seconds_sum for /reports/:id grew by ${sum}, expected about 0.6 (two requests of 300 ms, in seconds).`);
  assert.equal(bucket(fast, '0.1'), 3, 'Three GET /health requests must each land in the le="0.1" bucket.');
});

test('in-flight-gauge: http_requests_in_flight shows requests that are still running', async () => {
  const pending = [send('/reports/10'), send('/reports/11'), send('/reports/12')];
  await new Promise((resolve) => setTimeout(resolve, 120));
  const during = await scrape();
  const busy = valueOf(during, 'http_requests_in_flight', {});
  await Promise.all(pending);
  const idle = valueOf(await scrape(), 'http_requests_in_flight', {});
  assert.ok(busy >= 3, `While three slow requests were running, http_requests_in_flight was ${busy}. Expected at least 3.`);
  assert.ok(idle <= 1, `After every request finished, http_requests_in_flight was ${idle}. Expected 0 (or 1 if you count the scrape itself).`);
});

test('bounded-labels: ids, unknown paths and query strings never become label values', async () => {
  const stamp = Date.now();
  for (let i = 0; i < 40; i++) await send(`/orders/${stamp + i}?ref=campaign-${i}`);
  for (let i = 0; i < 25; i++) await send(`/no-such-page-${stamp}-${i}/deeper`);
  await send('/health?cache-buster=' + stamp);
  const scraped = await scrape();
  const series = find(scraped, 'http_requests_total', {});
  assert.ok(series.length > 0, 'http_requests_total has no series yet.');
  const routes = [...new Set(series.map((s) => s.labels.route))];
  const raw = routes.filter((route) => route === undefined || route.includes(String(stamp).slice(0, 6)) || route.includes('?') || route.includes('no-such-page'));
  assert.equal(raw.length, 0, `These route label values come from raw paths: ${JSON.stringify(raw.slice(0, 5))}. Use the route template, and "unmatched" for paths no route matched.`);
  const unmatched = find(scraped, 'http_requests_total', { route: 'unmatched', status_code: '404' });
  assert.ok(unmatched.length === 1 && unmatched[0].value >= 25, 'Requests to paths that match no route must be counted under route="unmatched".');
  for (const s of series) {
    assert.ok(/^\d{3}$/.test(s.labels.status_code ?? ''), `status_code must be the three-digit status, found ${JSON.stringify(s.labels)}`);
  }
  assert.ok(series.length <= 25, `http_requests_total has ${series.length} series after this traffic. A handful of routes times a few statuses should stay well under 25.`);
  const buckets = find(scraped, 'http_request_duration_seconds_bucket', {});
  const histogramRoutes = new Set(buckets.map((s) => s.labels.route));
  assert.ok(!histogramRoutes.has(undefined) && [...histogramRoutes].every((r) => routes.includes(r) || r === '/metrics'), 'The histogram must use the same bounded route labels as the counter.');
});

test('default-metrics: process and Node runtime metrics are exposed', async () => {
  const scraped = await scrape();
  for (const name of ['process_cpu_user_seconds_total', 'process_resident_memory_bytes', 'nodejs_eventloop_lag_seconds', 'nodejs_heap_size_used_bytes']) {
    assert.ok(scraped.types.has(name), `Expected the default metric ${name}. prom-client collects these for a registry you pass it.`);
  }
});

test('own-registry: each createApp() has its own registry, so two apps can live in one process', async () => {
  ready();
  let second;
  try {
    second = await listen(state.mod.createApp());
  } catch (error) {
    assert.fail(`Calling createApp() a second time threw: ${error?.message}. Register metrics on a Registry created per app, not on the global default.`);
  }
  for (let i = 0; i < 5; i++) await send('/orders/77', { base: second });
  const mine = valueOf(await scrape(second), 'http_requests_total', { route: '/orders/:id', status_code: '200' });
  assert.equal(mine, 5, `The second app served 5 GET /orders/:id requests, but its own /metrics shows ${mine}.`);
});
