// Tests for the metrics. Run them with `npm test`.
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.ts';

let server: Server;
let base: string;

before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
});

/** Every sample of one metric, as { labels, value }. */
async function samples(name: string) {
  const text = await (await fetch(`${base}/metrics`)).text();
  const found: { labels: Record<string, string>; value: number }[] = [];
  for (const line of text.split('\n')) {
    const match = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)$/.exec(line);
    if (!match || match[1] !== name) continue;
    const labels: Record<string, string> = {};
    for (const [, key, value] of (match[2] ?? '').matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[key] = value;
    found.push({ labels, value: Number(match[3]) });
  }
  return found;
}

async function counterValue(route: string, status: string) {
  const all = await samples('http_requests_total');
  return all.find((s) => s.labels.route === route && s.labels.status_code === status)?.value ?? 0;
}

test('counts requests by route template and status', async () => {
  const before = await counterValue('/orders/:id', '200');
  await fetch(`${base}/orders/1`);
  await fetch(`${base}/orders/2`);
  assert.equal(await counterValue('/orders/:id', '200') - before, 2);
  const failed = await counterValue('/fail', '500');
  await fetch(`${base}/fail`);
  assert.equal(await counterValue('/fail', '500') - failed, 1);
});

test('route labels never contain raw paths', async () => {
  await fetch(`${base}/orders/12345`);
  await fetch(`${base}/random/abc-${Date.now()}`);
  const routes = new Set((await samples('http_requests_total')).map((s) => s.labels.route));
  for (const route of routes) assert.ok(!/\d/.test(route), `raw value in route label: ${route}`);
  assert.ok(routes.has('unmatched'));
});

test('slow requests land in the right histogram buckets', async () => {
  await fetch(`${base}/reports/1`);
  const buckets = (await samples('http_request_duration_seconds_bucket')).filter((s) => s.labels.route === '/reports/:id');
  assert.equal(buckets.find((s) => s.labels.le === '0.25')?.value, 0);
  assert.ok((buckets.find((s) => s.labels.le === '+Inf')?.value ?? 0) >= 1);
});
