import { describe, expect, it } from 'vitest';
import { cutSnippet, plainText } from './search.service.js';

describe('plainText', () => {
  it('removes Markdown marks', () => {
    expect(plainText('## A *bold* and _soft_ [link](http://x) with `code`')).toBe(
      'A bold and soft link with code',
    );
  });

  it('keeps underscores inside names', () => {
    expect(plainText('Enable `pg_trgm` and set statement_timeout, __then__ _wait_.')).toBe(
      'Enable pg_trgm and set statement_timeout, then wait.',
    );
  });
});

describe('cutSnippet', () => {
  const words = (n: number, word: string) => Array.from({ length: n }, () => word).join(' ');
  const text = `${words(30, 'before')} the outbox table ${words(40, 'after')}`;
  const at = text.indexOf('outbox');

  it('starts and ends on a whole word', () => {
    const snippet = cutSnippet(text, at, 'outbox'.length);
    expect(snippet).toMatch(/^…before /);
    expect(snippet).toMatch(/ after…$/);
    expect(snippet).toContain('the outbox table');
  });

  it('adds no ellipsis when the whole text fits', () => {
    expect(cutSnippet('Hello world.', 6, 5)).toBe('Hello world.');
  });

  it('never cuts the match, even inside one long word', () => {
    const long = `${'x'.repeat(100)}needle${'y'.repeat(200)}`;
    expect(cutSnippet(long, 100, 6)).toContain('needle');
  });

  it('keeps a match that sits in the middle of a word', () => {
    const inside = `${words(30, 'before')} statement_timeout ${words(40, 'after')}`;
    const snippet = cutSnippet(inside, inside.indexOf('timeout'), 'timeout'.length);
    expect(snippet).toContain('statement_timeout');
  });
});
