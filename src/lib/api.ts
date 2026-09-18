/**
 * Client side of the photo analysis call.
 *
 * Posts to our own /api/analyze endpoint — never to api.anthropic.com. The API
 * key stays on the server; the browser bundle contains no credentials.
 */

import type {
  AnalyzeRequest,
  BearingContext,
  GuidanceResult,
  LocationContext,
  SweepFrame,
} from '../types';

export class AnalysisError extends Error {}

/** Strip the `data:` URL prefix, leaving the base64 payload. */
export function toBase64(photoDataUrl: string): string {
  return photoDataUrl.split(',')[1] ?? '';
}

/** Send one photo and destination for analysis. Throws AnalysisError on failure. */
export function requestGuidance(
  photoDataUrl: string,
  destination: string,
  location: LocationContext | null,
  bearing: BearingContext | null,
): Promise<GuidanceResult> {
  return post({
    kind: 'photo',
    destination,
    imageBase64: toBase64(photoDataUrl),
    location,
    bearing,
  });
}

/** Send a look-around sweep for analysis. Throws AnalysisError on failure. */
export function requestSweepGuidance(
  frames: SweepFrame[],
  destination: string,
  location: LocationContext | null,
  bearing: BearingContext | null,
): Promise<GuidanceResult> {
  return post({ kind: 'sweep', destination, frames, location, bearing });
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
    throw new AnalysisError(
      'Something went wrong reaching the analysis service. Check your connection and try again.',
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
