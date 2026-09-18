/** Screen 1: what are you looking for? */

import { byId, escapeHtml, onClick } from '../lib/dom';
import { state } from '../state';
import { headerHtml } from './header';
import type { Actions } from '../actions';

const EXAMPLES = [
  { label: 'Pharmacy entrance', value: 'Front entrance of the nearest pharmacy' },
  { label: 'Bus stop', value: 'Bus stop for route 22 outbound' },
  { label: 'Office lobby', value: 'Main lobby entrance of the office building' },
];

export function renderDestination(app: HTMLElement, actions: Actions): void {
  const exampleButtons = EXAMPLES.map(
    (example) =>
      `<button class="example-btn" type="button" data-ex="${escapeHtml(example.value)}">${escapeHtml(example.label)}</button>`,
  ).join('\n        ');

  app.innerHTML = `
    ${headerHtml()}
    <h2>Where are you headed?</h2>
    <p class="lead">Describe the place in your own words. Be as specific as you can — a building name, a store, an entrance.</p>
    <label for="dest-input">Destination</label>
    <input id="dest-input" type="text" placeholder="e.g. Main entrance of the downtown library" value="${escapeHtml(state.destination)}" autocomplete="off" />
    <div class="examples">
      ${exampleButtons}
    </div>
    <div class="stack" style="margin-top:28px;">
      <button class="btn btn-primary" id="continue-btn" type="button">Continue</button>
    </div>
    <footer class="note">Prototype demo. Uses your camera and, if you allow it, your location to help describe your surroundings — nothing is saved.</footer>
  `;

  const input = byId<HTMLInputElement>('dest-input');
  if (input) {
    input.focus();
    input.addEventListener('input', () => {
      state.destination = input.value;
    });
    // Enter submits: reaching for a small "Continue" target is the hard part.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') actions.goToCamera();
    });
  }

  app.querySelectorAll<HTMLButtonElement>('.example-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const value = button.dataset.ex ?? '';
      state.destination = value;
      if (input) {
        input.value = value;
        // Return focus to the field so the example can be edited, not just accepted.
        input.focus();
      }
    });
  });

  onClick('continue-btn', actions.goToCamera);
}
