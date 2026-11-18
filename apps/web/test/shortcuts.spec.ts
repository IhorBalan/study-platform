import { describe, expect, it } from 'vitest';
import { resolveShortcut, type KeyPress } from '../src/lib/shortcuts';

const press = (over: Partial<KeyPress>): KeyPress => ({
  key: '',
  code: '',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  inField: false,
  ...over,
});

describe('resolveShortcut', () => {
  it('opens the help on "?"', () => {
    expect(resolveShortcut(press({ key: '?', code: 'Slash', shiftKey: true }), false)).toEqual({
      kind: 'help',
    });
  });

  it('goes to search on "/"', () => {
    expect(resolveShortcut(press({ key: '/', code: 'Slash' }), false)).toEqual({ kind: 'search' });
  });

  it('treats "g" as a prefix and the next letter as a page', () => {
    expect(resolveShortcut(press({ key: 'g', code: 'KeyG' }), false)).toEqual({ kind: 'prefix' });
    expect(resolveShortcut(press({ key: 'r', code: 'KeyR' }), true)).toEqual({
      kind: 'go',
      to: '/review',
    });
  });

  it('matches letters by physical key, so other layouts work', () => {
    expect(resolveShortcut(press({ key: 'п', code: 'KeyG' }), false)).toEqual({ kind: 'prefix' });
    expect(resolveShortcut(press({ key: 'з', code: 'KeyP' }), true)).toEqual({
      kind: 'go',
      to: '/',
    });
  });

  it('does nothing for a page letter without "g" first', () => {
    expect(resolveShortcut(press({ key: 'r', code: 'KeyR' }), false)).toBeNull();
  });

  it('does nothing for an unknown letter after "g"', () => {
    expect(resolveShortcut(press({ key: 'x', code: 'KeyX' }), true)).toBeNull();
  });

  it('ignores keys typed into a field or with a modifier', () => {
    expect(resolveShortcut(press({ key: '/', code: 'Slash', inField: true }), false)).toBeNull();
    expect(resolveShortcut(press({ key: 'g', code: 'KeyG', metaKey: true }), false)).toBeNull();
    expect(resolveShortcut(press({ key: 'r', code: 'KeyR', ctrlKey: true }), true)).toBeNull();
  });
});
