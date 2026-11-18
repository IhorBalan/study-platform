import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parsePageParams } from '../src/page-params.ts';

const DEFAULT_SORT = { field: 'createdAt', direction: 'desc' };

/** Asserts that parsing `query` throws a RangeError whose message names `param`. */
function assertRejects(query: Record<string, string>, param: string) {
  assert.throws(
    () => parsePageParams(query),
    (error: unknown) => {
      assert.ok(error instanceof RangeError, `expected a RangeError, got ${String(error)}`);
      assert.match(error.message, new RegExp(param));
      return true;
    },
  );
}

describe('defaults', () => {
  test('an empty query gives limit 20, offset 0 and newest first', () => {
    assert.deepEqual(parsePageParams({}), { limit: 20, offset: 0, sort: DEFAULT_SORT });
  });

  test('empty strings count as absent', () => {
    assert.deepEqual(parsePageParams({ limit: '', offset: '', sort: '' }), {
      limit: 20,
      offset: 0,
      sort: DEFAULT_SORT,
    });
  });

  test('unrelated parameters are ignored', () => {
    assert.deepEqual(parsePageParams({ q: 'milk' }), { limit: 20, offset: 0, sort: DEFAULT_SORT });
  });
});

describe('limit', () => {
  test('reads a valid limit', () => {
    assert.equal(parsePageParams({ limit: '5' }).limit, 5);
  });

  test('accepts the bounds 1 and 100', () => {
    assert.equal(parsePageParams({ limit: '1' }).limit, 1);
    assert.equal(parsePageParams({ limit: '100' }).limit, 100);
  });

  test('clamps values above 100 instead of rejecting them', () => {
    assert.equal(parsePageParams({ limit: '101' }).limit, 100);
    assert.equal(parsePageParams({ limit: '5000' }).limit, 100);
  });

  test('rejects 0', () => {
    assertRejects({ limit: '0' }, 'limit');
    assertRejects({ limit: '000' }, 'limit');
  });

  test('accepts leading zeros', () => {
    assert.equal(parsePageParams({ limit: '007' }).limit, 7);
  });

  for (const raw of ['-1', '1.5', '10abc', 'abc', ' 5', '5 ', '+5', '1e2', '0x10']) {
    test(`rejects ${JSON.stringify(raw)}`, () => assertRejects({ limit: raw }, 'limit'));
  }
});

describe('offset', () => {
  test('accepts the bounds 0 and 10000', () => {
    assert.equal(parsePageParams({ offset: '0' }).offset, 0);
    assert.equal(parsePageParams({ offset: '10000' }).offset, 10_000);
  });

  test('rejects 10001', () => {
    assertRejects({ offset: '10001' }, 'offset');
  });

  for (const raw of ['-5', '2.5', '7days', 'ten']) {
    test(`rejects ${JSON.stringify(raw)}`, () => assertRejects({ offset: raw }, 'offset'));
  }
});

describe('sort', () => {
  test('a bare field sorts ascending', () => {
    assert.deepEqual(parsePageParams({ sort: 'title' }).sort, { field: 'title', direction: 'asc' });
    assert.deepEqual(parsePageParams({ sort: 'createdAt' }).sort, { field: 'createdAt', direction: 'asc' });
  });

  test('a leading minus sorts descending', () => {
    assert.deepEqual(parsePageParams({ sort: '-title' }).sort, { field: 'title', direction: 'desc' });
    assert.deepEqual(parsePageParams({ sort: '-createdAt' }).sort, DEFAULT_SORT);
  });

  for (const raw of ['author', '-author', 'Title', '--title', '-', '+title']) {
    test(`rejects ${JSON.stringify(raw)}`, () => assertRejects({ sort: raw }, 'sort'));
  }
});

test('reports the first invalid parameter even when the others are valid', () => {
  assertRejects({ limit: '10', offset: 'x', sort: 'title' }, 'offset');
});
