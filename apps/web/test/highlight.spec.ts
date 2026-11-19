import { describe, expect, it } from 'vitest';
import { splitByTerms } from '../src/lib/highlight';

describe('splitByTerms', () => {
  it('marks every word of the search, whatever its case', () => {
    expect(splitByTerms('The Outbox table and the relay.', 'outbox RELAY')).toEqual([
      { text: 'The ', match: false },
      { text: 'Outbox', match: true },
      { text: ' table and the ', match: false },
      { text: 'relay', match: true },
      { text: '.', match: false },
    ]);
  });

  it('returns the text unmarked when no word is long enough', () => {
    expect(splitByTerms('a b c', 'a')).toEqual([{ text: 'a b c', match: false }]);
  });

  it('treats special characters as plain text', () => {
    expect(splitByTerms('Use c++ or (a|b).', 'c++ (a|b)')).toEqual([
      { text: 'Use ', match: false },
      { text: 'c++', match: true },
      { text: ' or ', match: false },
      { text: '(a|b)', match: true },
      { text: '.', match: false },
    ]);
  });

  it('prefers the longer word where two could match', () => {
    expect(splitByTerms('outbox', 'out outbox')).toEqual([{ text: 'outbox', match: true }]);
  });

  it('marks a match at the very start and end', () => {
    expect(splitByTerms('cache the cache', 'cache')).toEqual([
      { text: 'cache', match: true },
      { text: ' the ', match: false },
      { text: 'cache', match: true },
    ]);
  });
});
