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
import { getLocationContext } from './lib/location';
import { ARRIVED_PATTERN, buzz, speak, UPDATE_PATTERN } from './lib/speech';
import { state } from './state';
import type { Actions } from './actions';
import { renderAnalyzing } from './screens/analyzing';
import { renderCamera, showCameraError, videoElement } from './screens/camera';
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
 * Refresh location in the background while the user frames their shot. Failure
 * is fine — and a previous fix is kept rather than cleared, since a slightly old
 * position is still better context than none.
 */
async function refreshLocation(): Promise<void> {
  const location = await getLocationContext();
  if (location) state.location = location;
}

/** Send the photo for analysis and move to the result (or error) screen. */
async function analyzePhoto(photoDataUrl: string): Promise<void> {
  const analysisId = ++currentAnalysis;

  try {
    const result = await requestGuidance(photoDataUrl, state.destination, state.location);
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
    state.screen = 'destination';
    render();
  },

  goToCamera(): void {
    if (!state.destination.trim()) {
      announce('Please enter a destination first.');
      return;
    }

    state.screen = 'camera';
    render();
    void openViewfinder();
    void refreshLocation();
  },

  capturePhoto(): void {
    const video = videoElement();
    const photoDataUrl = video ? captureFrame(video) : null;

    if (!photoDataUrl) {
      announce('Camera is not ready yet.');
      return;
    }

    state.lastPhotoDataUrl = photoDataUrl;
    stopCamera();
    state.screen = 'analyzing';
    render();
    void analyzePhoto(photoDataUrl);
  },

  repeatGuidance(): void {
    const result = state.lastResult;
    if (!result) return;
    speak(result.spokenGuidance || result.sceneDescription || '');
  },
};

render();
