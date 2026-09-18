/**
 * The look-around sweep: several photos taken while turning on the spot.
 *
 * Why discrete photos rather than a panorama or a video sweep: a panorama
 * requires tracking a visual guide line evenly, which is exactly the task this
 * app's users can't do, and scaling one wide image to the API's limits spends
 * the same pixel budget over five times the view — so signage stops being
 * legible precisely when it matters. Separate stills keep full resolution, each
 * carries its own compass heading, and each step can be confirmed by speech and
 * a buzz before the next one.
 *
 * The turn instructions are quarter turns in one direction, four of them, so
 * the user ends up facing the way they started. Being left facing backwards
 * after a half sweep is disorienting when you can't see landmarks to re-orient
 * against.
 */

/** Instruction for each photo, and how far round from the start it should be. */
export const SWEEP_STEPS: readonly { instruction: string; offsetDegrees: number }[] = [
  {
    instruction: "Point your camera straight ahead, the way you're facing now.",
    offsetDegrees: 0,
  },
  {
    instruction: 'Now turn a quarter turn to your right, and hold still.',
    offsetDegrees: 90,
  },
  {
    instruction: 'Another quarter turn to your right.',
    offsetDegrees: 180,
  },
  {
    instruction: "One more quarter turn to your right — this is the last one.",
    offsetDegrees: 270,
  },
];
