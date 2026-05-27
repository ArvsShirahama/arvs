export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'arvs_theme_mode';
const DARK_CLASS_NAME = 'ion-palette-dark';
const THEME_EVENT_NAME = 'arvs-theme-mode-change';

function getRootElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement;
}

export function getStoredThemeMode(): ThemeMode | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === 'dark' || value === 'light' ? value : null;
}

export function getPreferredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveThemeMode(): ThemeMode {
  return getStoredThemeMode() ?? getPreferredThemeMode();
}

export function applyThemeMode(mode: ThemeMode): void {
  const root = getRootElement();
  if (!root) return;
  root.classList.toggle(DARK_CLASS_NAME, mode === 'dark');
}

export function setThemeMode(mode: ThemeMode): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  applyThemeMode(mode);
  window.dispatchEvent(new CustomEvent(THEME_EVENT_NAME, { detail: { mode } }));
}

export function initializeThemeMode(): ThemeMode {
  const mode = resolveThemeMode();
  applyThemeMode(mode);
  return mode;
}

export function onThemeModeChange(listener: (mode: ThemeMode) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<{ mode?: ThemeMode }>;
    const mode = customEvent.detail?.mode;
    if (mode === 'light' || mode === 'dark') {
      listener(mode);
    }
  };

  window.addEventListener(THEME_EVENT_NAME, handleEvent);
  return () => window.removeEventListener(THEME_EVENT_NAME, handleEvent);
}
