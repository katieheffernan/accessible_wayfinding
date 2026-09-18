/**
 * Here Yet — app entry point.
 *
 * Owns the state machine (destination → camera → analyzing → result, with an
 * error branch) and the side effects that hang off each transition: camera
 * start/stop, the background location lookup, the analysis request, speech and
 * haptics. Screens are pure-ish renderers that call back into `actions`.
 */

import './styles.css';

import { announce } from './lib/announce';
import { AnalysisError, requestGuidance } from './lib/api';
import { CameraError, captureFrame, startCamera, stopCamera } from './lib/camera';
import { bearingDegrees, distanceMeters } from './lib/geometry';
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
import type { BearingContext } from './types';
import { renderAnalyzing } from './screens/analyzing';
import { renderCamera, setBearingStatus, showCameraError, videoElement } from './screens/camera';
import { renderDestination } from './screens/destination';
import { renderError } from './screens/error';
import { renderResult } from './screens/result';

const app = document.getElementById('app');
if (!app) throw new Error('Missing #app element');

/**
 * Identifies the in-flight analysis. Incremented on every new request so a slow
 * reply that lands after the user has moved on is dropped instead of yanking
 * them onto a stale result screen.
 */
let currentAnalysis = 0;

/** The destination string we last geocoded, so a lookup happens once per place. */
let geocodedFor: string | null = null;

/** Refreshes the on-screen bearing line as the user turns. */
let bearingTicker: number | null = null;

function render(): void {
  if (!app) return;

  switch (state.screen) {
    case 'destination':
      renderDestination(app, actions);
      return;
    case 'camera':
      renderCamera(app, actions);
      return;
    case 'analyzing':
      renderAnalyzing(app, actions);
      return;
    case 'result':
      renderResult(app, actions);
      return;
    case 'error':
      renderError(app, actions);
      return;
  }
}

/** Attach the camera to the freshly rendered viewfinder. */
async function openViewfinder(): Promise<void> {
  const video = videoElement();
  if (!video) return;

  try {
    await startCamera(video);
  } catch (error) {
    if (error instanceof CameraError) {
      // Only complain if the user is still looking at the viewfinder.
      if (state.screen === 'camera') showCameraError(error.message);
      return;
    }
    throw error;
  }
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

/** The camera-screen status line: what we found, and whether we can use it. */
function bearingStatusText(): string {
  const bearing = buildBearing();

  if (!state.destinationPlace) {
    return "Couldn't place that destination on a map — guidance will come from the photo alone.";
  }
  if (!bearing) return '';

  const name = shortLabel(state.destinationPlace.label);
  const distance =
    bearing.distanceMeters < 1000
      ? `${Math.round(bearing.distanceMeters / 10) * 10} m`
      : `${(bearing.distanceMeters / 1000).toFixed(1)} km`;

  const heading = currentHeading();
  if (!heading) {
    return `Map: ${name}, about ${distance} away. No compass — direction will come from the photo.`;
  }

  const relative = ((bearing.bearingDegrees - heading.degrees + 540) % 360) - 180;
  const magnitude = Math.abs(relative);
  const side = relative < 0 ? 'left' : 'right';
  const direction =
    magnitude <= 15
      ? 'straight ahead'
      : magnitude <= 120
        ? `to your ${side}`
        : 'behind you';

  return `Map: ${name}, about ${distance} away, ${direction}.`;
}

/**
 * Refresh location and resolve the destination to coordinates while the user
 * frames their shot. Every step is optional: failure leaves the app working
 * exactly as it did before the compass existed.
 *
 * A previous position fix is kept rather than cleared on failure, since a
 * slightly old position is still better context than none.
 */
async function prepareContext(): Promise<void> {
  const location = await getLocationContext();
  if (location) state.location = location;

  // Geocode once per destination, biased to near the user if we have a fix.
  if (geocodedFor !== state.destination) {
    const place = await geocodeDestination(state.destination, state.location);
    state.destinationPlace = place;
    geocodedFor = state.destination;
  }

  if (state.screen !== 'camera') return;

  setBearingStatus(bearingStatusText());

  // Announce the lookup result once. Subsequent updates are silent: the line
  // changes as the user turns, and announcing each change would be unusable.
  if (state.destinationPlace) {
    announce(bearingStatusText());
  }
}

/** Keep the bearing line current as the user turns, without announcing it. */
function startBearingTicker(): void {
  stopBearingTicker();
  bearingTicker = window.setInterval(() => {
    if (state.screen !== 'camera') {
      stopBearingTicker();
      return;
    }
    if (state.destinationPlace) setBearingStatus(bearingStatusText());
  }, 1000);
}

function stopBearingTicker(): void {
  if (bearingTicker !== null) {
    window.clearInterval(bearingTicker);
    bearingTicker = null;
  }
}

/** Send the photo for analysis and move to the result (or error) screen. */
async function analyzePhoto(photoDataUrl: string, bearing: BearingContext | null): Promise<void> {
  const analysisId = ++currentAnalysis;

  try {
    const result = await requestGuidance(photoDataUrl, state.destination, state.location, bearing);
    if (analysisId !== currentAnalysis || state.screen !== 'analyzing') return;

    state.lastResult = result;
    state.screen = 'result';
    render();

    // Haptics first, then speech: a distinct buzz pattern tells someone they've
    // arrived before the sentence finishes, and works with the phone in a pocket.
    buzz(result.arrived ? ARRIVED_PATTERN : UPDATE_PATTERN);
    speak(result.spokenGuidance || result.sceneDescription || '');
  } catch (error) {
    if (analysisId !== currentAnalysis || state.screen !== 'analyzing') return;

    state.lastErrorMessage =
      error instanceof AnalysisError
        ? error.message
        : 'Something went wrong reaching the analysis service. Check your connection and try again.';
    state.screen = 'error';
    render();
    speak("Something went wrong. Let's try that again.");
  }
}

const actions: Actions = {
  goToDestination(): void {
    currentAnalysis++; // abandon any in-flight analysis
    stopCamera();
    stopHeadingWatch();
    stopBearingTicker();
    state.screen = 'destination';
    render();
  },

  goToCamera(): void {
    if (!state.destination.trim()) {
      announce('Please enter a destination first.');
      return;
    }

    // The compass permission prompt on iOS only works from inside a user
    // gesture, which is what got us here — so ask before anything awaits.
    void requestHeadingAccess().then((granted) => {
      if (granted) startHeadingWatch();
    });

    state.screen = 'camera';
    render();
    void openViewfinder();
    void prepareContext();
    startBearingTicker();
  },

  capturePhoto(): void {
    const video = videoElement();
    const photoDataUrl = video ? captureFrame(video) : null;

    if (!photoDataUrl) {
      announce('Camera is not ready yet.');
      return;
    }

    // Read the compass at the shutter, not later: it describes where the phone
    // was pointing for this photo.
    const bearing = buildBearing();

    state.lastPhotoDataUrl = photoDataUrl;
    stopCamera();
    stopHeadingWatch();
    stopBearingTicker();
    state.screen = 'analyzing';
    render();
    void analyzePhoto(photoDataUrl, bearing);
  },

  repeatGuidance(): void {
    const result = state.lastResult;
    if (!result) return;
    speak(result.spokenGuidance || result.sceneDescription || '');
  },
};

render();
