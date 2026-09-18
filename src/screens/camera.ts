/**
 * Camera problem reporting.
 *
 * The viewfinder itself lives in the shell (screens/shell.ts) — this is only the
 * inline error, shown in the overlay so the user stays on the same screen and
 * can retry once they have granted permission.
 */

import { escapeHtml } from '../lib/dom';

/** Overlay content for a camera that won't start. */
export function cameraErrorOverlay(message: string): string {
  return `
    <div></div>
    <div class="error-box">
      <strong>No camera.</strong>
      <p class="detail-note">${escapeHtml(message)}</p>
    </div>
  `;
}
