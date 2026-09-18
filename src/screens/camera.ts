/** Screen 2: the viewfinder. */

import { byId, escapeHtml, onClick } from '../lib/dom';
import { headerHtml, wireHeader } from './header';
import type { Actions } from '../actions';

export function renderCamera(app: HTMLElement, actions: Actions): void {
  app.innerHTML = `
    ${headerHtml()}
    <h2>Look around, then take a photo</h2>
    <p class="lead">Point your camera at what's in front of you and take a photo. Hold the phone up at roughly eye level.</p>
    <div class="camera-wrap">
      <video id="video" autoplay playsinline muted></video>
    </div>
    <div id="camera-error"></div>
    <p class="bearing-status" id="bearing-status"></p>
    <div class="stack">
      <button class="btn btn-primary" id="capture-btn" type="button">Take photo</button>
      <button class="btn btn-secondary" id="back-btn" type="button">Change destination</button>
    </div>
  `;

  onClick('capture-btn', actions.capturePhoto);
  onClick('back-btn', actions.goToDestination);
  wireHeader(actions);

  // Re-rendering replaces the DOM, which drops keyboard focus to <body>. Put it
  // on the main action so a keyboard or switch-access user can shoot immediately.
  byId('capture-btn')?.focus();
}

/**
 * Show what the map lookup found, so a wrong geocode is catchable before you
 * start walking. Deliberately NOT an aria-live region: it updates as you turn,
 * and announcing every change would talk over everything else. It is plain text
 * in the reading order, so a screen reader picks it up on demand.
 */
export function setBearingStatus(text: string): void {
  const line = byId('bearing-status');
  if (line) line.textContent = text;
}

/** Show a camera problem inline, without leaving the screen. */
export function showCameraError(message: string): void {
  const box = byId('camera-error');
  if (box) box.innerHTML = `<div class="error-box">${escapeHtml(message)}</div>`;
}

/** The <video> element on the current screen, if the viewfinder is mounted. */
export function videoElement(): HTMLVideoElement | null {
  return byId<HTMLVideoElement>('video');
}
