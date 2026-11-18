// Your tests. `npm test` builds the project and runs every test/*.test.mjs.
// Import from '../dist/support.js' only. The model is scripted, so tests are fast and free.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { triageTicket } from '../dist/support.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const text = (t) => ({ content: [{ type: 'text', text: t }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] });

test('valid triage output is returned after one call', async () => {
  const valid = { category: 'bug', priority: 'normal', summary: 'Export button does nothing.', orderId: null };
  const model = new MockLanguageModelV4({ doGenerate: [text(JSON.stringify(valid))] });
  const result = await triageTicket(model, 'The export button does nothing.');
  assert.deepEqual(result, { triage: valid, attempts: 1 });
});

// TODO: a test where the first answer is invalid and the second is valid.
// TODO: a test that a refund of another customer's order is refused.
