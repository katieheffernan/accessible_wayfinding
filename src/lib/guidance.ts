/** Small shared readings of a GuidanceResult, used by both the UI and the haptics. */

import type { GuidanceResult } from '../types';

/**
 * True when the user has reached the place but the way in they're looking at
 * isn't usable — the combination the prompt is told to return for "right
 * building, wrong door".
 *
 * Worth naming: reaching the right building by a door you can't use is not
 * arriving, so this case gets the neutral wording and the ordinary buzz rather
 * than the arrival ones. Both channels have to agree, or the celebratory
 * pattern tells someone to stop walking while the sentence tells them not to.
 */
export function isAccessBlocked(result: GuidanceResult): boolean {
  return result.arrived && result.nextStep === 'look_for_entrance';
}
