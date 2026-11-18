// Parses the pagination and sorting part of a list endpoint's query string,
// for example GET /notes?limit=50&offset=100&sort=-title.
//
// This file is finished and correct. Your job is to test it, not to change it.

export type SortField = 'createdAt' | 'title';
export type SortDirection = 'asc' | 'desc';

export interface PageParams {
  limit: number;
  offset: number;
  sort: { field: SortField; direction: SortDirection };
}

export type Query = Record<string, string | undefined>;

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_OFFSET = 10_000;

const SORT_FIELDS: readonly string[] = ['createdAt', 'title'];
const DIGITS = /^\d+$/;

function fail(name: string, detail: string): never {
  throw new RangeError(`${name} ${detail}`);
}

function isAbsent(raw: string | undefined): raw is undefined | '' {
  return raw === undefined || raw === '';
}

function parseWholeNumber(name: string, raw: string): number {
  if (!DIGITS.test(raw)) fail(name, `must be a whole number written with digits only, got "${raw}"`);
  return Number(raw);
}

function parseLimit(raw: string | undefined): number {
  if (isAbsent(raw)) return DEFAULT_LIMIT;
  const limit = parseWholeNumber('limit', raw);
  if (limit < 1) fail('limit', 'must be at least 1');
  return Math.min(limit, MAX_LIMIT);
}

function parseOffset(raw: string | undefined): number {
  if (isAbsent(raw)) return 0;
  const offset = parseWholeNumber('offset', raw);
  if (offset > MAX_OFFSET) fail('offset', `must be at most ${MAX_OFFSET}`);
  return offset;
}

function parseSort(raw: string | undefined): PageParams['sort'] {
  if (isAbsent(raw)) return { field: 'createdAt', direction: 'desc' };
  const direction: SortDirection = raw.startsWith('-') ? 'desc' : 'asc';
  const field = direction === 'desc' ? raw.slice(1) : raw;
  if (!SORT_FIELDS.includes(field)) fail('sort', `must be one of createdAt, title, -createdAt, -title, got "${raw}"`);
  return { field: field as SortField, direction };
}

export function parsePageParams(query: Query): PageParams {
  return {
    limit: parseLimit(query.limit),
    offset: parseOffset(query.offset),
    sort: parseSort(query.sort),
  };
}
