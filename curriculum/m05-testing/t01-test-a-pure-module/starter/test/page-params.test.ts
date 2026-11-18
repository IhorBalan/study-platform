import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parsePageParams } from '../src/page-params.ts';

describe('parsePageParams', () => {
  test('reads a valid limit', () => {
    assert.equal(parsePageParams({ limit: '5' }).limit, 5);
  });

  // TODO: defaults when a parameter is absent or empty
  // TODO: limit boundaries (0, 1, 100, 101) and offset boundaries (0, 10000, 10001)
  // TODO: malformed numbers
  // TODO: sort fields and directions, including an unknown field
  // TODO: the type and message of the errors
});
