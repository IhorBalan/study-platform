// Your tests run against the lab S3 emulator. Create a bucket of your own whose name starts with
// AWS_RESOURCE_PREFIX, and delete it (objects first) in after().
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ObjectNotFoundError } from '../src/object-store.ts';

test('TODO: replace with real tests', () => {
  assert.equal(typeof ObjectNotFoundError, 'function');
});
