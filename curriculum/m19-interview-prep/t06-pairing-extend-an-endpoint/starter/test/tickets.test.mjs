import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listTickets } from '../tickets.mjs';

const tickets = [
  { id: 1, title: 'Login fails', status: 'open', priority: 2, createdAt: '2026-11-01T08:00:00.000Z' },
  { id: 2, title: 'Slow export', status: 'closed', priority: 3, createdAt: '2026-11-01T09:00:00.000Z' },
];

test('returns the tickets and no cursor when everything fits on one page', () => {
  const page = listTickets(tickets);
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, null);
});

// TODO: one test per rule in task.md. Name each after the behaviour it protects.
