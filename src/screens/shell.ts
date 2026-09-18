/**
 * The camera-first shell.
 *
 * The viewfinder, the destination bar and the shutter are mounted once and then
 * left alone; only the overlay in the middle changes as the app moves between
 * framing, analysing, showing a result and reporting an error. That is the whole
 * point of the camera-first loop: the camera never goes away, so there is no
 * screen change to re-orient to, the next photo is always one press away, and
 * keyboard focus is never destroyed underneath the user — the shutter they are
 * focused on is the same element throughout.
 *
 * Text is never written onto the live image. Everything readable sits on an
 * opaque panel, because contrast against a moving photograph cannot be
 * guaranteed and this app is for people who need that guarantee.
 */

import { byId, escapeHtml } from '../lib/dom';
import { state } from '../state';
import type { Actions } from '../actions';

export interface ShutterConfig {
  /** Visible label under the icon, and the button's accessible name. */
  label: string;
  icon: string;
  disabled: boolean;
  onPress: () => void;
}

export interface SideButtonConfig {
  label: string;
  icon: string;
  onPress: () => void;
}

let mounted = false;
let shutterAction: (() => void) | null = null;
let leftAction: (() => void) | null = null;
let rightAction: (() => void) | null = null;

/** Is the shell currently in the DOM? */
export function isShellMounted(): boolean {
  return mounted;
}

/** Build the shell. Safe to call repeatedly; only the first call rebuilds. */
export function mountShell(app: HTMLElement, actions: Actions): void {
  if (mounted && byId('viewfinder-video')) return;

  app.innerHTML = `
    <div class="camera-shell">
      <div class="dest-bar">
        <div>
          <p class="dest-label">Heading to</p>
          <p class="dest-name" id="dest-name">${escapeHtml(state.destination)}</p>
        </div>
        <button id="change-dest-btn" type="button">Change</button>
      </div>

      <div class="viewfinder">
        <video id="viewfinder-video" autoplay playsinline muted></video>
        <div class="overlay" id="overlay"></div>
      </div>

      <div class="shutter-row">
        <button class="side-btn" id="left-btn" type="button" hidden>
          <span class="side-icon" aria-hidden="true">🔊</span>
          <span id="left-label">Say it again</span>
        </button>

        <button class="shutter" id="shutter-btn" type="button">
          <span class="shutter-icon" aria-hidden="true" id="shutter-icon">◉</span>
          <span id="shutter-label">Take photo</span>
        </button>

        <button class="side-btn" id="right-btn" type="button" hidden>
          <span class="side-icon" aria-hidden="true">↻</span>
          <span id="right-label">Look around</span>
        </button>
      </div>
    </div>
  `;

  // Listeners are attached once, to nodes that never get replaced, and delegate
  // to whatever the current state has registered.
  // aria-disabled rather than the disabled property: a disabled element is
  // blurred by the browser, which would throw a keyboard or switch-access user
  // out of position every time an analysis starts. So the button stays
  // focusable and simply ignores presses while it is unavailable.
  byId('shutter-btn')?.addEventListener('click', (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    if (button.getAttribute('aria-disabled') === 'true') return;
    shutterAction?.();
  });
  byId('left-btn')?.addEventListener('click', () => leftAction?.());
  byId('right-btn')?.addEventListener('click', () => rightAction?.());
  byId('change-dest-btn')?.addEventListener('click', actions.goToDestination);

  mounted = true;
}

/** Tear the shell down, when leaving for the destination form. */
export function unmountShell(): void {
  mounted = false;
  shutterAction = null;
  leftAction = null;
  rightAction = null;
}

/** Keep the destination bar in step with the state without rebuilding the shell. */
export function refreshDestinationName(): void {
  const name = byId('dest-name');
  if (name) name.textContent = state.destination;
}

/** Replace the overlay content. Focus lives on the shutter, outside this region. */
export function setOverlay(html: string): void {
  const overlay = byId('overlay');
  if (overlay) overlay.innerHTML = html;
}

/**
 * Update the shutter in place — label and icon are rewritten, the element is
 * not, so a focused shutter stays focused across a state change.
 */
export function setShutter(config: ShutterConfig): void {
  const button = byId<HTMLButtonElement>('shutter-btn');
  const label = byId('shutter-label');
  const icon = byId('shutter-icon');
  if (!button || !label || !icon) return;

  label.textContent = config.label;
  icon.textContent = config.icon;
  button.setAttribute('aria-disabled', String(config.disabled));
  // The visible label is the accessible name, so they can never disagree.
  button.setAttribute('aria-label', config.label);
  shutterAction = config.onPress;
}

/** Show or hide the two contextual buttons flanking the shutter. */
export function setSideButtons(left: SideButtonConfig | null, right: SideButtonConfig | null): void {
  applySide('left', left, (action) => {
    leftAction = action;
  });
  applySide('right', right, (action) => {
    rightAction = action;
  });
}

function applySide(
  side: 'left' | 'right',
  config: SideButtonConfig | null,
  store: (action: (() => void) | null) => void,
): void {
  const button = byId<HTMLButtonElement>(`${side}-btn`);
  const label = byId(`${side}-label`);
  if (!button || !label) return;

  if (!config) {
    button.hidden = true;
    store(null);
    return;
  }

  label.textContent = config.label;
  button.querySelector('.side-icon')!.textContent = config.icon;
  button.setAttribute('aria-label', config.label);
  button.hidden = false;
  store(config.onPress);
}

/** The live video element, if the shell is mounted. */
export function videoElement(): HTMLVideoElement | null {
  return byId<HTMLVideoElement>('viewfinder-video');
}

/** Put keyboard focus on the shutter — used once, when the shell first appears. */
export function focusShutter(): void {
  byId('shutter-btn')?.focus();
}
