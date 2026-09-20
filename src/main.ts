/**
 * Here Yet — app entry point.
 *
 * Owns the state machine and the side effects hanging off each transition:
 * camera start/stop, the background location and geocode lookups, the compass,
 * the analysis request, speech and haptics.
 *
 * The loop is camera-first. Apart from the destination form, every state is the
 * same screen — the viewfinder with a different overlay — so the camera is never
 * torn down, the next photo is always one press of the shutter away, and the
 * shutter keeps keyboard focus across a state change instead of the page being
 * rebuilt underneath the user.
 */

import './styles.css';

import { announce } from './lib/announce';
import { AnalysisError, requestGuidance, requestSweepGuidance, toBase64 } from './lib/api';
import { CameraError, captureFrame, isCameraRunning, startCamera, stopCamera } from './lib/camera';
import { bearingDegrees, distanceMeters } from './lib/geometry';
import { isAccessBlocked, isUnclear } from './lib/guidance';
import {
  currentHeading,
  requestHeadingAccess,
  startHeadingWatch,
  stopHeadingWatch,
} from './lib/heading';
import { geocodeDestination, getLocationContext } from './lib/location';
import { ARRIVED_PATTERN, buzz, speak, UPDATE_PATTERN } from './lib/speech';
import { state } from './state';
import type { Actions } from './actions';
import type { BearingContext, GuidanceResult } from './types';
import { cameraErrorOverlay } from './screens/camera';
import { renderDestination } from './screens/destination';
import {
  analyzingOverlay,
  errorOverlay,
  idleOverlay,
  resultOverlay,
  sweepOverlay,
} from './screens/overlays';
import {
  focusShutter,
  isShellMounted,
  mountShell,
  refreshDestinationName,
  setOverlay,
  setShutter,
  setSideButtons,
  unmountShell,
  videoElement,
} from './screens/shell';
import { SWEEP_STEPS } from './screens/sweep';

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app element');

/**
 * Identifies the in-flight analysis. Incremented on every new request so a slow
 * reply that lands after the user has moved on is dropped instead of replacing
 * what they are now looking at.
 */
let currentAnalysis = 0;

/** The destination string we last geocoded, so a lookup happens once per place. */
let geocodedFor: string | null = null;

/** Refreshes the bearing line as the user turns. */
let bearingTicker: number | null = null;

/** A camera problem to show instead of the normal overlay, until it recovers. */
let cameraProblem: string | null = null;

function render(): void {
  if (!app) return;

  if (state.screen === 'destination') {
    unmountShell();
    stopCamera();
    renderDestination(app, actions);
    return;
  }

  const firstMount = !isShellMounted();
  mountShell(app, actions);
  refreshDestinationName();

  if (firstMount) {
    void openViewfinder();
    focusShutter();
  }

  paintOverlay();
}

/** Put the right overlay and shutter in place for the current state. */
function paintOverlay(): void {
  if (cameraProblem) {
    setOverlay(cameraErrorOverlay(cameraProblem));
    setShutter({ label: 'Try again', icon: '↻', disabled: false, onPress: retryCamera });
    setSideButtons(null, null);
    return;
  }

  switch (state.screen) {
    case 'camera':
      setOverlay(idleOverlay(bearingStatusText()));
      setShutter({
        label: 'Take photo',
        icon: '◉',
        disabled: false,
        onPress: actions.capturePhoto,
      });
      setSideButtons(null, null);
      return;

    case 'sweep': {
      const stepNumber = state.sweepFrames.length + 1;
      const step = SWEEP_STEPS[stepNumber - 1];
      if (!step) return;
      setOverlay(sweepOverlay(step.instruction, stepNumber, SWEEP_STEPS.length));
      setShutter({
        label: stepNumber === SWEEP_STEPS.length ? 'Last photo' : `Photo ${stepNumber}`,
        icon: '◉',
        disabled: false,
        onPress: actions.captureSweepPhoto,
      });
      setSideButtons(null, {
        label: 'Stop',
        icon: '✕',
        onPress: actions.cancelSweep,
      });
      return;
    }

    case 'analyzing':
      setOverlay(analyzingOverlay());
      setShutter({ label: 'Working…', icon: '◉', disabled: true, onPress: () => {} });
      setSideButtons(null, null);
      return;

    case 'result': {
      const result = state.lastResult;
      if (!result) return;
      setOverlay(resultOverlay(result));
      setShutter({
        label: 'Take another',
        icon: '◉',
        disabled: false,
        onPress: actions.capturePhoto,
      });
      setSideButtons(
        { label: 'Say it again', icon: '🔊', onPress: actions.repeatGuidance },
        // The sweep is offered only when a single photo told us nothing, and
        // never twice in a row.
        isUnclear(result) && state.sweepFrames.length === 0
          ? { label: 'Look around', icon: '↻', onPress: actions.startSweep }
          : null,
      );
      return;
    }

    case 'error':
      setOverlay(errorOverlay(state.lastErrorMessage ?? 'Something went wrong.'));
      setShutter({
        label: 'Try again',
        icon: '◉',
        disabled: false,
        onPress: actions.capturePhoto,
      });
      setSideButtons(null, null);
      return;

    case 'destination':
      return;
  }
}

/** Attach the camera to the shell's video element. */
async function openViewfinder(): Promise<void> {
  const video = videoElement();
  if (!video) return;

  try {
    await startCamera(video);
    cameraProblem = null;
    paintOverlay();
  } catch (error) {
    if (error instanceof CameraError) {
      cameraProblem = error.message;
      paintOverlay();
      return;
    }
    throw error;
  }
}

function retryCamera(): void {
  cameraProblem = null;
  paintOverlay();
  void openViewfinder();
}

/**
 * Shorten a geocoder label to something speakable. display_name runs to the
 * country and postcode, which is noise when you only need to know it found the
 * right building.
 */
function shortLabel(label: string): string {
  return label.split(',').slice(0, 2).join(',').trim();
}

/**
 * Compose the compass context from the three things that have to line up: where
 * the user is, where the destination is, and which way the phone points. Returns
 * null unless the first two are known — with no destination coordinates there is
 * no direction to give, and the app falls back to reading the photo alone.
 */
function buildBearing(): BearingContext | null {
  const { location, destinationPlace } = state;
  if (!location || !destinationPlace) return null;

  const heading = currentHeading();

  return {
    distanceMeters: distanceMeters(location, destinationPlace),
    bearingDegrees: bearingDegrees(location, destinationPlace),
    headingDegrees: heading?.degrees ?? null,
    headingAccuracyDegrees: heading?.accuracyDegrees ?? null,
    destinationLabel: destinationPlace.label,
  };
}

/**
 * The line shown while framing. It always says something, and it names which of
 * the two inputs is missing — a map fix and a compass reading are separately
 * losable, they fail for different reasons, and "no direction available" with
 * no explanation leaves the user unable to tell a broken app from a limitation.
 */
function bearingStatusText(): string {
  const heading = currentHeading();
  const bearing = buildBearing();

  if (!state.destinationPlace || !bearing) {
    return heading
      ? 'No map match for that destination — guidance comes from the photo alone. Compass ready.'
      : 'No map match and no compass — guidance comes from the photo alone.';
  }

  const name = shortLabel(state.destinationPlace.label);
  const distance =
    bearing.distanceMeters < 1000
      ? `${Math.round(bearing.distanceMeters / 10) * 10} m`
      : `${(bearing.distanceMeters / 1000).toFixed(1)} km`;

  if (!heading) {
    return `Map: ${name}, about ${distance} away. No compass — left and right come from the photo.`;
  }

  const relative = ((bearing.bearingDegrees - heading.degrees + 540) % 360) - 180;
  const magnitude = Math.abs(relative);
  const side = relative < 0 ? 'left' : 'right';
  const direction =
    magnitude <= 15 ? 'straight ahead' : magnitude <= 120 ? `to your ${side}` : 'behind you';

  return `Map: ${name}, about ${distance} away, ${direction}.`;
}

/**
 * Refresh location and resolve the destination to coordinates while the user
 * frames their shot. Every step is optional: failure leaves the app working
 * exactly as it did before the compass existed.
 */
async function prepareContext(): Promise<void> {
  const location = await getLocationContext();
  if (location) state.location = location;

  if (geocodedFor !== state.destination) {
    const place = await geocodeDestination(state.destination, state.location);
    state.destinationPlace = place;
    geocodedFor = state.destination;
  }

  if (state.screen !== 'camera') return;
  paintOverlay();

  // Announce the outcome once, including a failed lookup — being told the map
  // didn't find the place is more useful than silence. Later updates are
  // silent: the line changes as the user turns, and announcing each change
  // would be unusable.
  announce(bearingStatusText());
}

/** Keep the bearing line current as the user turns, without announcing it. */
function startBearingTicker(): void {
  stopBearingTicker();
  bearingTicker = window.setInterval(() => {
    if (state.screen !== 'camera') {
      stopBearingTicker();
      return;
    }
    if (state.destinationPlace && !cameraProblem) paintOverlay();
  }, 1000);
}

function stopBearingTicker(): void {
  if (bearingTicker !== null) {
    window.clearInterval(bearingTicker);
    bearingTicker = null;
  }
}

/** Ask for the compass. Must be called from inside a tap to satisfy iOS. */
function ensureCompass(): void {
  void requestHeadingAccess().then((granted) => {
    if (granted) startHeadingWatch();
  });
}

/**
 * Run an analysis request and show the result (or the error). Shared by single
 * photos and sweeps so both announce, speak and buzz identically.
 */
async function runAnalysis(request: () => Promise<GuidanceResult>): Promise<void> {
  const analysisId = ++currentAnalysis;

  try {
    const result = await request();
    if (analysisId !== currentAnalysis || state.screen !== 'analyzing') return;

    state.lastResult = result;
    state.screen = 'result';
    render();

    // Haptics first, then speech: a distinct pattern tells someone they've
    // arrived before the sentence finishes, and works with the phone in a
    // pocket. The arrival pattern means "you can stop walking", so it stays
    // quiet when the way in isn't usable yet.
    buzz(result.arrived && !isAccessBlocked(result) ? ARRIVED_PATTERN : UPDATE_PATTERN);

    // When a photo told us nothing, the useful next move is the sweep — so say
    // so. The model writes one sentence by design, so this second one is the
    // app's, kept short, and only for the case with no other way forward.
    const sweepOffer =
      isUnclear(result) && state.sweepFrames.length === 0
        ? " Press Look around, and I'll take you through a few photos as you turn."
        : '';

    speak(`${result.spokenGuidance || result.sceneDescription || ''}${sweepOffer}`);
    announce(
      `${isAccessBlocked(result) ? 'Here, but check the way in. ' : result.arrived ? 'Arrived. ' : 'Not there yet. '}${result.spokenGuidance || ''}${sweepOffer}`,
    );
  } catch (error) {
    if (analysisId !== currentAnalysis || state.screen !== 'analyzing') return;

    state.lastErrorMessage =
      error instanceof AnalysisError
        ? error.message
        : 'Something went wrong reaching the analysis service. Check your connection and try again.';
    state.screen = 'error';
    render();
    speak("Something went wrong. Let's try that again.");
    announce(state.lastErrorMessage);
  }
}

/** Grab the current frame, or announce why we couldn't. */
function grabFrame(): string | null {
  const video = videoElement();
  const photoDataUrl = video ? captureFrame(video) : null;

  if (!photoDataUrl) {
    announce(isCameraRunning() ? 'Camera is not ready yet.' : 'The camera is not running.');
    return null;
  }
  return photoDataUrl;
}

const actions: Actions = {
  goToDestination(): void {
    currentAnalysis++; // abandon any in-flight analysis
    state.sweepFrames = [];
    stopCamera();
    stopHeadingWatch();
    stopBearingTicker();
    cameraProblem = null;
    state.screen = 'destination';
    render();
  },

  goToCamera(): void {
    if (!state.destination.trim()) {
      announce('Please enter a destination first.');
      return;
    }

    // Inside the Continue tap, which is what iOS requires for the compass.
    ensureCompass();

    state.sweepFrames = [];
    state.screen = 'camera';
    render();
    void prepareContext();
    startBearingTicker();
  },

  capturePhoto(): void {
    const photoDataUrl = grabFrame();
    if (!photoDataUrl) return;

    // Read the compass at the shutter, not later: it describes where the phone
    // was pointing for this photo.
    const bearing = buildBearing();

    state.lastPhotoDataUrl = photoDataUrl;
    state.sweepFrames = [];
    stopBearingTicker();
    state.screen = 'analyzing';
    render();
    void runAnalysis(() =>
      requestGuidance(photoDataUrl, state.destination, state.location, bearing),
    );
  },

  startSweep(): void {
    state.sweepFrames = [];
    state.screen = 'sweep';
    // The compass matters more here than anywhere else, since each frame needs
    // its own heading. This call is inside the button's gesture.
    ensureCompass();
    render();

    const first = SWEEP_STEPS[0]?.instruction ?? '';
    announce(first);
    speak(first);
  },

  cancelSweep(): void {
    state.sweepFrames = [];
    state.screen = 'camera';
    render();
    startBearingTicker();
    announce('Stopped looking around.');
  },

  captureSweepPhoto(): void {
    const photoDataUrl = grabFrame();
    if (!photoDataUrl) return;

    const step = SWEEP_STEPS[state.sweepFrames.length];
    if (!step) return;

    state.sweepFrames = [
      ...state.sweepFrames,
      {
        imageBase64: toBase64(photoDataUrl),
        headingDegrees: currentHeading()?.degrees ?? null,
        nominalOffsetDegrees: step.offsetDegrees,
      },
    ];

    const next = SWEEP_STEPS[state.sweepFrames.length];

    if (next) {
      // Confirm the shot with a buzz before speaking the next instruction, so
      // the user knows it landed without waiting for the sentence.
      buzz(UPDATE_PATTERN);
      render();
      announce(next.instruction);
      speak(next.instruction);
      return;
    }

    const frames = state.sweepFrames;
    // The first frame's heading is the reference direction the labels are
    // relative to, so the compass paragraph and the frame angles agree.
    const bearing = buildBearing();
    const sweepBearing: BearingContext | null = bearing
      ? { ...bearing, headingDegrees: frames[0]?.headingDegrees ?? null }
      : null;

    state.screen = 'analyzing';
    render();
    speak("That's all of them. Give me a moment.");
    void runAnalysis(() =>
      requestSweepGuidance(frames, state.destination, state.location, sweepBearing),
    );
  },

  repeatGuidance(): void {
    const result = state.lastResult;
    if (!result) return;
    speak(result.spokenGuidance || result.sceneDescription || '');
  },
};

render();
