/** Escape a string for safe interpolation into innerHTML. */
export function escapeHtml(value: string): string {
  const div = document.createElement('div');
  div.innerText = value;
  return div.innerHTML;
}

/**
 * Look up an element by id and narrow its type. Returns null when absent, since
 * some controls (the "Change" destination link) only exist on certain screens.
 */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Attach a click handler to an element by id, if it is on the current screen. */
export function onClick(id: string, handler: () => void): void {
  byId(id)?.addEventListener('click', handler);
}
