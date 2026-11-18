/** Global keyboard shortcuts. Letters are matched by physical key, so they work in any keyboard layout. */

export const goTargets = {
  KeyP: { to: '/', label: 'Plan' },
  KeyR: { to: '/review', label: 'Review' },
  KeyC: { to: '/cards', label: 'Cards' },
  KeyN: { to: '/notes', label: 'Notes' },
  KeyS: { to: '/stats', label: 'Stats' },
  KeyE: { to: '/settings', label: 'Settings' },
} as const;

export type GoTarget = (typeof goTargets)[keyof typeof goTargets]['to'];

export type ShortcutAction =
  { kind: 'go'; to: GoTarget } | { kind: 'search' } | { kind: 'help' } | { kind: 'prefix' } | null;

export interface KeyPress {
  key: string;
  code: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** True when the key was typed into a field. */
  inField: boolean;
}

/** `afterG` is true when the previous key was "g" and it is still waiting for its second key. */
export function resolveShortcut(press: KeyPress, afterG: boolean): ShortcutAction {
  if (press.inField || press.ctrlKey || press.metaKey || press.altKey) return null;
  if (afterG) {
    const target = (goTargets as Record<string, { to: GoTarget } | undefined>)[press.code];
    return target && !press.shiftKey ? { kind: 'go', to: target.to } : null;
  }
  if (press.key === '?' || (press.code === 'Slash' && press.shiftKey)) return { kind: 'help' };
  if (press.shiftKey) return null;
  if (press.key === '/' || press.code === 'Slash') return { kind: 'search' };
  if (press.code === 'KeyG') return { kind: 'prefix' };
  return null;
}
