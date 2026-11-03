/**
 * Client side of the photo analysis call.
 *
 * Posts to our own /api/analyze endpoint — never to api.anthropic.com. The API
 * key stays on the server; the browser bundle contains no credentials.
 */

import type {
  AnalyzeRequest,
  BearingContext,
  BuildingInfo,
  GuidanceResult,
  LocationContext,
  NavigationFix,
  SweepFrame,
} from '../types';

export class AnalysisError extends Error {}

/** Strip the `data:` URL prefix, leaving the base64 payload. */
export function toBase64(photoDataUrl: string): string {
  return photoDataUrl.split(',')[1] ?? '';
}

/**
 * Everything the server knows besides the pixels. Grouped into one argument
 * because the two request functions take an identical set and it had grown to
 * four positional parameters that were easy to transpose.
 */
export interface GuidanceContext {
  destination: string;
  location: LocationContext | null;
  bearing: BearingContext | null;
  building: BuildingInfo | null;
  navigation: NavigationFix | null;
}

/** Send one photo and destination for analysis. Throws AnalysisError on failure. */
export function requestGuidance(
  photoDataUrl: string,
  context: GuidanceContext,
): Promise<GuidanceResult> {
  return post({ ...context, kind: 'photo', imageBase64: toBase64(photoDataUrl) });
}

/** Send a look-around sweep for analysis. Throws AnalysisError on failure. */
export function requestSweepGuidance(
  frames: SweepFrame[],
  context: GuidanceContext,
): Promise<GuidanceResult> {
  return post({ ...context, kind: 'sweep', frames });
}

async function post(payload: AnalyzeRequest): Promise<GuidanceResult> {
  let response: Response;
  try {
    response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Distinct wording on purpose: this is the request never leaving the
    // device, which is a different problem from the server rejecting it, and
    // the user reading the message out loud is often the only diagnostic.
    throw new AnalysisError(
      "Couldn't reach the analysis service from this device. Check the connection and try again.",
    );
  }

  if (!response.ok) {
    // Surface the server's plain-language message when it sent one.
    const message = await response
      .json()
      .then((body: unknown) =>
        typeof body === 'object' && body !== null && typeof (body as Record<string, unknown>).error === 'string'
          ? ((body as Record<string, unknown>).error as string)
          : null,
      )
      .catch(() => null);

    throw new AnalysisError(
      message ??
        'Something went wrong reaching the analysis service. Check your connection and try again.',
    );
  }

  return (await response.json()) as GuidanceResult;
}
