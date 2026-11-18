import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

test('greets: exports a greeting', async () => {
  const file = path.join(process.env.SUBMISSION_DIR ?? '.', 'index.mjs');
  const mod = await import(pathToFileURL(file).href);
  assert.equal(mod.greeting, 'hello');
});
