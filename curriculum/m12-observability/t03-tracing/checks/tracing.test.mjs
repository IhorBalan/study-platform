// Checks for "Trace a request across two services". Node built-ins only; the OpenTelemetry
// packages and express come from the submission's node_modules. Node runs the .ts files
// directly by stripping their types. The checks hand startTracing() an InMemorySpanExporter
// and play the pricing service themselves, so they see every span and every outgoing header.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const KIND = { INTERNAL: 0, SERVER: 1, CLIENT: 2 };
const STATUS = { UNSET: 0, OK: 1, ERROR: 2 };
const state = { bootError: null, exporter: null, provider: null, app: null, pricing: null, base: null };
/** Requests the fake pricing service received: { url, traceparent }. */
const pricingCalls = [];

async function importFromSubmission(specifier) {
  const require = createRequire(path.join(dir, 'package.json'));
  return import(pathToFileURL(require.resolve(specifier)).href);
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  try {
    for (const file of ['tracing.ts', 'app.ts']) {
      if (!existsSync(path.join(dir, 'src', file))) throw new Error(`src/${file} is missing from the submission.`);
    }
    const { InMemorySpanExporter } = await importFromSubmission('@opentelemetry/sdk-trace-base');
    const tracing = await import(pathToFileURL(path.join(dir, 'src', 'tracing.ts')).href);
    if (typeof tracing.startTracing !== 'function') throw new Error('src/tracing.ts must export a function named startTracing.');
    state.exporter = new InMemorySpanExporter();
    state.provider = tracing.startTracing(state.exporter);

    state.pricing = http.createServer((req, res) => {
      pricingCalls.push({ url: req.url, traceparent: req.headers.traceparent });
      if (req.url === '/prices/boom') {
        res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"database down"}');
      } else if (req.url === '/prices/missing') {
        res.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ sku: req.url.split('/').pop(), price: 4 }));
      }
    });
    const pricingUrl = await listen(state.pricing);

    const appModule = await import(pathToFileURL(path.join(dir, 'src', 'app.ts')).href);
    if (typeof appModule.createApp !== 'function') throw new Error('src/app.ts must export a function named createApp.');
    state.app = appModule.createApp({ pricingUrl }).listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      state.app.once('listening', resolve);
      state.app.once('error', reject);
    });
    state.base = `http://127.0.0.1:${state.app.address().port}`;
  } catch (error) {
    state.bootError = String(error?.stack ?? error).slice(0, 1500);
  }
});

after(async () => {
  for (const server of [state.app, state.pricing]) {
    server?.closeAllConnections?.();
    server?.close();
  }
  await state.provider?.shutdown?.().catch(() => {});
});

const hex = (bytes) => randomBytes(bytes).toString('hex');
const show = (span) =>
  span ? `${span.name} (kind ${span.kind}, status ${span.status?.code}, parent ${span.parentSpanContext?.spanId ?? 'none'})` : 'none';
const describe = (spans) => (spans.length ? spans.map(show).join('; ') : 'no spans at all');

/** Sends one request after clearing the exporter, and waits until its server span has ended. */
async function traced(pathname, headers = {}) {
  assert.ok(!state.bootError, `The app did not start: ${state.bootError}`);
  state.exporter.reset();
  pricingCalls.length = 0;
  const res = await fetch(state.base + pathname, { headers, signal: AbortSignal.timeout(5000) });
  const body = await res.text();
  const deadline = Date.now() + 1000;
  let spans = [];
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    spans = state.exporter.getFinishedSpans();
    if (spans.some((s) => s.kind === KIND.SERVER)) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  spans = state.exporter.getFinishedSpans();
  return { status: res.status, body, spans, server: spans.filter((s) => s.kind === KIND.SERVER) };
}

function oneServerSpan(result, what) {
  assert.equal(
    result.server.length,
    1,
    `${what}: expected exactly one span of kind SERVER, found ${result.server.length}. Spans: ${describe(result.spans)}`,
  );
  return result.server[0];
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc -p tsconfig.json failed:\n${output.slice(0, 3000)}`);
});

test('provider-setup: startTracing() sends finished spans to the given exporter, with service.name "quote-api"', async () => {
  const result = await traced('/quotes/widget?qty=2');
  assert.equal(result.status, 200, `GET /quotes/widget?qty=2: expected 200, got ${result.status}: ${result.body.slice(0, 200)}`);
  assert.deepEqual(JSON.parse(result.body), { sku: 'widget', qty: 2, unitPrice: 4, total: 8 }, 'The quote itself must not change.');
  assert.ok(result.spans.length > 0, 'No spans reached the exporter passed to startTracing(). Register a provider whose span processor exports to it.');
  for (const span of result.spans) {
    assert.equal(span.resource?.attributes?.['service.name'], 'quote-api', `Span "${span.name}" has service.name ${JSON.stringify(span.resource?.attributes?.['service.name'])}; expected "quote-api" on the provider's resource.`);
  }
});

test('server-span: each request gets one SERVER span named after the route, with HTTP attributes', async () => {
  const result = await traced('/quotes/gadget?qty=1');
  const span = oneServerSpan(result, 'GET /quotes/gadget');
  assert.equal(span.name, 'GET /quotes/:sku', `The server span should be named "GET /quotes/:sku" (method and route template), found "${span.name}"`);
  assert.equal(span.attributes['http.request.method'], 'GET', 'The server span needs http.request.method = "GET".');
  assert.equal(span.attributes['http.route'], '/quotes/:sku', 'The server span needs http.route = "/quotes/:sku".');
  assert.equal(span.attributes['http.response.status_code'], 200, `The server span needs http.response.status_code = 200 as a number, found ${JSON.stringify(span.attributes['http.response.status_code'])}`);
  assert.notEqual(span.status.code, STATUS.ERROR, 'A 200 response must not mark the server span as an error.');

  const health = await traced('/health');
  oneServerSpan(health, 'GET /health');
});

test('child-spans: fetch-price (CLIENT) and calculate-total (INTERNAL) are children of the server span', async () => {
  const result = await traced('/quotes/gizmo?qty=12');
  const server = oneServerSpan(result, 'GET /quotes/gizmo');
  const serverId = server.spanContext().spanId;
  const traceId = server.spanContext().traceId;
  for (const [name, kind, kindName] of [
    ['fetch-price', KIND.CLIENT, 'CLIENT'],
    ['calculate-total', KIND.INTERNAL, 'INTERNAL'],
  ]) {
    const matches = result.spans.filter((s) => s.name === name);
    assert.equal(matches.length, 1, `Expected one span named "${name}", found ${matches.length}. Spans: ${describe(result.spans)}`);
    const [span] = matches;
    assert.equal(span.kind, kind, `"${name}" should be of kind ${kindName}, found kind ${span.kind}`);
    assert.equal(span.spanContext().traceId, traceId, `"${name}" belongs to another trace than the server span. Start it while the server span is active.`);
    assert.equal(span.parentSpanContext?.spanId, serverId, `"${name}" should be a child of the server span, but its parent is ${span.parentSpanContext?.spanId ?? 'none'}`);
  }
  const fetchSpan = result.spans.find((s) => s.name === 'fetch-price');
  assert.equal(fetchSpan.attributes['http.response.status_code'], 200, 'fetch-price needs http.response.status_code from the pricing response.');
});

test('honours-traceparent: an incoming traceparent is continued; without one a new trace starts', async () => {
  const traceId = hex(16);
  const parentId = hex(8);
  const continued = await traced('/quotes/thing', { traceparent: `00-${traceId}-${parentId}-01` });
  const server = oneServerSpan(continued, 'GET /quotes/thing with a traceparent');
  assert.equal(server.spanContext().traceId, traceId, 'With an incoming traceparent, the server span must use its trace id.');
  assert.equal(server.parentSpanContext?.spanId, parentId, 'With an incoming traceparent, the server span\'s parent must be the span id from the header.');
  assert.equal(server.parentSpanContext?.isRemote, true, 'The parent from the traceparent header must be a remote span context (propagation.extract gives you one).');

  const fresh = await traced('/quotes/thing');
  const root = oneServerSpan(fresh, 'GET /quotes/thing without a traceparent');
  assert.equal(root.parentSpanContext, undefined, 'Without a traceparent, the server span must be a root span.');
  assert.notEqual(root.spanContext().traceId, traceId, 'Without a traceparent, a new trace must start; the previous trace id leaked into this request.');

  const unsampledTrace = hex(16);
  const unsampled = await traced('/quotes/thing', { traceparent: `00-${unsampledTrace}-${hex(8)}-00` });
  assert.equal(unsampled.status, 200, `A request whose caller did not sample must still work, got ${unsampled.status}`);
  assert.equal(unsampled.spans.length, 0, `The caller's traceparent said "not sampled" (flags 00), so no spans should be recorded. Found: ${describe(unsampled.spans)}. Keep the default parent-based sampler.`);
  const header = pricingCalls[0]?.traceparent ?? '';
  assert.match(header, new RegExp(`^00-${unsampledTrace}-[0-9a-f]{16}-00$`), `Even when not sampled, the trace id and the "not sampled" flag must be passed on to pricing. Pricing received traceparent ${JSON.stringify(header)}`);
});

test('propagates: the call to pricing carries a traceparent naming the fetch-price span', async () => {
  const traceId = hex(16);
  const result = await traced('/quotes/sprocket?qty=3', { traceparent: `00-${traceId}-${hex(8)}-01` });
  assert.equal(pricingCalls.length, 1, `Expected one call to the pricing service, found ${pricingCalls.length}`);
  const header = pricingCalls[0].traceparent;
  assert.ok(header, 'The request to the pricing service had no traceparent header. Inject the active context into the outgoing headers.');
  const fetchSpan = result.spans.find((s) => s.name === 'fetch-price');
  assert.ok(fetchSpan, `No fetch-price span was recorded. Spans: ${describe(result.spans)}`);
  const expected = `00-${traceId}-${fetchSpan.spanContext().spanId}-01`;
  assert.equal(header, expected, `Pricing should receive traceparent ${expected} (same trace, parent = the fetch-price span), got ${header}`);
});

test('records-errors: a failing pricing call is recorded on the spans; a 404 is not a server error', async () => {
  const failed = await traced('/quotes/boom');
  assert.equal(failed.status, 502, `When pricing answers 500, GET /quotes/boom should answer 502, got ${failed.status}`);
  const fetchSpan = failed.spans.find((s) => s.name === 'fetch-price');
  assert.ok(fetchSpan, `No fetch-price span for the failed call. Spans: ${describe(failed.spans)}`);
  assert.equal(fetchSpan.status.code, STATUS.ERROR, 'fetch-price must have status ERROR when pricing fails.');
  assert.ok(fetchSpan.events.some((e) => e.name === 'exception'), 'fetch-price needs an "exception" event. span.recordException(error) adds one with the message and stack.');
  const server = oneServerSpan(failed, 'GET /quotes/boom');
  assert.equal(server.status.code, STATUS.ERROR, 'The server span of a 502 response must have status ERROR.');
  assert.equal(server.attributes['http.response.status_code'], 502, 'The server span must record http.response.status_code = 502.');

  const missing = await traced('/quotes/missing');
  assert.equal(missing.status, 404, `When pricing answers 404, GET /quotes/missing should answer 404, got ${missing.status}`);
  const notFound = oneServerSpan(missing, 'GET /quotes/missing');
  assert.notEqual(notFound.status.code, STATUS.ERROR, 'A 404 is the client\'s mistake. Leave the server span\'s status unset for 4xx responses.');
  assert.equal(notFound.attributes['http.response.status_code'], 404, 'The server span must record http.response.status_code = 404.');
});
