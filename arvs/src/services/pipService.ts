const PIP_STORAGE_KEY = 'arvs_pip_enabled';
const PIP_EVENT_NAME = 'arvs-pip-mode-change';

export function getStoredPipEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const value = window.localStorage.getItem(PIP_STORAGE_KEY);
  // Default to true if not set yet
  return value !== 'false';
}

export function setPipEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(PIP_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new CustomEvent(PIP_EVENT_NAME, { detail: { enabled } }));
}

export function onPipModeChange(listener: (enabled: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleEvent = (event: Event) => {
    const customEvent = event as CustomEvent<{ enabled?: boolean }>;
    const enabled = customEvent.detail?.enabled;
    if (typeof enabled === 'boolean') {
      listener(enabled);
    }
  };

  window.addEventListener(PIP_EVENT_NAME, handleEvent);
  return () => window.removeEventListener(PIP_EVENT_NAME, handleEvent);
}
