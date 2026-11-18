/** Light, dark, or whatever the operating system says. Kept per browser, not in the database. */
export const themes = ['system', 'light', 'dark'] as const;
export type Theme = (typeof themes)[number];

const KEY = 'study.theme';

export function parseTheme(value: string | null): Theme {
  return themes.includes(value as Theme) ? (value as Theme) : 'system';
}

export function resolveTheme(theme: Theme, systemDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

export function storedTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    // Storage can be blocked; the system setting still works.
    return 'system';
  }
}

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Puts `light` or `dark` on the root element, which the styles key off. */
export function applyTheme(theme: Theme = storedTheme()): void {
  const resolved = resolveTheme(theme, systemDark().matches);
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.classList.toggle('light', resolved === 'light');
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Not saved: the choice still applies until the page is reloaded.
  }
  applyTheme(theme);
}

/** Applies the saved theme now and follows the system while the choice is "system". */
export function startTheme(): void {
  applyTheme();
  systemDark().addEventListener('change', () => applyTheme());
}
