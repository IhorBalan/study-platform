import { describe, expect, it } from 'vitest';
import { plainText } from './search.service.js';

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
