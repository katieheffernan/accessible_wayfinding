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
  /** Speak the current guidance again. */
  repeatGuidance(): void;
}
