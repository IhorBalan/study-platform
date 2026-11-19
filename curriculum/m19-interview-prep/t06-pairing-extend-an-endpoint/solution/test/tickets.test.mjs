import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTickets, ValidationError } from '../tickets.mjs';

const at = (hour) => new Date(Date.UTC(2026, 10, 1, hour)).toISOString();
const tickets = [
  { id: 1, title: 'a', status: 'open', priority: 2, createdAt: at(8) },
  { id: 2, title: 'b', status: 'closed', priority: 3, createdAt: at(8) },
  { id: 3, title: 'c', status: 'open', priority: 2, createdAt: at(9) },
  { id: 4, title: 'd', status: 'pending', priority: 1, createdAt: at(10) },
  { id: 5, title: 'e', status: 'open', priority: 4, createdAt: at(10) },
  { id: 6, title: 'f', status: 'open', priority: 1, createdAt: at(11) },
];
const ids = (page) => page.items.map((t) => t.id);

function walk(list, options) {
  const seen = [];
  let cursor;
  for (let guard = 0; guard < 50; guard++) {
    const page = listTickets(list, { ...options, cursor });
    seen.push(...ids(page));
    if (page.nextCursor === null) return seen;
    cursor = page.nextCursor;
  }
  throw new Error('the walk never reached a last page');
}

test('keeps only the tickets of the given status', () => {
  assert.deepEqual(ids(listTickets(tickets, { status: 'open', sort: 'createdAt' })), [1, 3, 5, 6]);
});

test('rejects an unknown status, sort or limit', () => {
  assert.throws(() => listTickets(tickets, { status: 'done' }), ValidationError);
  assert.throws(() => listTickets(tickets, { sort: 'title' }), ValidationError);
  for (const limit of [0, 101, 1.5, '10', Number.NaN]) {
    assert.throws(() => listTickets(tickets, { limit }), ValidationError);
  }
});

test('sorts newest first by default and breaks ties by id in the same direction', () => {
  assert.deepEqual(ids(listTickets(tickets)), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(ids(listTickets(tickets, { sort: 'createdAt' })), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(ids(listTickets(tickets, { sort: 'priority' })), [4, 6, 1, 3, 2, 5]);
  assert.deepEqual(ids(listTickets(tickets, { sort: '-priority' })), [5, 2, 3, 1, 6, 4]);
});

test('a walk through the pages returns every ticket once, in order', () => {
  assert.deepEqual(walk(tickets, { limit: 4 }), [6, 5, 4, 3, 2, 1]);
  assert.deepEqual(walk(tickets, { limit: 1, sort: 'priority' }), [4, 6, 1, 3, 2, 5]);
});

test('the last page has no cursor, also when the list is an exact multiple of the limit', () => {
  const first = listTickets(tickets, { limit: 3 });
  assert.equal(typeof first.nextCursor, 'string');
  const second = listTickets(tickets, { limit: 3, cursor: first.nextCursor });
  assert.deepEqual(ids(second), [3, 2, 1]);
  assert.equal(second.nextCursor, null);
});

test('a ticket created or deleted between two pages is neither skipped nor repeated', () => {
  const first = listTickets(tickets, { limit: 2 });
  assert.deepEqual(ids(first), [6, 5]);
  const changed = [
    // Two created and one deleted, so the changes do not cancel out for an offset.
    { id: 7, title: 'new', status: 'open', priority: 1, createdAt: at(12) },
    { id: 8, title: 'newer', status: 'open', priority: 1, createdAt: at(13) },
    ...tickets.filter((t) => t.id !== 5), // the last ticket of the first page is gone
  ];
  assert.deepEqual(ids(listTickets(changed, { limit: 2, cursor: first.nextCursor })), [4, 3]);
});

test('rejects a cursor it did not issue', () => {
  for (const cursor of ['', 'garbage!!', Buffer.from('{"a":1}').toString('base64url'), 42]) {
    assert.throws(() => listTickets(tickets, { cursor }), ValidationError);
  }
});

test('does not change the array it is given', () => {
  const copy = structuredClone(tickets);
  listTickets(tickets, { sort: '-priority' });
  assert.deepEqual(tickets, copy);
});
