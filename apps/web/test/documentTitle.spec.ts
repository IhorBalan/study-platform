import { describe, expect, it } from 'vitest';
import { documentTitle } from '../src/lib/useDocumentTitle';

describe('documentTitle', () => {
  it('puts the page before the name of the app', () => {
    expect(documentTitle('HTTP in depth')).toBe('HTTP in depth · Study platform');
  });

  it('falls back to the name of the app', () => {
    expect(documentTitle('  ')).toBe('Study platform');
    expect(documentTitle(null)).toBe('Study platform');
  });
});
