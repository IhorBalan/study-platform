// A deterministic stand-in for a real embedding model, for local runs and tests.
// It hashes words into 64 buckets: texts that share words get similar vectors.
// A real model also captures meaning ("refund" is close to "money back"); this one does not.
import { MockEmbeddingModelV4 } from 'ai/test';

export const FAKE_DIMENSIONS = 64;

const STOPWORDS = new Set(['a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'do', 'for', 'from', 'how', 'i', 'in', 'is', 'it', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'with', 'you', 'your', 'can', 'does', 'this', 'that']);

function fnv1a(word: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    hash ^= word.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function fakeEmbed(text: string): number[] {
  const vector = new Array<number>(FAKE_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOPWORDS.has(word)) continue;
    vector[fnv1a(word) % FAKE_DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...vector);
  // An all-zero vector has no direction; give it a fixed one so cosine distance is defined.
  return norm === 0 ? vector.map((_, i) => (i === 0 ? 1 : 0)) : vector.map((v) => v / norm);
}

export function createFakeEmbeddingModel(options: { maxEmbeddingsPerCall?: number } = {}) {
  return new MockEmbeddingModelV4({
    modelId: 'fake-hash-64',
    maxEmbeddingsPerCall: options.maxEmbeddingsPerCall ?? 16,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(fakeEmbed),
      usage: { tokens: values.join(' ').split(/\s+/).length },
      warnings: [],
    }),
  });
}
