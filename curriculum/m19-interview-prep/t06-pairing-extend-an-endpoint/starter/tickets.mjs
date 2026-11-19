// The core: no HTTP in here.

export class ValidationError extends Error {
  name = 'ValidationError';
}

export const STATUSES = ['open', 'pending', 'closed'];
export const SORTS = ['createdAt', '-createdAt', 'priority', '-priority'];
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/**
 * Returns one page of tickets as { items, nextCursor }.
 * TODO: status, sort, limit and cursor as described in task.md. Today every ticket comes back.
 */
export function listTickets(tickets, options = {}) {
  return { items: [...tickets], nextCursor: null };
}
