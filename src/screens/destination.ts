/** Screen 1: what are you looking for? The only screen that isn't the camera. */

import { announce } from '../lib/announce';
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
    <input id="dest-input" type="text" placeholder="e.g. Main entrance of the downtown library" value="${escapeHtml(state.destination)}" autocomplete="off" />
    <p class="dictate-status" id="dictate-status"></p>
    <div class="stack">
      ${dictation}
      <button class="btn btn-primary" id="continue-btn" type="button">Continue</button>
    </div>
    <footer class="note">Prototype demo. Uses your camera and, if you allow it, your location to help describe your surroundings — nothing is saved.</footer>
    </div>
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
