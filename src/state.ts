/** The app's whole state. Five screens, one object — no framework needed. */

import type { GeocodedPlace, GuidanceResult, LocationContext, SweepFrame } from './types';

export type Screen = 'destination' | 'camera' | 'sweep' | 'analyzing' | 'result' | 'error';

export interface AppState {
  screen: Screen;
  destination: string;
  /** Gathered in the background while the user frames their photo; null if unavailable. */
  location: LocationContext | null;
  /**
   * The destination resolved to coordinates, looked up once per destination.
   * Null when the geocoder found nothing — the app then works from the photo alone.
   */
  destinationPlace: GeocodedPlace | null;
  lastPhotoDataUrl: string | null;
  /** Photos taken so far in a look-around sweep, in the order they were taken. */
  sweepFrames: SweepFrame[];
  lastResult: GuidanceResult | null;
  lastErrorMessage: string | null;
}

export const state: AppState = {
  screen: 'destination',
  destination: '',
  location: null,
  destinationPlace: null,
  lastPhotoDataUrl: null,
  sweepFrames: [],
  lastResult: null,
  lastErrorMessage: null,
};
