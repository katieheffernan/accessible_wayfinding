/**
 * Types shared between the browser app and the server-side analysis function.
 * The GuidanceResult shape is the JSON contract we ask Claude to return.
 */

export type NextStep =
  | 'walk_forward'
  | 'turn_left'
  | 'turn_right'
  | 'turn_around'
  | 'look_for_entrance'
  | 'arrived'
  | 'unclear';

export type Confidence = 'high' | 'medium' | 'low';

/** The structured guidance Claude returns for a single photo. */
export interface GuidanceResult {
  arrived: boolean;
  confidence: Confidence;
  sceneDescription: string;
  matchReasoning: string;
  nextStep: NextStep;
  spokenGuidance: string;
}

/** Best-effort location context, gathered in the browser if the user allows it. */
export interface LocationContext {
  lat: number;
  lon: number;
  /** Reverse-geocoded address guess, or null if the lookup failed or is pending. */
  label: string | null;
}

/** Request body for POST /api/analyze. */
export interface AnalyzeRequest {
  destination: string;
  /** Base64 JPEG payload with the `data:` URL prefix already stripped. */
  imageBase64: string;
  location?: LocationContext | null;
}
