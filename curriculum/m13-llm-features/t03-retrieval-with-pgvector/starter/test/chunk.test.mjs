// Your tests. `npm test` builds the project and runs every test/*.test.mjs.
// Import from '../dist/rag.js' only. Tests of chunkText need no database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from '../dist/rag.js';

test('empty text has no chunks', () => {
  assert.deepEqual(chunkText('   ', 100), []);
});

// TODO: a test that no chunk is longer than maxChars, on a text long enough to need several chunks.
