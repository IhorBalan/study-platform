export interface TextPart {
  text: string;
  match: boolean;
}

/** The server ignores shorter words, so they are not marked either. */
const MIN_TERM_LENGTH = 2;

/**
 * Splits text into the parts that match a word of the search and the parts between,
 * so the matches can be marked without building HTML from a string.
 */
export function splitByTerms(text: string, query: string): TextPart[] {
  const terms = [...new Set(query.toLowerCase().split(/\s+/))]
    .filter((term) => term.length >= MIN_TERM_LENGTH)
    // Longer words first, so "outbox" wins over "out" where both could match.
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (terms.length === 0) return text ? [{ text, match: false }] : [];

  // With a capture group, split() keeps the matches: they land on the odd positions.
  return text
    .split(new RegExp(`(${terms.join('|')})`, 'gi'))
    .map((part, index) => ({ text: part, match: index % 2 === 1 }))
    .filter((part) => part.text !== '');
}
