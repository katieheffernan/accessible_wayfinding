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
  /**
   * What the photo shows about getting in — steps, ramp, door type, threshold,
   * obstructions. Empty only when the model declined to fill it in.
   */
  accessNotes: string;
  /**
   * For a look-around sweep: which photo (1-based) shows the destination, or
   * null if none of them did. Absent for single-photo results.
   */
  photoIndex?: number | null;
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

/** A destination resolved to coordinates by the geocoder. */
export interface GeocodedPlace {
  lat: number;
  lon: number;
  /** The geocoder's own name for what it found, so the user can catch a bad match. */
  label: string;
}

/**
 * Where the destination lies relative to the user, computed in the browser from
 * GPS, the geocoded destination, and the compass.
 *
 * The numbers are raw on purpose: the server decides how much to trust them and
 * how to phrase it, so that judgement lives next to the prompt.
 */
export interface BearingContext {
  /** Great-circle distance to the geocoded destination, in metres. */
  distanceMeters: number;
  /** True bearing from the user to the destination, degrees clockwise from north. */
  bearingDegrees: number;
  /** Where the phone is pointing, degrees from north; null if there's no compass. */
  headingDegrees: number | null;
  /** Reported compass accuracy in degrees; null when the browser doesn't say. */
  headingAccuracyDegrees: number | null;
  /** What the geocoder thought the destination was. */
  destinationLabel: string;
}

/** One photo from a look-around sweep. */
export interface SweepFrame {
  /** Base64 JPEG payload with the `data:` URL prefix already stripped. */
  imageBase64: string;
  /** Compass heading at the shutter, or null where there's no compass. */
  headingDegrees: number | null;
  /**
   * How far round from the first photo this one is meant to be, per the turn
   * instructions the user was given (0, 90, 180, 270). This is what makes the
   * sweep useful without a compass: the angles are known from the instructions
   * even when nothing measured them.
   */
  nominalOffsetDegrees: number;
}

/** Context sent with either kind of request. */
interface AnalyzeRequestBase {
  destination: string;
  location?: LocationContext | null;
  bearing?: BearingContext | null;
}

/**
 * Request body for POST /api/analyze — one photo, or a sweep of several.
 * Discriminated so the server can't mistake one for the other.
 */
export type AnalyzeRequest =
  | (AnalyzeRequestBase & { kind: 'photo'; imageBase64: string })
  | (AnalyzeRequestBase & { kind: 'sweep'; frames: SweepFrame[] });
