/**
 * Great-circle geometry for the compass hint.
 *
 * These are pure functions so the "which way is it" arithmetic happens in code
 * we can reason about, rather than being guessed by a model looking at a photo.
 */

const EARTH_RADIUS_M = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

export interface Point {
  lat: number;
  lon: number;
}

/** Great-circle distance between two points, in metres. */
export function distanceMeters(from: Point, to: Point): number {
  const φ1 = toRadians(from.lat);
  const φ2 = toRadians(to.lat);
  const Δφ = toRadians(to.lat - from.lat);
  const Δλ = toRadians(to.lon - from.lon);

  const a =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Initial bearing from one point to another: degrees clockwise from true north,
 * in the range [0, 360).
 */
export function bearingDegrees(from: Point, to: Point): number {
  const φ1 = toRadians(from.lat);
  const φ2 = toRadians(to.lat);
  const Δλ = toRadians(to.lon - from.lon);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Where the destination sits relative to the way the phone is pointing, in
 * (-180, 180]: negative is to the left, positive is to the right, 0 is straight
 * ahead, ±180 is directly behind.
 */
export function relativeBearing(bearing: number, heading: number): number {
  const delta = ((bearing - heading + 540) % 360) - 180;
  // -180 and 180 are the same direction; normalise to +180 so callers only
  // have to handle one of them.
  return delta === -180 ? 180 : delta;
}
