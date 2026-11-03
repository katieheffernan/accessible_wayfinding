/**
 * Live GPS guidance to a building.
 *
 * This is the continuous half of the app. The camera answers "is this the
 * right place, and can I get in?" one photo at a time; this answers "which way,
 * and how far?" every second or so, hands-free, which is what you need while
 * actually walking.
 *
 * Three rules shape everything here:
 *
 * 1. **Never claim a direction that isn't measured.** A confident wrong turn
 *    walks someone who cannot check it further away. Where the facing direction
 *    is unknown or untrustworthy, the step is 'unknown' and the words say so.
 * 2. **Prefer course over compass while walking.** GPS course over ground comes
 *    from successive fixes, so it is immune to the magnetic interference that
 *    makes a phone compass unreliable next to a steel-framed building. It is
 *    only meaningful while actually moving, so the compass remains the fallback.
 * 3. **Say little.** Someone relying on speech while crossing a campus cannot
 *    use a sentence every second. Guidance is spoken on arrival, when the
 *    direction changes, and at distance milestones — not on every fix.
 *
 * The destination is the *building*, not its accessible entrance: Stanford
 * publishes entrance descriptions but not entrance coordinates. So arrival here
 * means "you are at the building", and the app hands over to the entrance
 * description and the camera for the last few metres. The wording never
 * promises more than that.
 */

import { bearingDegrees, distanceMeters, relativeBearing, type Point } from './geometry';
import { currentHeading } from './heading';
import type { NavigationFix, NavigationStep } from '../types';

/**
 * Inside this many metres of the building's centre, call it arrived. Generous
 * on purpose: the target is a building centroid, consumer GPS is good to a few
 * metres at best, and a large building's doors are a long way from its middle.
 */
const ARRIVAL_RADIUS_M = 30;

/**
 * Arrival is only withdrawn past this, so a user standing still at the door
 * isn't told they have arrived and then un-arrived as the fix wanders.
 */
const DEPARTURE_RADIUS_M = 50;

/**
 * A fix this vague cannot support an arrival claim or a turn. Common indoors,
 * under trees, and between tall buildings — all of which happen on a campus.
 */
const UNUSABLE_POSITION_ACCURACY_M = 40;

/** Compass accuracy at or under this is trustworthy enough to state a turn. */
const GOOD_HEADING_ACCURACY_DEGREES = 25;

/** Past this, the compass reading is noise and is discarded entirely. */
const UNUSABLE_HEADING_ACCURACY_DEGREES = 60;

/** Below this speed the GPS course is direction-of-noise, not direction-of-travel. */
const MIN_COURSE_SPEED_MS = 0.7;

/** Within this angle of straight ahead, "keep going" rather than "turn". */
const STRAIGHT_AHEAD_DEGREES = 25;

/** Beyond this angle, the destination is behind the user. */
const TURN_AROUND_DEGREES = 135;

/** Never speak two routine updates closer together than this. */
const MIN_ANNOUNCE_INTERVAL_MS = 9000;

/**
 * A *changed* direction may interrupt sooner than a routine update.
 *
 * Holding a new direction back for the full interval means walking on in the
 * old one: at normal walking pace nine seconds is over ten metres in the wrong
 * direction, which is exactly the error this app exists to prevent. Four
 * seconds is still long enough that turning on the spot produces one
 * instruction rather than a stream of them.
 */
const DIRECTION_CHANGE_INTERVAL_MS = 4000;

/**
 * While walking a straight line with nothing changing, repeat the guidance
 * this often. Silence is ambiguous when you cannot see: it reads the same as
 * the app having stopped working.
 */
const REASSURANCE_INTERVAL_MS = 30000;

/** Distances worth calling out as they are passed, in metres. */
const MILESTONES_M = [500, 200, 100, 50, 30];

export interface NavigationUpdate {
  fix: NavigationFix;
  /**
   * A sentence to speak, or null to stay quiet. Most updates are null — see
   * rule 3 above.
   */
  announcement: string | null;
  /** True only on the fix where arrival is first detected. */
  justArrived: boolean;
}

export interface NavigationOptions {
  destination: Point;
  /** The building's name, already in display case, for the spoken sentences. */
  destinationName: string;
  onUpdate(update: NavigationUpdate): void;
  /** Called when the position watch fails outright, e.g. permission refused. */
  onUnavailable(reason: string): void;
}

let watchId: number | null = null;

/** Everything the announcement policy needs to remember between fixes. */
interface WatchMemory {
  lastSpokenAt: number;
  lastStep: NavigationStep | null;
  lastSpokenDistance: number | null;
  milestonesPassed: Set<number>;
  arrived: boolean;
}

/**
 * Round a distance to a precision GPS actually justifies, and phrase it for
 * speech. "About 180 metres" is honest; "183 metres" is false precision read
 * aloud to someone who will act on it.
 */
export function describeDistance(meters: number): string {
  if (meters < 20) return 'just a few metres';
  if (meters < 100) return `about ${Math.round(meters / 10) * 10} metres`;
  if (meters < 1000) return `about ${Math.round(meters / 50) * 50} metres`;
  return `about ${(meters / 1000).toFixed(1)} kilometres`;
}

/** Which of the four directions an angle off the nose corresponds to. */
function stepFromRelativeBearing(relative: number): NavigationStep {
  const magnitude = Math.abs(relative);
  if (magnitude <= STRAIGHT_AHEAD_DEGREES) return 'walk_forward';
  if (magnitude > TURN_AROUND_DEGREES) return 'turn_around';
  return relative < 0 ? 'turn_left' : 'turn_right';
}

/**
 * Establish which way the user is facing, and how much to trust it.
 *
 * Course over ground wins while walking: it is derived from where the phone has
 * actually been, so no amount of nearby steel can bend it.
 */
function resolveHeading(coords: GeolocationCoordinates): {
  degrees: number | null;
  source: NavigationFix['headingSource'];
  trusted: boolean;
} {
  const { heading, speed } = coords;

  if (
    typeof heading === 'number' &&
    Number.isFinite(heading) &&
    typeof speed === 'number' &&
    speed >= MIN_COURSE_SPEED_MS
  ) {
    return { degrees: heading, source: 'gps-course', trusted: true };
  }

  const compass = currentHeading();
  if (!compass) return { degrees: null, source: 'none', trusted: false };

  const accuracy = compass.accuracyDegrees;
  if (accuracy !== null && accuracy > UNUSABLE_HEADING_ACCURACY_DEGREES) {
    return { degrees: null, source: 'none', trusted: false };
  }

  return {
    degrees: compass.degrees,
    source: 'compass',
    // A null accuracy means the browser didn't say — usable, but unverified.
    trusted: accuracy !== null && accuracy <= GOOD_HEADING_ACCURACY_DEGREES,
  };
}

/** Turn a fix into the sentence to say about it. */
function phrase(fix: NavigationFix, destinationName: string, justArrived: boolean): string {
  if (justArrived) {
    // Deliberately not "you're at the entrance": the target is the building,
    // and the way in is a separate question the camera answers next.
    return `You've reached ${destinationName}. Take a photo to find the accessible entrance.`;
  }

  const distance = describeDistance(fix.distanceMeters);

  if (fix.step === 'unknown') {
    return fix.relativeBearingDegrees === null
      ? `${destinationName} is ${distance} away. I can't tell which way you're facing, so point the camera ahead and take a photo.`
      : `${destinationName} is ${distance} away, but the signal is too weak to give you a direction.`;
  }

  // An unverified compass gets softer verbs. The direction is probably right,
  // and saying it is useful — but "should be" invites a check in a way that
  // "turn left" does not.
  const firm = fix.headingTrusted;

  switch (fix.step) {
    case 'walk_forward':
      return firm
        ? `Keep walking straight ahead. ${distance} to go.`
        : `${destinationName} should be straight ahead, ${distance} away.`;
    case 'turn_left':
      return firm
        ? `Turn left, then keep walking. ${distance} to go.`
        : `${destinationName} should be to your left, ${distance} away.`;
    case 'turn_right':
      return firm
        ? `Turn right, then keep walking. ${distance} to go.`
        : `${destinationName} should be to your right, ${distance} away.`;
    case 'turn_around':
      return firm
        ? `Turn around — it's behind you, ${distance} away.`
        : `${destinationName} should be behind you, ${distance} away.`;
    case 'arrived':
      return `You're at ${destinationName}.`;
  }
}

/**
 * Decide whether this fix is worth speaking.
 *
 * Arrival always speaks. After that: a changed direction, a milestone passed,
 * or a long enough silence while walking. Everything else stays quiet.
 */
function shouldAnnounce(fix: NavigationFix, memory: WatchMemory, now: number): boolean {
  const sinceLast = now - memory.lastSpokenAt;

  // `lastStep` is the last direction *spoken*, not the last computed: what the
  // user is acting on is what they heard, so that is what a change is measured
  // against.
  if (memory.lastStep !== fix.step) return sinceLast >= DIRECTION_CHANGE_INTERVAL_MS;

  // Too soon for anything routine — arrival is handled by the caller before
  // this is reached.
  if (sinceLast < MIN_ANNOUNCE_INTERVAL_MS) return false;

  const milestone = MILESTONES_M.find(
    (mark) =>
      !memory.milestonesPassed.has(mark) &&
      fix.distanceMeters <= mark &&
      (memory.lastSpokenDistance === null || memory.lastSpokenDistance > mark),
  );
  if (milestone !== undefined) {
    memory.milestonesPassed.add(milestone);
    return true;
  }

  return sinceLast >= REASSURANCE_INTERVAL_MS && fix.step !== 'unknown';
}

/**
 * Start watching the user's position and guiding them to `destination`.
 * Replaces any watch already running. Safe to call when geolocation is missing:
 * `onUnavailable` is called instead and the app carries on photo-only.
 */
export function startNavigation(options: NavigationOptions): void {
  stopNavigation();

  if (!navigator.geolocation) {
    options.onUnavailable('This device cannot report its location.');
    return;
  }

  const memory: WatchMemory = {
    lastSpokenAt: 0,
    lastStep: null,
    lastSpokenDistance: null,
    milestonesPassed: new Set(),
    arrived: false,
  };

  watchId = navigator.geolocation.watchPosition(
    (position) => {
      const now = Date.now();
      const here: Point = {
        lat: position.coords.latitude,
        lon: position.coords.longitude,
      };

      const distance = distanceMeters(here, options.destination);
      const accuracy = Number.isFinite(position.coords.accuracy)
        ? position.coords.accuracy
        : Number.POSITIVE_INFINITY;

      const usablePosition = accuracy <= UNUSABLE_POSITION_ACCURACY_M;

      // Hysteresis: it takes less to stay arrived than to become arrived, so a
      // fix wandering around the threshold doesn't announce repeatedly.
      const arrived = usablePosition
        ? memory.arrived
          ? distance <= DEPARTURE_RADIUS_M
          : distance <= ARRIVAL_RADIUS_M
        : memory.arrived;

      const heading = resolveHeading(position.coords);
      const relative =
        heading.degrees === null
          ? null
          : relativeBearing(bearingDegrees(here, options.destination), heading.degrees);

      let step: NavigationStep;
      if (arrived) {
        step = 'arrived';
      } else if (relative === null || !usablePosition) {
        // No facing direction, or a fix too vague to derive one from — either
        // way there is no honest turn to give.
        step = 'unknown';
      } else {
        step = stepFromRelativeBearing(relative);
      }

      const fix: NavigationFix = {
        step,
        distanceMeters: distance,
        positionAccuracyMeters: accuracy,
        relativeBearingDegrees: relative,
        headingSource: heading.source,
        headingTrusted: heading.trusted,
        arrived,
      };

      const justArrived = arrived && !memory.arrived;
      memory.arrived = arrived;

      // Arrival jumps the queue: it is the one thing the user is waiting for,
      // and holding it back for the rate limit would be absurd.
      const speak = justArrived || shouldAnnounce(fix, memory, now);

      if (speak) {
        memory.lastSpokenAt = now;
        memory.lastStep = step;
        memory.lastSpokenDistance = distance;
      }

      options.onUpdate({
        fix,
        announcement: speak ? phrase(fix, options.destinationName, justArrived) : null,
        justArrived,
      });
    },
    (error) => {
      stopNavigation();
      options.onUnavailable(
        error.code === error.PERMISSION_DENIED
          ? 'Location access is off, so I can only go by the photos.'
          : "I can't get a location fix here, so I'll go by the photos alone.",
      );
    },
    {
      enableHighAccuracy: true,
      // A stale fix is worse than none when the user is walking: it produces a
      // confident direction based on where they were a minute ago.
      maximumAge: 5000,
      timeout: 20000,
    },
  );
}

/** Stop watching. Safe to call when nothing is running — GPS costs battery. */
export function stopNavigation(): void {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

export function isNavigating(): boolean {
  return watchId !== null;
}
