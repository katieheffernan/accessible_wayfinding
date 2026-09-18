/** Screen 4: the guidance. */

import { announce } from '../lib/announce';
import { byId, escapeHtml, onClick } from '../lib/dom';
import { isAccessBlocked, isUnclear } from '../lib/guidance';
import { state } from '../state';
import { headerHtml, wireHeader } from './header';
import type { Actions } from '../actions';
import type { NextStep } from '../types';

/**
 * Each next step gets a fixed arrow and label. The arrow is aria-hidden and the
 * label carries the same meaning in words, so the direction never depends on
 * seeing the glyph — or on hearing the spoken sentence.
 */
const NEXT_STEP_LABELS: Record<NextStep, { arrow: string; label: string }> = {
  walk_forward: { arrow: '↑', label: 'Keep walking forward' },
  turn_left: { arrow: '←', label: 'Turn left' },
  turn_right: { arrow: '→', label: 'Turn right' },
  turn_around: { arrow: '↺', label: 'Turn around' },
  look_for_entrance: { arrow: '◎', label: 'Look for the entrance nearby' },
  arrived: { arrow: '✓', label: "You've arrived" },
  unclear: { arrow: '?', label: 'Not clear yet — try another photo' },
};

export function renderResult(app: HTMLElement, actions: Actions): void {
  const result = state.lastResult;
  if (!result) return;

  const step = NEXT_STEP_LABELS[result.nextStep] ?? NEXT_STEP_LABELS.unclear;

  // Getting in sits directly under the scene description, above "Why": whether
  // you can use the door matters more than whether this is the right building.
  const accessBlock = result.accessNotes
    ? `<h3>Getting in</h3>\n        <p>${escapeHtml(result.accessNotes)}</p>`
    : '';
  // Reaching the building is real and worth confirming, so the card keeps its
  // arrived styling — but the words don't say "arrived" when the door in front
  // of them can't be used.
  const accessBlocked = isAccessBlocked(result);

  // The sweep is offered only when one photo told us nothing, and only when
  // this result didn't already come from a sweep — asking someone to turn on
  // the spot costs time and is not free of risk on a pavement, so it is an
  // escalation and never the default. When offered it takes the primary slot,
  // because it's the only action likely to get them further.
  // state.sweepFrames is the same signal main.ts uses for the spoken offer:
  // empty means this result came from a single photo. photoIndex can't serve
  // here — a sweep that found nothing reports null, same as a single photo.
  const offerSweep = isUnclear(result) && state.sweepFrames.length === 0;
  const sweepButton = offerSweep
    ? `<button class="btn btn-primary" id="look-around-btn" type="button">Look around</button>`
    : '';
  const cardClass = result.arrived ? 'result-card arrived' : 'result-card walking';
  const statusText = accessBlocked
    ? "You're here — check the way in"
    : result.arrived
      ? "You've arrived"
      : 'Not there yet';
  const statusClass = result.arrived ? 'result-status arrived-text' : 'result-status';

  app.innerHTML = `
    ${headerHtml()}
    <div class="${cardClass}" id="result-card" tabindex="-1">
      <p class="${statusClass}">${statusText}</p>
      <p class="confidence">Confidence: ${escapeHtml(result.confidence || 'unknown')}</p>

      <div class="next-step">
        <div class="arrow" aria-hidden="true">${step.arrow}</div>
        <div class="label">${escapeHtml(step.label)}</div>
      </div>

      <div class="desc-block">
        <h3>What the photo shows</h3>
        <p>${escapeHtml(result.sceneDescription || '—')}</p>
        ${accessBlock}
        <h3>Why</h3>
        <p>${escapeHtml(result.matchReasoning || '—')}</p>
      </div>
    </div>

    <div class="stack">
      ${sweepButton}
      <button class="btn ${offerSweep ? 'btn-secondary' : 'btn-primary'}" id="repeat-btn" type="button">🔊 Say it again</button>
      <button class="btn btn-secondary" id="another-photo-btn" type="button">${result.arrived ? 'Take another photo anyway' : 'Take another photo'}</button>
      <button class="btn btn-secondary" id="new-dest-btn" type="button">Change destination</button>
    </div>
  `;

  onClick('look-around-btn', actions.startSweep);
  onClick('repeat-btn', actions.repeatGuidance);
  onClick('another-photo-btn', actions.goToCamera);
  onClick('new-dest-btn', actions.goToDestination);
  wireHeader(actions);

  // Park focus on the result itself so a screen-reader user lands on the
  // guidance and can read forward through it, instead of at the top of the page.
  byId('result-card')?.focus();

  const announcementPrefix = accessBlocked
    ? 'Here, but check the way in. '
    : result.arrived
      ? 'Arrived. '
      : 'Not there yet. ';
  // Tell screen-reader users the new button exists; they can't see it appear.
  const sweepHint = offerSweep
    ? " Tap Look around to take a few photos as you turn, and I'll try again."
    : '';
  announce(`${announcementPrefix}${result.spokenGuidance || ''}${sweepHint}`);
}
