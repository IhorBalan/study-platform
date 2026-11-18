import type { CardDto } from '@study/shared';
import { describe, expect, it } from 'vitest';
import { filterCards } from '../src/lib/filterCards';

const card = (over: Partial<CardDto>): CardDto => ({
  id: '00000000-0000-4000-8000-000000000001',
  type: 'concept',
  front: 'What is an idempotency key?',
  back: 'A client-chosen id that makes a retry safe.',
  source: 'lesson',
  status: 'active',
  lessonId: null,
  skills: [],
  state: 'new',
  due: '2026-11-18T00:00:00.000Z',
  reps: 0,
  lapses: 0,
  ...over,
});

const cards = [
  card({}),
  card({ front: 'EXPLAIN shows…', back: 'the query plan', type: 'cloze', state: 'review' }),
  card({ front: 'Kafka partition', back: 'an ordered log', status: 'suspended', state: 'review' }),
];

describe('filterCards', () => {
  it('returns every card for an empty filter', () => {
    expect(filterCards(cards, '  ')).toHaveLength(3);
  });

  it('matches the front or the back, ignoring case', () => {
    expect(filterCards(cards, 'IDEMPOTENCY').map((c) => c.front)).toEqual([cards[0]?.front]);
    expect(filterCards(cards, 'query plan')).toHaveLength(1);
  });

  it('needs every word to match', () => {
    expect(filterCards(cards, 'kafka retry')).toHaveLength(0);
    expect(filterCards(cards, 'retry key')).toHaveLength(1);
  });

  it('matches the type and the state', () => {
    expect(filterCards(cards, 'cloze')).toHaveLength(1);
    expect(filterCards(cards, 'review')).toHaveLength(1);
  });

  it('shows a suspended card as suspended, not by its schedule state', () => {
    expect(filterCards(cards, 'suspended').map((c) => c.front)).toEqual(['Kafka partition']);
  });
});
