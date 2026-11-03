/**
 * Overlay content for each state of the camera-first shell.
 *
 * Each function returns HTML for the middle of the screen. Two rules hold
 * everywhere: readable content sits on an opaque `.panel`, never directly on
 * the camera image; and a direction is never shown as an arrow alone — the
 * arrow is aria-hidden and always paired with the same instruction in words, so
 * it survives colour-vision deficiency, sunlight, and a screen reader.
 */

import { displayName } from '../lib/buildings';
import { escapeHtml } from '../lib/dom';
import { isAccessBlocked } from '../lib/guidance';
import type { BuildingInfo, GuidanceResult, NextStep } from '../types';

interface StepPresentation {
  arrow: string;
  label: string;
  tone: 'accent' | 'arrived' | 'caution' | 'error';
}

const NEXT_STEP_LABELS: Record<NextStep, StepPresentation> = {
  walk_forward: { arrow: '↑', label: 'Keep walking forward', tone: 'accent' },
  turn_left: { arrow: '←', label: 'Turn left', tone: 'accent' },
  turn_right: { arrow: '→', label: 'Turn right', tone: 'accent' },
  turn_around: { arrow: '↺', label: 'Turn around', tone: 'accent' },
  look_for_entrance: { arrow: '◎', label: 'Look for the entrance nearby', tone: 'caution' },
  arrived: { arrow: '✓', label: "You've arrived", tone: 'arrived' },
  unclear: { arrow: '?', label: 'Not clear yet — try another photo', tone: 'caution' },
};

/**
 * Stanford's surveyed description of the way in.
 *
 * Kept in its own block, with its own heading, wherever it appears. It is a
 * different kind of claim from everything else on screen: surveyed rather than
 * seen, and possibly out of date. Merging it into the photo's description
 * would make an authoritative statement about a ramp indistinguishable from a
 * model's guess about one, and the user has no way to tell them apart
 * afterwards.
 */
function entranceDetails(building: BuildingInfo | null): string {
  if (!building?.accessibleEntrance) return '';

  const link = building.url
    ? `<p class="detail-note"><a href="${escapeHtml(building.url)}" target="_blank" rel="noopener">Stanford's accessibility page for this building</a></p>`
    : '';

  return `
    <h3>Accessible entrance, per Stanford</h3>
    <p>${escapeHtml(building.accessibleEntrance)}</p>
    ${link}
  `;
}

/** Framing state: minimal chrome, so the view itself is as large as possible. */
export function idleOverlay(bearingText: string, building: BuildingInfo | null): string {
  const bearing = bearingText
    ? `<div class="panel"><p class="bearing-status">${escapeHtml(bearingText)}</p></div>`
    : '<div></div>';

  // The entrance description is offered while walking, not only on arrival:
  // knowing the accessible way in is on the north side is what decides which
  // way you approach a building, and that is useless once you are at the
  // wrong door. Collapsed, because it is long and the camera matters more.
  const entrance = building?.accessibleEntrance
    ? `<details class="more">
        <summary>Accessible entrance at ${escapeHtml(displayName(building.name))}</summary>
        ${entranceDetails(building)}
      </details>`
    : '';

  return `
    ${bearing}
    <div class="panel">
      <p class="status-line">Point at what's ahead, then take a photo</p>
      <p class="detail-note">Hold the phone up at roughly eye level.</p>
      ${entrance}
    </div>
  `;
}

export function analyzingOverlay(): string {
  return `
    <div></div>
    <div class="panel panel-accent">
      <p class="status-line"><span class="spinner" aria-hidden="true"></span>Looking at your surroundings…</p>
    </div>
  `;
}

/** One photo of the look-around sweep. */
export function sweepOverlay(instruction: string, stepNumber: number, total: number): string {
  // The first shot is straight ahead; the rest are turns, so show the turn glyph.
  const arrow = stepNumber === 1 ? '↑' : '↻';

  return `
    <div class="panel panel-accent">
      <div class="step-pill">
        <div class="arrow" aria-hidden="true">${arrow}</div>
        <div>
          <div class="step-label">Photo ${stepNumber} of ${total}</div>
          <p class="step-status">Looking around</p>
        </div>
      </div>
    </div>
    <div class="panel">
      <p class="spoken">${escapeHtml(instruction)}</p>
    </div>
  `;
}

export function errorOverlay(message: string): string {
  return `
    <div></div>
    <div class="error-box">
      <strong>Something went wrong.</strong>
      <p class="detail-note">${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * The result. Three layers, deliberately redundant: a pill naming the step in
 * words, a large arrow for the glance, and the spoken sentence in text with the
 * detail behind a disclosure so the camera stays visible.
 */
export function resultOverlay(result: GuidanceResult, building: BuildingInfo | null): string {
  const step = NEXT_STEP_LABELS[result.nextStep] ?? NEXT_STEP_LABELS.unclear;
  const accessBlocked = isAccessBlocked(result);

  // Reaching the building is real, but the words don't say "arrived" when the
  // door in front of them can't be used.
  const statusText = accessBlocked
    ? "You're here — check the way in"
    : result.arrived
      ? "You've arrived"
      : 'Not there yet';

  const tone = accessBlocked ? 'caution' : step.tone;
  const panelClass = `panel panel-${tone}`;
  const toneClass = tone === 'accent' ? '' : ` is-${tone}`;

  const accessBlock = result.accessNotes
    ? `<h3>What the photo shows about getting in</h3><p>${escapeHtml(result.accessNotes)}</p>`
    : '';

  return `
    <div class="${panelClass}">
      <div class="step-pill${toneClass}">
        <div class="arrow" aria-hidden="true">${step.arrow}</div>
        <div>
          <div class="step-label">${escapeHtml(step.label)}</div>
          <p class="step-status">${escapeHtml(statusText)} · confidence ${escapeHtml(result.confidence)}</p>
        </div>
      </div>
    </div>

    <div class="big-arrow${toneClass}" aria-hidden="true">${step.arrow}</div>

    <div class="panel">
      <p class="spoken">${escapeHtml(result.spokenGuidance || result.sceneDescription || '')}</p>
      <details class="more">
        <summary>What the photo shows</summary>
        <h3>The scene</h3>
        <p>${escapeHtml(result.sceneDescription || '—')}</p>
        ${accessBlock}
        ${entranceDetails(building)}
        <h3>Why</h3>
        <p>${escapeHtml(result.matchReasoning || '—')}</p>
      </details>
    </div>
  `;
}
