// Tests for the order repository against the lab emulator. Run them with `npm test`.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createOrdersTable, deleteOrdersTable } from '../src/table.ts';
import { OrderExistsError, OrderRepository, VersionConflictError, type NewOrder } from '../src/orders.ts';

const raw = new DynamoDBClient({});
const client = DynamoDBDocumentClient.from(raw);
const tableName = `${process.env.AWS_RESOURCE_PREFIX ?? 'dev-'}orders-${randomUUID().slice(0, 8)}`;
const repo = new OrderRepository({ client, tableName });

before(async () => createOrdersTable(raw, tableName));
after(async () => {
  await deleteOrdersTable(raw, tableName);
  raw.destroy();
});

let seq = 0;
function order(customerId: string, overrides: Partial<NewOrder> = {}): NewOrder {
  seq++;
  return {
    customerId,
    orderId: `ord-${String(seq).padStart(4, '0')}`,
    createdAt: new Date(Date.UTC(2026, 10, 1, 12, 0, seq)).toISOString(),
    status: 'pending',
    totalCents: 1000 * seq,
    ...overrides,
  };
}

test('create stores an order at version 1 and get returns it', async () => {
  const input = order('c-get');
  const created = await repo.create(input);
  assert.deepEqual(created, { ...input, version: 1 });
  assert.deepEqual(await repo.get('c-get', input.orderId), { ...input, version: 1 });
  assert.equal(await repo.get('c-get', 'ord-missing'), null);
});

test('creating the same order twice fails and keeps the first one', async () => {
  const input = order('c-dup');
  await repo.create(input);
  await assert.rejects(() => repo.create({ ...input, totalCents: 1 }), OrderExistsError);
  assert.equal((await repo.get('c-dup', input.orderId))?.totalCents, input.totalCents);
});

test('a stale version is rejected and changes nothing', async () => {
  const input = order('c-lock');
  await repo.create(input);
  const paid = await repo.updateStatus('c-lock', input.orderId, 'paid', 1);
  assert.equal(paid.version, 2);
  await assert.rejects(() => repo.updateStatus('c-lock', input.orderId, 'cancelled', 1), VersionConflictError);
  const stored = await repo.get('c-lock', input.orderId);
  assert.equal(stored?.status, 'paid');
  assert.equal(stored?.version, 2);
});

test('a customer’s orders come back newest first, in pages', async () => {
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await repo.create(order('c-list'))).orderId);
  await repo.create(order('c-other'));
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await repo.listByCustomer('c-list', { limit: 2, cursor });
    assert.ok(page.items.length <= 2);
    seen.push(...page.items.map((o) => o.orderId));
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [...ids].reverse());
});

test('listByStatus follows a status change', async () => {
  const input = order('c-status');
  await repo.create(input);
  await repo.updateStatus('c-status', input.orderId, 'shipped', 1);
  const shipped = await repo.listByStatus('shipped');
  assert.ok(shipped.items.some((o) => o.orderId === input.orderId));
  const pending = await repo.listByStatus('pending', { limit: 100 });
  assert.ok(!pending.items.some((o) => o.orderId === input.orderId));
});

test('an expired order is not returned', async () => {
  const input = order('c-ttl', { expiresAt: Math.floor(Date.now() / 1000) - 60 });
  await repo.create(input);
  assert.equal(await repo.get('c-ttl', input.orderId), null);
  assert.deepEqual((await repo.listByCustomer('c-ttl')).items, []);
});
