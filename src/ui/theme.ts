export type Theme = 'light' | 'dark';

const root = document.documentElement;
// Keep in sync with the pre-paint initializer in index.html.
const THEME_STORAGE_KEY = 'ink-theme:theme:v1';

/** The user's explicit choice, or null when the system preference should be followed. */
export function getStoredTheme(): Theme | null {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The current page still works when storage is blocked.
  }
}

export function getTheme(): Theme {
  return root.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function otherTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Instantly applies a theme to the live DOM and keeps the toggle's ARIA state in sync. */
export function applyTheme(theme: Theme, toggle?: HTMLButtonElement | null): void {
  root.dataset.theme = theme;
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(theme === 'dark'));
  }
}
