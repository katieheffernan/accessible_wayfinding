/** The shared header: app name, current destination, and a way to change it. */

import { escapeHtml, onClick } from '../lib/dom';
import { state } from '../state';
import type { Actions } from '../actions';

export function headerHtml(): string {
  const pill = state.destination
    ? `<div class="dest-pill">Heading to<br><strong style="color:var(--text)">${escapeHtml(state.destination)}</strong>
        <button id="change-dest-btn" type="button">Change</button>
       </div>`
    : '';

  return `<header><h1>Here Yet</h1>${pill}</header>`;
}

/** Wire the "Change" link. No-op on the destination screen, where it isn't rendered. */
export function wireHeader(actions: Actions): void {
  onClick('change-dest-btn', actions.goToDestination);
}
