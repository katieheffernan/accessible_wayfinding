/** Screen 3: waiting on Claude. */

import { announce } from '../lib/announce';
import { headerHtml, wireHeader } from './header';
import type { Actions } from '../actions';

export function renderAnalyzing(app: HTMLElement, actions: Actions): void {
  app.innerHTML = `
    ${headerHtml()}
    <div class="status">
      <div class="spinner" aria-hidden="true"></div>
      Looking at your surroundings…
    </div>
  `;

  // The header's "Change" button stays live here, so a slow analysis can be
  // abandoned rather than leaving the user stuck watching a spinner.
  wireHeader(actions);

  // The spinner is decorative and invisible to a screen reader, so say it out loud.
  announce('Analyzing your photo, please wait.');
}
