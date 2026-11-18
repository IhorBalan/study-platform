// Tests for the tracing. Run them with `npm test`.
// Start tracing with an InMemorySpanExporter, run a fake pricing service, and read
// the finished spans back with exporter.getFinishedSpans().
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { startTracing } from '../src/tracing.ts';
import { createApp } from '../src/app.ts';

const exporter = new InMemorySpanExporter();
const provider = startTracing(exporter);
let pricing: Server;
let app: Server;
let base: string;

before(async () => {
  pricing = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ price: 2.5 }));
  });
  pricing.listen(0, '127.0.0.1');
  await new Promise((resolve) => pricing.once('listening', resolve));
  const pricingUrl = `http://127.0.0.1:${(pricing.address() as AddressInfo).port}`;
  app = createApp({ pricingUrl }).listen(0, '127.0.0.1');
  await new Promise((resolve) => app.once('listening', resolve));
  base = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

after(async () => {
  app.close();
  pricing.close();
  await provider.shutdown();
});

test('quotes a price', async () => {
  const res = await fetch(`${base}/quotes/abc?qty=2`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { sku: 'abc', qty: 2, unitPrice: 2.5, total: 5 });
});

// TODO: a test that the traceparent sent to pricing carries the incoming trace id
//       and the fetch-price span's id.
// TODO: a test that a failing pricing call leaves an ERROR status and an exception event.
