/** Screen 1: what are you looking for? The only screen that isn't the camera. */

import { announce } from '../lib/announce';
import { BUILDINGS_SOURCE, displayName, matchBuilding, suggestBuildings } from '../lib/buildings';
import {
  isDictationSupported,
  isListening,
  startDictation,
  stopDictation,
} from '../lib/dictation';
import { byId, escapeHtml, onClick } from '../lib/dom';
import { UPDATE_PATTERN, buzz } from '../lib/speech';
import { state } from '../state';
import { headerHtml } from './header';
import type { Actions } from '../actions';

export function renderDestination(app: HTMLElement, actions: Actions): void {
  // The dictation button is only offered where the browser can honour it, so
  // nobody is given a control that silently does nothing.
  const dictation = isDictationSupported()
    ? `<button class="btn btn-secondary" id="dictate-btn" type="button">
        <span aria-hidden="true">🎤</span>
        <span id="dictate-label">Speak the destination</span>
      </button>`
    : '';

  app.innerHTML = `
    <div class="sheet">
    ${headerHtml()}
    <h2>Where are you headed?</h2>
    <p class="lead">Describe the place in your own words. Be as specific as you can — a building name, a store, an entrance.</p>
    <label for="dest-input">Destination</label>
    <input id="dest-input" type="text" placeholder="e.g. Green Library, or 450 Jane Stanford Way" value="${escapeHtml(state.destination)}" autocomplete="off" list="building-suggestions" aria-describedby="match-status" />
    <datalist id="building-suggestions"></datalist>
    <p class="match-status" id="match-status" role="status">${matchStatusHtml(state.destination)}</p>
    <p class="dictate-status" id="dictate-status"></p>
    <div class="stack">
      ${dictation}
      <button class="btn btn-primary" id="continue-btn" type="button">Continue</button>
    </div>
    <footer class="note">Prototype demo. Uses your camera and, if you allow it, your location to guide you and describe your surroundings — nothing is saved. Accessible entrance information comes from ${escapeHtml(BUILDINGS_SOURCE)}.</footer>
    </div>
  `;

  const input = byId<HTMLInputElement>('dest-input');
  if (input) {
    input.focus();
    input.addEventListener('input', () => {
      state.destination = input.value;
      refreshSuggestions(input.value);
    });
    // Enter submits: reaching for a small "Continue" target is the hard part.
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') actions.goToCamera();
    });
  }

  onClick('continue-btn', actions.goToCamera);
  onClick('dictate-btn', toggleDictation);
}

function setStatus(text: string): void {
  const status = byId('dictate-status');
  if (status) status.textContent = text;
}

function setButtonLabel(text: string, listening: boolean): void {
  const label = byId('dictate-label');
  const button = byId('dictate-btn');
  if (label) label.textContent = text;
  if (button) {
    button.setAttribute('aria-label', text);
    button.classList.toggle('is-listening', listening);
  }
}

/** Start or stop listening. Called from the button's own tap, as the mic needs. */
function toggleDictation(): void {
  if (isListening()) {
    stopDictation();
    return;
  }

  const input = byId<HTMLInputElement>('dest-input');
  // Whether this session produced anything to say. If it didn't — the user
  // tapped Stop, or the browser gave up quietly — the status line must stop
  // claiming the microphone is open, because for someone relying on that line
  // it's the only indication either way.
  let resolved = false;

  const started = startDictation({
    onInterim(text) {
      // Show the words forming, so a partially-sighted user gets the same
      // feedback a sighted one would from a dictation indicator.
      if (input) input.value = text;
      setStatus(`Hearing: ${text}`);
    },

    onFinal(text) {
      resolved = true;
      if (input) input.value = text;
      state.destination = text;
      // Dictation bypasses the input event, so the match line has to be told.
      refreshSuggestions(text);
      setStatus(`Heard: ${text}`);
      buzz(UPDATE_PATTERN);
      announce(`Heard: ${text}. Press Continue, or edit the destination.`);
      // Park focus on Continue: for the common case where it heard correctly,
      // the next action is one press away.
      byId('continue-btn')?.focus();
    },

    onError(message) {
      resolved = true;
      setStatus(message);
      announce(message);
    },

    onEnd() {
      setButtonLabel('Speak the destination', false);
      if (!resolved) {
        setStatus('Stopped listening.');
        announce('Stopped listening. Nothing heard.');
      }
    },
  });

  if (!started) {
    setStatus("Couldn't start listening. You can type the destination instead.");
    announce("Couldn't start listening. You can type the destination instead.");
    return;
  }

  setButtonLabel('Stop listening', true);
  setStatus('Listening… say where you are headed.');
  announce('Listening. Say where you are headed.');
  // A buzz rather than a spoken prompt: the microphone is open, and the app
  // talking here would feed its own voice back into the recognizer.
  buzz(UPDATE_PATTERN);
}


/**
 * Tell the user, before they start walking, whether what they typed matched a
 * building Stanford has accessibility information for.
 *
 * This is the one place a wrong match is cheap to catch. Once they are
 * walking, a confidently wrong building is expensive — so the matched name is
 * always shown, never silently assumed.
 */
function matchStatusHtml(destination: string): string {
  const match = matchBuilding(destination);
  if (!match) {
    return destination.trim()
      ? "Not a building on Stanford's accessible-entrance list — guidance will come from the map and your camera."
      : '';
  }

  const { building } = match;
  const name = escapeHtml(displayName(building.name));

  if (!building.accessibleEntrance) {
    return `Matched <strong>${name}</strong>. Stanford has no accessible entrance details for it.`;
  }

  return building.lat === null
    ? `Matched <strong>${name}</strong> — accessible entrance details available, but Stanford doesn't publish its location, so there's no GPS guidance.`
    : `Matched <strong>${name}</strong> — accessible entrance details and GPS guidance available.`;
}

/**
 * Keep the suggestion list and the match line current as the user types.
 *
 * The suggestions are a datalist rather than a custom dropdown so that the
 * browser's own combobox semantics apply: screen readers announce the option
 * count and the active option without any ARIA of ours to get wrong.
 */
function refreshSuggestions(value: string): void {
  const list = byId('building-suggestions');
  if (list) {
    list.innerHTML = suggestBuildings(value)
      .map((building) => `<option value="${escapeHtml(displayName(building.name))}"></option>`)
      .join('');
  }

  const status = byId('match-status');
  if (status) status.innerHTML = matchStatusHtml(value);
}
