// Tests for the order repository against the lab emulator. Run them with `npm test`.
// The table name starts with AWS_RESOURCE_PREFIX, and the table is deleted in after().
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createOrdersTable, deleteOrdersTable } from '../src/table.ts';
import { OrderRepository, type NewOrder } from '../src/orders.ts';

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
  assert.deepEqual(await repo.create(input), { ...input, version: 1 });
  assert.deepEqual(await repo.get('c-get', input.orderId), { ...input, version: 1 });
});

// TODO: creating the same order twice throws OrderExistsError and keeps the first one.
// TODO: an update with a stale version throws VersionConflictError and changes nothing.
// TODO: a customer's orders come back newest first, across several pages.
// TODO: listByStatus follows a status change.
// TODO: an expired order is not returned.
