/**
 * Spoken output and haptics.
 *
 * Speech is the primary output channel of this app — the large text is the
 * secondary one. Both are best-effort: a browser without SpeechSynthesis or
 * Vibration still shows the guidance on screen.
 */

/** Speak a sentence aloud, cancelling anything already being spoken. */
export function speak(text: string): void {
  if (!text) return;
  try {
    // Cancel first: stale guidance talking over current guidance is worse than
    // silence when someone is deciding whether to keep walking.
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.95; // slightly under default — easier to follow while moving
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* speech not available, ignore */
  }
}

/** Vibration feedback. Silently does nothing where unsupported (e.g. iOS Safari). */
export function buzz(pattern: number | number[]): void {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* no haptics, ignore */
  }
}

/** Distinct arrival pattern — a short celebratory burst versus a single tap. */
export const ARRIVED_PATTERN = [100, 60, 100, 60, 200];
export const UPDATE_PATTERN = [80];
