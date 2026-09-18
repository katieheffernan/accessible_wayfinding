/**
 * The navigation and behaviour hooks screens can call.
 *
 * Screens render markup and wire buttons to these; main.ts implements them and
 * owns the flow. Declaring the interface separately keeps screens from importing
 * main.ts (and main.ts from importing itself through them).
 */
export interface Actions {
  /** Back to the destination form, releasing the camera. */
  goToDestination(): void;
  /** Validate the destination, then open the viewfinder. */
  goToCamera(): void;
  /** Capture the current frame and send it for analysis. */
  capturePhoto(): void;
  /**
   * Begin a look-around sweep: several photos taken while turning on the spot.
   * Only offered when a single photo came back unclear.
   */
  startSweep(): void;
  /** Capture the next photo of the sweep, analysing it once the last one is in. */
  captureSweepPhoto(): void;
  /** Abandon a sweep partway through and go back to framing a single photo. */
  cancelSweep(): void;
  /** Speak the current guidance again. */
  repeatGuidance(): void;
}
