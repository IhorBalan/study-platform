import type { CardDto } from '@study/shared';

/**
 * Cards whose text, type, source or state contains every word of the filter.
 * A suspended card matches "suspended" rather than its scheduling state.
 */
export function filterCards(cards: CardDto[], filter: string): CardDto[] {
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return cards;
  return cards.filter((card) => {
    const text = [
      card.front,
      card.back,
      card.type,
      card.source,
      card.status === 'suspended' ? 'suspended' : card.state,
    ]
      .join('\n')
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
