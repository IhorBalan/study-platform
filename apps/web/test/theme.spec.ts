import { describe, expect, it } from 'vitest';
import { parseTheme, resolveTheme } from '../src/lib/theme';

describe('parseTheme', () => {
  it('accepts the three choices', () => {
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('system')).toBe('system');
  });

  it('falls back to the system for anything else', () => {
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('purple')).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('follows the system only when asked to', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
