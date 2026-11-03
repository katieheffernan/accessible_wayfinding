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

/**
 * What Stanford publishes about getting into one building, from the campus
 * accessible-entrances list. This is authoritative, surveyed information — it
 * is kept strictly apart from what the camera sees, because the two can
 * disagree and the user needs to know which is which.
 */
export interface BuildingInfo {
  /** Stanford facility ID, e.g. "02-670". */
  id: string;
  name: string;
  address: string;
  /** Stanford's prose description of the accessible way in. May be empty. */
  accessibleEntrance: string;
  /** Centre of the building, or null where it could not be placed on a map. */
  lat: number | null;
  lon: number | null;
  /** Stanford's ADA page for the building. */
  url: string;
}

/**
 * What the live GPS watch is telling the user to do right now, independently of
 * any photo. Distinct from NextStep: this is continuous, comes from geometry
 * alone, and knows nothing about doors.
 */
export type NavigationStep =
  | 'walk_forward'
  | 'turn_left'
  | 'turn_right'
  | 'turn_around'
  | 'arrived'
  /** Position or heading too poor to say anything about direction. */
  | 'unknown';

/** A single reading of where the user is relative to their destination. */
export interface NavigationFix {
  step: NavigationStep;
  /** Metres to the destination. */
  distanceMeters: number;
  /** Reported GPS accuracy in metres — large values make `step` 'unknown'. */
  positionAccuracyMeters: number;
  /** Where the destination lies relative to the way the user faces, or null. */
  relativeBearingDegrees: number | null;
  /** How the facing direction was established, for honest phrasing. */
  headingSource: 'compass' | 'gps-course' | 'none';
  /**
   * Whether the facing direction is measured well enough to state a turn
   * outright. False means it is a hint worth hedging, not a lie — a phone
   * compass near steel is routinely tens of degrees out.
   */
  headingTrusted: boolean;
  /** True once the user is inside the arrival radius. */
  arrived: boolean;
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
  /**
   * Stanford's own record for the building the destination was matched to, when
   * it matched one. Gives the model a surveyed description of the accessible
   * entrance to look for, rather than leaving it to guess from the photo alone.
   */
  building?: BuildingInfo | null;
  /** The live GPS reading at the moment the shutter was pressed, if any. */
  navigation?: NavigationFix | null;
}

/**
 * Request body for POST /api/analyze — one photo, or a sweep of several.
 * Discriminated so the server can't mistake one for the other.
 */
export type AnalyzeRequest =
  | (AnalyzeRequestBase & { kind: 'photo'; imageBase64: string })
  | (AnalyzeRequestBase & { kind: 'sweep'; frames: SweepFrame[] });
