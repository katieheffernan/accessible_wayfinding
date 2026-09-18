/**
 * Screen-reader announcements via the aria-live region in index.html.
 *
 * Every screen change announces itself here. The region is polite (it waits for
 * a pause rather than interrupting) and lives outside #app so re-rendering the
 * app doesn't destroy it mid-announcement.
 */

const liveRegion = document.getElementById('live-region');

/**
 * Clearing the region and setting it on a later tick is what makes repeated
 * announcements fire: assistive tech only reacts to a *change* in the node's
 * text, so setting the same string twice would be silent.
 */
export function announce(text: string): void {
  if (!liveRegion) return;
  liveRegion.textContent = '';
  setTimeout(() => {
    liveRegion.textContent = text;
  }, 50);
}
