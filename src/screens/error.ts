/** Screen 5: something went wrong. */

import { byId, escapeHtml, onClick } from '../lib/dom';
import { state } from '../state';
import { headerHtml } from './header';
import type { Actions } from '../actions';

export function renderError(app: HTMLElement, actions: Actions): void {
  app.innerHTML = `
    ${headerHtml()}
    <div class="error-box">${escapeHtml(state.lastErrorMessage || 'Something went wrong.')}</div>
    <div class="stack">
      <button class="btn btn-primary" id="retry-btn" type="button">Try again</button>
      <button class="btn btn-secondary" id="new-dest-btn2" type="button">Change destination</button>
    </div>
  `;

  onClick('retry-btn', actions.goToCamera);
  onClick('new-dest-btn2', actions.goToDestination);

  byId('retry-btn')?.focus();
}
