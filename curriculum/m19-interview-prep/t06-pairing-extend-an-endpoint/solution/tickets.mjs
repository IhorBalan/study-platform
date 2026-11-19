// The core: no HTTP in here.

export class ValidationError extends Error {
  name = 'ValidationError';
}

export const STATUSES = ['open', 'pending', 'closed'];
export const SORTS = ['createdAt', '-createdAt', 'priority', '-priority'];
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

const compareValues = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** The cursor holds the position of the last ticket of a page: its sort value and its id. */
function encodeCursor(position) {
  return Buffer.from(JSON.stringify(position)).toString('base64url');
}

function decodeCursor(cursor, field) {
  if (typeof cursor !== 'string' || cursor === '') throw new ValidationError('cursor is not valid');
  let position;
  try {
    position = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('cursor is not valid');
  }
  // createdAt is a string and priority a number, so a cursor from another sort fails here too.
  const expected = field === 'createdAt' ? 'string' : 'number';
  if (
    position === null ||
    typeof position !== 'object' ||
    !Number.isInteger(position.id) ||
    typeof position.value !== expected
  ) {
    throw new ValidationError('cursor is not valid');
  }
  return position;
}

/** Returns one page of tickets as { items, nextCursor }. */
export function listTickets(tickets, options = {}) {
  const { status, sort = '-createdAt', limit = DEFAULT_LIMIT, cursor } = options ?? {};
  if (status !== undefined && !STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of ${STATUSES.join(', ')}`);
  }
  if (!SORTS.includes(sort)) throw new ValidationError(`sort must be one of ${SORTS.join(', ')}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new ValidationError(`limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }

  const field = sort.replace(/^-/, '');
  const direction = sort.startsWith('-') ? -1 : 1;
  const position = (ticket) => ({ value: ticket[field], id: ticket.id });
  // One order for sorting and for the cursor: the sort field first, then the id.
  const compare = (a, b) => direction * (compareValues(a.value, b.value) || compareValues(a.id, b.id));

  const after = cursor === undefined ? null : decodeCursor(cursor, field);
  const rows = tickets
    .filter((ticket) => status === undefined || ticket.status === status)
    .filter((ticket) => after === null || compare(position(ticket), after) > 0)
    .sort((a, b) => compare(position(a), position(b)));

  // One row more than asked for tells whether another page follows.
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeCursor(position(last)) : null,
  };
}
