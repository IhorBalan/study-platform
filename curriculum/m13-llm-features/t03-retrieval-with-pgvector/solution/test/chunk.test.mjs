// `npm test` builds, then runs these. They need no database.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chunkText } from '../dist/rag.js';

const paragraph = (n) => `Paragraph ${n} ` + 'explains one setting in plain words. '.repeat(6);
const text = Array.from({ length: 6 }, (_, i) => paragraph(i)).join('\n\n');

test('no chunk is longer than maxChars', () => {
  for (const max of [100, 250, 800]) {
    for (const chunk of chunkText(text, max)) assert.ok(chunk.length <= max, `${chunk.length} > ${max}`);
  }
});

test('every word survives, in order', () => {
  const words = (s) => s.split(/\s+/).filter(Boolean);
  assert.deepEqual(words(chunkText(text, 250).join(' ')), words(text));
});

test('a paragraph that fits stays in one chunk', () => {
  const chunks = chunkText(text, 800);
  assert.ok(chunks.some((c) => c.includes(paragraph(3).trim())));
});

test('empty text has no chunks', () => {
  assert.deepEqual(chunkText('   ', 100), []);
});
