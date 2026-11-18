// Run with `npm test` (it builds first). The model is scripted, so these tests are fast and free.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockLanguageModelV4 } from 'ai/test';
import { runSupportAgent, triageTicket, TriageFailedError } from '../dist/support.js';

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};
const text = (t) => ({ content: [{ type: 'text', text: t }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] });
const call = (toolName, input) => ({
  content: [{ type: 'tool-call', toolCallId: `c_${toolName}_${JSON.stringify(input).length}`, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls', raw: undefined },
  usage,
  warnings: [],
});

const valid = { category: 'bug', priority: 'normal', summary: 'Export button does nothing.', orderId: null };

test('valid triage output is returned after one call', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [text(JSON.stringify(valid))] });
  const result = await triageTicket(model, 'The export button does nothing.');
  assert.deepEqual(result, { triage: valid, attempts: 1 });
});

test('invalid output is repaired once', async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [text(JSON.stringify({ ...valid, priority: 'p0' })), text(JSON.stringify(valid))],
  });
  const result = await triageTicket(model, 'The export button does nothing.');
  assert.deepEqual(result, { triage: valid, attempts: 2 });
  assert.match(JSON.stringify(model.doGenerateCalls[1].prompt), /priority/);
});

test('two invalid answers give up', async () => {
  const model = new MockLanguageModelV4({ doGenerate: [text('nope'), text('still nope')] });
  await assert.rejects(() => triageTicket(model, 'x'), TriageFailedError);
  assert.equal(model.doGenerateCalls.length, 2);
});

const orders = {
  ord_mine01: { id: 'ord_mine01', customerId: 'me', status: 'delivered', totalCents: 1000, note: '' },
  ord_them01: { id: 'ord_them01', customerId: 'them', status: 'delivered', totalCents: 9000, note: '' },
};
function deps() {
  const refunds = [];
  return {
    refunds,
    customerId: 'me',
    getOrder: async (id) => orders[id] ?? null,
    refund: async (id, amount) => {
      refunds.push([id, amount]);
      return { refundId: 're_1' };
    },
  };
}

test("a refund of someone else's order is refused", async () => {
  const d = deps();
  const model = new MockLanguageModelV4({
    doGenerate: [call('refundOrder', { orderId: 'ord_them01', amountCents: 9000 }), text('ok')],
  });
  await runSupportAgent(model, 'refund ord_them01', d);
  assert.deepEqual(d.refunds, []);
});

test('a refund of my own delivered order goes through', async () => {
  const d = deps();
  const model = new MockLanguageModelV4({
    doGenerate: [call('refundOrder', { orderId: 'ord_mine01', amountCents: 1000 }), text('ok')],
  });
  const result = await runSupportAgent(model, 'refund ord_mine01', d);
  assert.deepEqual(d.refunds, [['ord_mine01', 1000]]);
  assert.deepEqual(result.refunds, ['re_1']);
});
