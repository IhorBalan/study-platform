import type { Article } from './article.js';

// Do not change this file. The checks import it to know the expected order.
//
// 75 articles. Groups of three share a createdAt timestamp, so ordering by
// createdAt alone is not enough to give every article a unique position.
// The array is deliberately not in display order.
const AUTHORS = ['ada', 'grace', 'linus', 'margaret'] as const;
const BASE = Date.UTC(2026, 9, 1, 8, 0, 0);
const HOUR = 60 * 60 * 1000;

export const SEED_ARTICLES: readonly Article[] = Array.from({ length: 75 }, (_, k) => {
  const n = ((k * 37) % 75) + 1; // a fixed shuffle of 1..75
  return {
    id: `art-${String(n).padStart(3, '0')}`,
    title: `Article number ${n}`,
    author: AUTHORS[(n * 7) % AUTHORS.length]!,
    createdAt: new Date(BASE + Math.floor(n / 3) * HOUR).toISOString(),
  };
});
