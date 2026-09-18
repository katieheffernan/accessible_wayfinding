/**
 * Compass heading — which way the phone is pointing.
 *
 * Entirely best-effort. Browsers disagree about how to expose this, iOS needs an
 * explicit permission prompt triggered by a tap, and the reading can be badly
 * skewed near steel or strong magnets. Every path here degrades to "no heading",
 * which the prompt treats as "don't claim a direction" rather than as a zero.
 */

export interface HeadingReading {
  /** Degrees clockwise from true north. */
  degrees: number;
  /**
   * Reported accuracy in degrees, or null when the browser doesn't say. Null
   * means "usable but unverified" — it is not the same as accurate.
   */
  accuracyDegrees: number | null;
}

/** iOS exposes the compass on the standard event under prefixed properties. */
interface WebkitOrientationEvent extends DeviceOrientationEvent {
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

/** iOS gates the sensor behind a permission call that must come from a gesture. */
interface PermissionGatedOrientation {
  requestPermission?: () => Promise<'granted' | 'denied' | 'default'>;
}

let latest: HeadingReading | null = null;
let listening = false;

function handleOrientation(event: DeviceOrientationEvent): void {
  const ios = event as WebkitOrientationEvent;

  // iOS: webkitCompassHeading is already degrees from true north. A negative
  // accuracy means the reading is invalid, so drop it entirely.
  if (typeof ios.webkitCompassHeading === 'number') {
    const accuracy = ios.webkitCompassAccuracy;
    if (typeof accuracy === 'number' && accuracy < 0) {
      latest = null;
      return;
    }
    latest = {
      degrees: ios.webkitCompassHeading,
      accuracyDegrees: typeof accuracy === 'number' ? accuracy : null,
    };
    return;
  }

  // Everywhere else: absolute orientation gives alpha as degrees counter-clockwise
  // from north, so the compass heading is its complement. A non-absolute event
  // is relative to wherever the device happened to start — useless as a compass.
  if (event.absolute && typeof event.alpha === 'number') {
    latest = { degrees: (360 - event.alpha) % 360, accuracyDegrees: null };
  }
}

/**
 * Ask for compass access. Must be called from inside a user gesture (a tap) or
 * iOS will reject it. Resolves false when the compass is unavailable or refused;
 * the caller should carry on regardless.
 */
export async function requestHeadingAccess(): Promise<boolean> {
  if (typeof DeviceOrientationEvent === 'undefined') return false;

  const gated = DeviceOrientationEvent as unknown as PermissionGatedOrientation;
  if (typeof gated.requestPermission === 'function') {
    try {
      if ((await gated.requestPermission()) !== 'granted') return false;
    } catch {
      return false; // not called from a gesture, or the user dismissed it
    }
  }

  return true;
}

/** Start watching the compass. Safe to call repeatedly. */
export function startHeadingWatch(): void {
  if (listening || typeof window === 'undefined') return;

  // 'deviceorientationabsolute' is the true-north event where it exists;
  // 'deviceorientation' is the iOS path and the fallback.
  window.addEventListener('deviceorientationabsolute', handleOrientation, true);
  window.addEventListener('deviceorientation', handleOrientation, true);
  listening = true;
}

/** Stop watching and forget the last reading — the sensor costs battery. */
export function stopHeadingWatch(): void {
  if (!listening) return;

  window.removeEventListener('deviceorientationabsolute', handleOrientation, true);
  window.removeEventListener('deviceorientation', handleOrientation, true);
  listening = false;
  latest = null;
}

/** The most recent heading, or null if we never got a usable one. */
export function currentHeading(): HeadingReading | null {
  return latest;
}
