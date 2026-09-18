/** The app's whole state. Five screens, one object — no framework needed. */

import type { GuidanceResult, LocationContext } from './types';

export type Screen = 'destination' | 'camera' | 'analyzing' | 'result' | 'error';

export interface AppState {
  screen: Screen;
  destination: string;
  /** Gathered in the background while the user frames their photo; null if unavailable. */
  location: LocationContext | null;
  lastPhotoDataUrl: string | null;
  lastResult: GuidanceResult | null;
  lastErrorMessage: string | null;
}

export const state: AppState = {
  screen: 'destination',
  destination: '',
  location: null,
  lastPhotoDataUrl: null,
  lastResult: null,
  lastErrorMessage: null,
};
