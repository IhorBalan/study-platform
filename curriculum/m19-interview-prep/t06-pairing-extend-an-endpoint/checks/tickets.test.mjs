// Checks for the pairing task: a list endpoint with a filter, sorting and cursor pagination.
// Node built-ins only.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const submissionDir = process.env.SUBMISSION_DIR;
assert.ok(submissionDir, 'SUBMISSION_DIR must be set');

const STATUSES = ['open', 'pending', 'closed'];
const T0 = Date.parse('2026-10-05T07:00:00Z');

/** Tickets with many ties: three share each timestamp, and priorities repeat. Ids are shuffled. */
function makeTickets(count) {
  const tickets = Array.from({ length: count }, (_, i) => ({
    // Ids start at 101, so a check can add a ticket with a lower id.
    id: i + 101,
    title: `Ticket ${i + 101}`,
    status: STATUSES[(i * 7) % 3],
    priority: ((i * 5) % 4) + 1,
    createdAt: new Date(T0 + Math.floor(((i * 11) % count) / 3) * 60_000).toISOString(),
  }));
  // The order of the input must not matter.
  return tickets.map((_, i) => tickets[(i * 13) % count]);
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function expectedOrder(tickets, sort = '-createdAt', status) {
  const field = sort.replace(/^-/, '');
  const dir = sort.startsWith('-') ? -1 : 1;
  return tickets
    .filter((t) => status === undefined || t.status === status)
    .sort((a, b) => dir * (cmp(a[field], b[field]) || cmp(a.id, b.id)))
    .map((t) => t.id);
}

let core;
async function loadCore() {
  core ??= import(pathToFileURL(path.join(submissionDir, 'tickets.mjs')).href);
  const mod = await core;
  assert.equal(typeof mod.listTickets, 'function', 'tickets.mjs must export listTickets');
  assert.equal(typeof mod.ValidationError, 'function', 'tickets.mjs must export the class ValidationError');
  return mod;
}

function expectThrow(fn, ErrorType, what) {
  let outcome;
  try {
    const value = fn();
    outcome = `it returned ${JSON.stringify(value)?.slice(0, 200)}`;
  } catch (error) {
    if (error instanceof ErrorType) return error;
    outcome = `it threw ${error?.name ?? typeof error}: ${error?.message ?? error}`;
  }
  assert.fail(`${what}: expected a ${ErrorType.name}, but ${outcome}`);
}

function page(listTickets, tickets, options, what) {
  const result = listTickets(tickets, options);
  assert.ok(result && Array.isArray(result.items), `${what}: expected { items, nextCursor } with items as an array`);
  assert.ok(
    result.nextCursor === null || (typeof result.nextCursor === 'string' && result.nextCursor !== ''),
    `${what}: nextCursor must be null or a non-empty string, got ${JSON.stringify(result.nextCursor)}`,
  );
  return result;
}
const ids = (result) => result.items.map((t) => t.id);

/** Follows nextCursor to the end and returns the ids seen and the number of pages. */
function walk(listTickets, tickets, options, what) {
  const seen = [];
  let cursor;
  for (let pages = 1; pages <= 500; pages++) {
    const result = page(listTickets, tickets, cursor === undefined ? options : { ...options, cursor }, what);
    assert.ok(
      result.items.length <= (options.limit ?? 20),
      `${what}: a page had ${result.items.length} items, more than the limit`,
    );
    seen.push(...ids(result));
    if (result.nextCursor === null) return { seen, pages };
    assert.ok(result.items.length > 0, `${what}: a page with a nextCursor had no items`);
    cursor = result.nextCursor;
  }
  assert.fail(`${what}: nextCursor never became null after 500 pages`);
}

test('filter: status keeps only tickets in that status, and an unknown status is rejected', async () => {
  const { listTickets, ValidationError } = await loadCore();
  const tickets = makeTickets(18);
  const before = structuredClone(tickets);
  for (const status of STATUSES) {
    const result = page(listTickets, tickets, { status, limit: 100 }, `status ${status}`);
    assert.ok(result.items.length > 0, `status ${status}: expected some tickets, got none`);
    assert.deepEqual(
      [...ids(result)].sort((a, b) => a - b),
      expectedOrder(tickets, 'createdAt', status).sort((a, b) => a - b),
      `status ${status}: the wrong set of tickets came back`,
    );
    const item = result.items[0];
    for (const key of ['id', 'title', 'status', 'priority', 'createdAt']) {
      assert.ok(key in item, `Each item must keep the ticket's fields; "${key}" is missing`);
    }
  }
  assert.equal(page(listTickets, tickets, { limit: 100 }, 'no status').items.length, 18, 'Without a status every ticket must come back');
  for (const status of ['done', 'OPEN', 'open,closed', 1]) {
    expectThrow(() => listTickets(tickets, { status }), ValidationError, `status ${JSON.stringify(status)}`);
  }
  assert.deepEqual(tickets, before, 'listTickets must not change the array it is given');
});

test('sort: the four sorts order by the field with ties by id, newest first is the default, an unknown sort is rejected', async () => {
  const { listTickets, ValidationError } = await loadCore();
  const tickets = makeTickets(30);
  for (const sort of ['createdAt', '-createdAt', 'priority', '-priority']) {
    assert.deepEqual(
      ids(page(listTickets, tickets, { sort, limit: 100 }, `sort ${sort}`)),
      expectedOrder(tickets, sort),
      `sort ${sort}: wrong order. Ties are broken by id in the same direction as the sort.`,
    );
  }
  assert.deepEqual(
    ids(page(listTickets, tickets, { limit: 100 }, 'default sort')),
    expectedOrder(tickets, '-createdAt'),
    'Without a sort the newest ticket must come first, ties by id descending',
  );
  assert.deepEqual(
    ids(page(listTickets, tickets, { sort: 'priority', status: 'open', limit: 100 }, 'sort with status')),
    expectedOrder(tickets, 'priority', 'open'),
    'sort and status together: wrong order or set',
  );
  for (const sort of ['title', 'id', '+priority', '--priority', 'createdat']) {
    expectThrow(() => listTickets(tickets, { sort }), ValidationError, `sort ${JSON.stringify(sort)}`);
  }
});

test('limit: the default is 20, whole numbers from 1 to 100 are accepted and everything else is rejected', async () => {
  const { listTickets, ValidationError } = await loadCore();
  const tickets = makeTickets(130);
  assert.equal(page(listTickets, tickets, {}, 'no limit').items.length, 20, 'Without a limit a page has 20 tickets');
  assert.equal(page(listTickets, tickets, undefined, 'no options').items.length, 20, 'listTickets(tickets) with no options must work and return 20 tickets');
  for (const limit of [1, 7, 100]) {
    const result = page(listTickets, tickets, { limit }, `limit ${limit}`);
    assert.equal(result.items.length, limit, `limit ${limit}: got ${result.items.length} tickets`);
    assert.deepEqual(ids(result), expectedOrder(tickets).slice(0, limit), `limit ${limit}: the page must be the start of the sorted list`);
  }
  for (const limit of [0, -1, 101, 1.5, Number.NaN, Infinity, '10']) {
    expectThrow(() => listTickets(tickets, { limit }), ValidationError, `limit ${JSON.stringify(limit) ?? String(limit)}`);
  }
});

test('pagination: following nextCursor returns every ticket once in order, the last page has null, a broken cursor is rejected', async () => {
  const { listTickets, ValidationError } = await loadCore();
  const tickets = makeTickets(47);
  const cases = [
    [{ limit: 5 }, 10],
    [{ limit: 1, sort: 'priority' }, 47],
    [{ limit: 4, sort: '-priority', status: 'open' }, null],
    [{ limit: 6, sort: 'createdAt', status: 'closed' }, null],
    [{ limit: 100 }, 1],
  ];
  for (const [options, pages] of cases) {
    const what = `walking with ${JSON.stringify(options)}`;
    const result = walk(listTickets, tickets, options, what);
    assert.deepEqual(result.seen, expectedOrder(tickets, options.sort, options.status), `${what}: the pages together must be the whole sorted list, each ticket once`);
    if (pages !== null) assert.equal(result.pages, pages, `${what}: expected ${pages} pages, got ${result.pages}`);
  }

  // A list that is an exact multiple of the limit must not end with a cursor to an empty page.
  const even = makeTickets(12);
  const exact = walk(listTickets, even, { limit: 4 }, 'walking 12 tickets with limit 4');
  assert.equal(exact.pages, 3, `12 tickets with limit 4 are 3 pages, but the walk took ${exact.pages}. The last full page must have nextCursor null.`);
  assert.equal(page(listTickets, [], {}, 'an empty list').nextCursor, null, 'An empty list has no next page');

  const junk = ['garbage!!', Buffer.from('hello').toString('base64url'), Buffer.from('{"a":1}').toString('base64url'), 42];
  for (const cursor of junk) {
    expectThrow(() => listTickets(tickets, { cursor }), ValidationError, `cursor ${JSON.stringify(cursor)}`);
  }
});

test('stable: tickets created or deleted between two pages cause no skipped and no repeated ticket', async () => {
  const { listTickets } = await loadCore();
  for (const sort of ['-createdAt', 'createdAt', 'priority', '-priority']) {
    const tickets = makeTickets(24);
    const order = expectedOrder(tickets, sort);
    const first = page(listTickets, tickets, { sort, limit: 6 }, `sort ${sort}, first page`);
    assert.deepEqual(ids(first), order.slice(0, 6), `sort ${sort}: wrong first page`);
    assert.notEqual(first.nextCursor, null, `sort ${sort}: 24 tickets with limit 6 must have a next page`);

    // Between the two calls: the last ticket of the first page is deleted, and two new tickets
    // appear that sort before everything else. The numbers differ on purpose, so the two
    // changes do not cancel each other out for an offset.
    const gone = new Set([order[5]]);
    const edge = sort.startsWith('-')
      ? { priority: 4, createdAt: new Date(T0 + 86_400_000).toISOString() }
      : { priority: 1, createdAt: new Date(T0 - 86_400_000).toISOString() };
    const changed = [
      { id: sort.startsWith('-') ? 9001 : 1, title: 'New A', status: 'open', ...edge },
      ...tickets.filter((t) => !gone.has(t.id)),
      { id: sort.startsWith('-') ? 9002 : 2, title: 'New B', status: 'open', ...edge },
    ];
    const second = page(listTickets, changed, { sort, limit: 6, cursor: first.nextCursor }, `sort ${sort}, second page`);
    assert.deepEqual(
      ids(second),
      order.slice(6, 12),
      `sort ${sort}: after two tickets were created at the front and the last ticket of page one was deleted, ` +
        `page two must still be tickets 7 to 12 of the original order. An offset, or a cursor that looks its ticket up, cannot do this.`,
    );

    // The other side of the boundary: the first ticket of page two is deleted, and a new
    // ticket appears in the middle of page two. A cursor that names the ticket the next page
    // starts with, and looks it up, has nothing to find; a cursor that holds a position does.
    const near = tickets.find((t) => t.id === order[8]);
    const inside = { ...near, id: 9500, title: 'New C' };
    const shifted = [...tickets.filter((t) => t.id !== order[6]), inside];
    const after = expectedOrder(shifted, sort);
    const expected = after.slice(after.indexOf(order[5]) + 1, after.indexOf(order[5]) + 7);
    assert.ok(expected.includes(9500) && !expected.includes(order[6]), 'the check itself is wrong: its expected page must hold the new ticket and not the deleted one');
    const next = page(listTickets, shifted, { sort, limit: 6, cursor: first.nextCursor }, `sort ${sort}, second page after a change inside it`);
    assert.deepEqual(
      ids(next),
      expected,
      `sort ${sort}: after the first ticket of page two was deleted and a ticket was created inside page two, ` +
        `page two must be the six tickets that now follow the last ticket of page one, the new one among them. ` +
        `A cursor that looks up the first ticket of the next page cannot do this.`,
    );
  }
});

test('http-api: GET /tickets reads the query string, returns 200 with items and nextCursor, and answers invalid input with a 400 problem document', async (t) => {
  await loadCore();
  const mod = await import(pathToFileURL(path.join(submissionDir, 'server.mjs')).href);
  assert.equal(typeof mod.createApp, 'function', 'server.mjs must export createApp');
  const tickets = makeTickets(47);
  const server = mod.createApp(tickets);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections?.();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (query) => fetch(`${base}/tickets${query ? `?${query}` : ''}`, { signal: AbortSignal.timeout(5000) });

  const plain = await get('');
  assert.equal(plain.status, 200, `GET /tickets: expected 200, got ${plain.status}`);
  assert.match(plain.headers.get('content-type') ?? '', /^application\/json/, 'A 200 answer must be application/json');
  const body = await plain.json();
  assert.deepEqual(body.items?.map((x) => x.id), expectedOrder(tickets).slice(0, 20), 'GET /tickets: expected the 20 newest tickets');
  assert.equal(typeof body.nextCursor, 'string', 'GET /tickets: 47 tickets must give a nextCursor');

  // Walk with every parameter set, passing the cursor back the way a client would.
  const seen = [];
  let cursor = null;
  for (let pages = 0; pages < 60; pages++) {
    const query = new URLSearchParams({ status: 'open', sort: 'priority', limit: '3', utm_source: 'ignored' });
    if (cursor !== null) query.set('cursor', cursor);
    const res = await get(query.toString());
    assert.equal(res.status, 200, `GET /tickets?${query}: expected 200, got ${res.status}`);
    const json = await res.json();
    assert.ok(json.items.length <= 3, `limit=3 in the query string was not applied: got ${json.items.length} items`);
    seen.push(...json.items.map((x) => x.id));
    cursor = json.nextCursor;
    if (cursor === null) break;
  }
  assert.equal(cursor, null, 'Walking GET /tickets with limit=3 never reached a page with nextCursor null');
  assert.deepEqual(seen, expectedOrder(tickets, 'priority', 'open'), 'Walking GET /tickets?status=open&sort=priority&limit=3 must return every open ticket once, in order');

  for (const query of ['limit=0', 'limit=101', 'limit=abc', 'limit=10abc', 'limit=1.5', 'limit=-3', 'status=done', 'sort=title', 'cursor=garbage!!']) {
    const res = await get(query);
    assert.equal(res.status, 400, `GET /tickets?${query}: expected 400, got ${res.status}`);
    assert.match(res.headers.get('content-type') ?? '', /^application\/problem\+json/, `GET /tickets?${query}: the error must be application/problem+json`);
    const problem = await res.json();
    assert.equal(problem.status, 400, `GET /tickets?${query}: the problem document needs "status": 400`);
    assert.equal(typeof problem.title, 'string', `GET /tickets?${query}: the problem document needs a "title"`);
  }
});
