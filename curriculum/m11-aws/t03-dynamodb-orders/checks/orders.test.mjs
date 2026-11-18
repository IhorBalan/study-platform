// Checks for "An order repository on DynamoDB". Node built-ins only; the AWS SDK comes from the
// submission's node_modules. Node runs src/orders.ts directly by stripping its types.
// The checks create their own table (named with AWS_RESOURCE_PREFIX) and delete it in after().
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, test } from 'node:test';
import { pathToFileURL } from 'node:url';

const dir = path.resolve(process.env.SUBMISSION_DIR ?? '.');
const TABLE = `${process.env.AWS_RESOURCE_PREFIX ?? 'check-local-'}t03-${randomUUID().slice(0, 8)}`;
const requireFromSubmission = createRequire(path.join(dir, 'package.json'));

let ddb;
let raw;
let doc;
let tableCreated = false;
/** Every command the repository sends, across all tests. */
const sent = [];

after(async () => {
  if (raw && tableCreated) await raw.send(new ddb.DeleteTableCommand({ TableName: TABLE })).catch(() => undefined);
  raw?.destroy();
});

/** The table from src/table.ts, created here so a changed copy in the submission cannot affect the checks. */
async function createTable() {
  await raw.send(
    new ddb.CreateTableCommand({
      TableName: TABLE,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: ['pk', 'sk', 'gsi1pk', 'gsi1sk'].map((name) => ({ AttributeName: name, AttributeType: 'S' })),
      KeySchema: [
        { AttributeName: 'pk', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'gsi1',
          KeySchema: [
            { AttributeName: 'gsi1pk', KeyType: 'HASH' },
            { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
          ],
          Projection: { ProjectionType: 'ALL' },
        },
      ],
    }),
  );
  tableCreated = true;
  await ddb.waitUntilTableExists({ client: raw, maxWaitTime: 30, minDelay: 1 }, { TableName: TABLE });
  await raw.send(new ddb.UpdateTimeToLiveCommand({ TableName: TABLE, TimeToLiveSpecification: { Enabled: true, AttributeName: 'expiresAt' } }));
}

let loaded;
async function load() {
  assert.ok(process.env.AWS_ENDPOINT_URL, 'AWS_ENDPOINT_URL is not set for the check run. Start the emulator with `pnpm lab up aws`.');
  const file = path.join(dir, 'src', 'orders.ts');
  assert.ok(existsSync(file), 'src/orders.ts is missing from the submission.');
  loaded ??= (async () => {
    const mod = await import(pathToFileURL(file).href);
    ddb = requireFromSubmission('@aws-sdk/client-dynamodb');
    const lib = requireFromSubmission('@aws-sdk/lib-dynamodb');
    raw = new ddb.DynamoDBClient({});
    doc = lib.DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    await createTable();
    return mod;
  })();
  const mod = await loaded;
  for (const name of ['OrderRepository', 'OrderExistsError', 'OrderNotFoundError', 'VersionConflictError']) {
    assert.equal(typeof mod[name], 'function', `src/orders.ts must export a class named ${name}.`);
  }
  return mod;
}

/** A repository whose client records every command and forwards it to the real document client. */
async function repository(now) {
  const mod = await load();
  const client = {
    send(command, options) {
      sent.push(command?.constructor?.name);
      return doc.send(command, options);
    },
  };
  return { mod, repo: new mod.OrderRepository({ client, tableName: TABLE, ...(now ? { now } : {}) }) };
}

let seq = 0;
const runTag = randomUUID().slice(0, 6);
function newOrder(customerId, overrides = {}) {
  seq++;
  return {
    customerId: `${runTag}-${customerId}`,
    orderId: `01JD${String(seq).padStart(6, '0')}`,
    createdAt: new Date(Date.UTC(2026, 10, 2, 9, 0, 0) + seq * 1000).toISOString(),
    status: 'pending',
    totalCents: 1250 * seq,
    ...overrides,
  };
}

async function allPages(list, limit) {
  const pages = [];
  let cursor = null;
  for (let i = 0; i < 20; i++) {
    const page = await list({ limit, cursor });
    assert.ok(Array.isArray(page?.items), 'A list method should return { items, nextCursor }.');
    pages.push(page.items);
    cursor = page.nextCursor;
    if (cursor === null || cursor === undefined) return pages;
    assert.equal(typeof cursor, 'string', `nextCursor should be a string or null, got ${JSON.stringify(cursor)}.`);
  }
  assert.fail('Paging did not end after 20 pages. nextCursor should become null after the last page.');
}

test('typechecks: tsc reports no type errors', () => {
  const tsc = path.join(dir, 'node_modules', '.bin', 'tsc');
  assert.ok(existsSync(path.join(dir, 'tsconfig.json')), 'tsconfig.json is missing from the submission.');
  assert.ok(existsSync(tsc), 'node_modules/.bin/tsc was not found in the submission directory.');
  const result = spawnSync(tsc, ['-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'], { cwd: dir, encoding: 'utf8', timeout: 60_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  assert.equal(result.status, 0, `tsc found errors:\n${output.slice(0, 3000)}`);
});

test('create-and-get: create returns the order at version 1, and get returns exactly that order', async () => {
  const { repo } = await repository();
  const input = newOrder('alice');
  const created = await repo.create(input);
  assert.deepEqual(created, { ...input, version: 1 }, 'create should return the order with version 1 and no storage attributes (pk, sk, ...).');
  const fetched = await repo.get(input.customerId, input.orderId);
  assert.deepEqual(fetched, { ...input, version: 1 }, 'get should return the stored order with only its domain fields.');
  assert.equal(await repo.get(input.customerId, '01JDmissing'), null, 'get should return null for an order that does not exist.');
  assert.equal(await repo.get(`${runTag}-someone-else`, input.orderId), null, 'get should not find an order under another customer.');
});

test('no-overwrite: creating an existing order throws OrderExistsError and keeps the original', async () => {
  const { mod, repo } = await repository();
  const input = newOrder('bob');
  await repo.create(input);
  await assert.rejects(
    () => repo.create({ ...input, totalCents: 1, status: 'cancelled' }),
    (error) => error instanceof mod.OrderExistsError,
    'Creating an order whose customerId and orderId already exist should throw OrderExistsError.',
  );
  const stored = await repo.get(input.customerId, input.orderId);
  assert.deepEqual(stored, { ...input, version: 1 }, 'The second create overwrote the first order.');
});

test('list-by-customer: a customer’s orders, newest first, paginated with an opaque cursor, and nobody else’s', async () => {
  const { repo } = await repository();
  const mine = [];
  for (let i = 0; i < 7; i++) {
    mine.push((await repo.create(newOrder('carol'))).orderId);
    if (i % 3 === 0) await repo.create(newOrder('dave'));
  }
  const customerId = `${runTag}-carol`;
  const pages = await allPages((opts) => repo.listByCustomer(customerId, opts), 3);
  for (const page of pages) assert.ok(page.length <= 3, `A page held ${page.length} orders with limit 3.`);
  assert.ok(pages.length >= 3, `7 orders with limit 3 should take at least 3 pages, got ${pages.length}.`);
  const ids = pages.flat().map((o) => o.orderId);
  assert.deepEqual(ids, [...mine].reverse(), 'listByCustomer should return all of the customer’s orders exactly once, newest (highest orderId) first.');
  assert.ok(pages.flat().every((o) => o.customerId === customerId), 'listByCustomer returned another customer’s order.');
  const first = await repo.listByCustomer(customerId);
  assert.equal(first.items.length, 7, 'Without options, listByCustomer should return up to 20 orders.');
  assert.equal(first.nextCursor, null, 'nextCursor should be null when there are no more orders.');
});

test('list-by-status: the status index returns orders oldest first and follows status changes', async () => {
  const { repo } = await repository();
  const status = 'shipped';
  const before = (await allPages((opts) => repo.listByStatus(status, opts), 50)).flat().map((o) => o.orderId);
  const made = [];
  for (let i = 0; i < 4; i++) made.push(await repo.create(newOrder(`erin${i}`, { status: 'paid' })));
  for (const o of made.slice(0, 3)) await repo.updateStatus(o.customerId, o.orderId, status, 1);

  const shipped = (await allPages((opts) => repo.listByStatus(status, opts), 2)).flat();
  const newIds = shipped.map((o) => o.orderId).filter((id) => !before.includes(id));
  assert.deepEqual(newIds, made.slice(0, 3).map((o) => o.orderId), 'listByStatus("shipped") should list the three shipped orders, oldest createdAt first.');
  assert.ok(shipped.every((o) => o.status === status), 'listByStatus returned an order in another status.');
  const createdAts = shipped.map((o) => o.createdAt);
  assert.deepEqual(createdAts, [...createdAts].sort(), 'listByStatus should be ordered by createdAt, oldest first.');

  const paid = (await allPages((opts) => repo.listByStatus('paid', opts), 50)).flat().map((o) => o.orderId);
  assert.ok(paid.includes(made[3].orderId), 'The order still in "paid" should be listed under paid.');
  for (const o of made.slice(0, 3)) {
    assert.ok(!paid.includes(o.orderId), 'An order moved to "shipped" is still listed under "paid". Update the index keys together with the status.');
  }
});

test('optimistic-locking: updateStatus succeeds only at the expected version and bumps it', async () => {
  const { mod, repo } = await repository();
  const input = newOrder('frank');
  await repo.create(input);
  const paid = await repo.updateStatus(input.customerId, input.orderId, 'paid', 1);
  assert.deepEqual(paid, { ...input, status: 'paid', version: 2 }, 'updateStatus should return the updated order with version 2.');

  await assert.rejects(
    () => repo.updateStatus(input.customerId, input.orderId, 'cancelled', 1),
    (error) => error instanceof mod.VersionConflictError,
    'An update with a stale version should throw VersionConflictError.',
  );
  assert.deepEqual(await repo.get(input.customerId, input.orderId), { ...input, status: 'paid', version: 2 }, 'A rejected update changed the order.');

  const results = await Promise.allSettled([
    repo.updateStatus(input.customerId, input.orderId, 'shipped', 2),
    repo.updateStatus(input.customerId, input.orderId, 'cancelled', 2),
  ]);
  const won = results.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1, `Two concurrent updates at version 2: exactly one should succeed, ${won.length} did.`);
  assert.ok(
    results.some((r) => r.status === 'rejected' && r.reason instanceof mod.VersionConflictError),
    'The losing concurrent update should throw VersionConflictError.',
  );
  assert.equal((await repo.get(input.customerId, input.orderId)).version, 3);

  await assert.rejects(
    () => repo.updateStatus(input.customerId, '01JDnope', 'paid', 1),
    (error) => error instanceof mod.OrderNotFoundError,
    'Updating an order that does not exist should throw OrderNotFoundError.',
  );
  assert.equal(await repo.get(input.customerId, '01JDnope'), null, 'updateStatus created an order that did not exist.');
});

test('expired-hidden: orders past expiresAt are not returned, even before DynamoDB deletes them', async () => {
  const { repo } = await repository();
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expired = newOrder('gina', { expiresAt: nowSeconds - 3600 });
  const live = newOrder('gina', { expiresAt: nowSeconds + 3600 });
  const plain = newOrder('gina');
  for (const o of [expired, live, plain]) await repo.create(o);

  assert.equal(await repo.get(expired.customerId, expired.orderId), null, 'get returned an order whose expiresAt has passed.');
  assert.deepEqual(await repo.get(live.customerId, live.orderId), { ...live, version: 1 }, 'An order expiring in the future should be returned, with its expiresAt.');
  const listed = (await allPages((opts) => repo.listByCustomer(expired.customerId, opts), 10)).flat().map((o) => o.orderId);
  assert.deepEqual(listed, [plain.orderId, live.orderId], 'listByCustomer should leave out the expired order.');
  const pending = (await allPages((opts) => repo.listByStatus('pending', opts), 100)).flat().map((o) => o.orderId);
  assert.ok(!pending.includes(expired.orderId), 'listByStatus should leave out the expired order.');
  await assert.rejects(
    () => repo.updateStatus(expired.customerId, expired.orderId, 'paid', 1),
    'Updating an expired order should fail as if it did not exist.',
  );
});

test('no-scans: every read is a GetItem or a Query; the repository never scans the table', async () => {
  const { repo } = await repository();
  const o = await repo.create(newOrder('hank'));
  await repo.get(o.customerId, o.orderId);
  await repo.listByCustomer(o.customerId);
  await repo.listByStatus('pending', { limit: 5 });
  assert.ok(sent.length > 0, 'The repository sent no commands through the client it was given.');
  const scans = sent.filter((name) => /Scan/.test(name ?? ''));
  assert.equal(scans.length, 0, `The repository sent ${scans.length} Scan command(s). Design the keys so every read is a GetItem or a Query.`);
});
