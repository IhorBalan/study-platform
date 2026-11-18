// Tests for the tracing. Run them with `npm test`.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, test } from 'node:test';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { startTracing } from '../src/tracing.ts';
import { createApp } from '../src/app.ts';

const exporter = new InMemorySpanExporter();
const provider = startTracing(exporter);
const received: (string | undefined)[] = [];
let pricing: Server;
let app: Server;
let base: string;

async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

before(async () => {
  // A fake pricing service that remembers the traceparent it was sent.
  pricing = createServer((req, res) => {
    received.push(req.headers.traceparent as string | undefined);
    if (req.url === '/prices/broken') {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ price: 2.5 }));
  });
  const pricingUrl = await listen(pricing);
  app = createApp({ pricingUrl }).listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

after(async () => {
  app.close();
  pricing.close();
  await provider.shutdown();
});

beforeEach(() => {
  exporter.reset();
  received.length = 0;
});

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(base + path, { headers });
  await res.text();
  await new Promise((resolve) => setTimeout(resolve, 30));
  return res;
}

const byName = (name: string) => exporter.getFinishedSpans().find((s) => s.name === name);

test('continues the incoming trace and passes it on to pricing', async () => {
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const res = await get('/quotes/abc?qty=2', { traceparent: `00-${traceId}-00f067aa0ba902b7-01` });
  assert.equal(res.status, 200);
  const server = byName('GET /quotes/:sku');
  const client = byName('fetch-price');
  assert.ok(server && client);
  assert.equal(server.kind, SpanKind.SERVER);
  assert.equal(server.spanContext().traceId, traceId);
  assert.equal(server.parentSpanContext?.spanId, '00f067aa0ba902b7');
  assert.equal(client.parentSpanContext?.spanId, server.spanContext().spanId);
  assert.equal(received[0], `00-${traceId}-${client.spanContext().spanId}-01`);
});

test('has a calculate-total child', async () => {
  await get('/quotes/abc?qty=3');
  const server = byName('GET /quotes/:sku');
  const total = byName('calculate-total');
  assert.equal(total?.parentSpanContext?.spanId, server?.spanContext().spanId);
});

test('records a failing pricing call as an error', async () => {
  const res = await get('/quotes/broken');
  assert.equal(res.status, 502);
  const client = byName('fetch-price');
  assert.equal(client?.status.code, SpanStatusCode.ERROR);
  assert.ok(client?.events.some((e) => e.name === 'exception'));
  assert.equal(byName('GET /quotes/:sku')?.status.code, SpanStatusCode.ERROR);
});
