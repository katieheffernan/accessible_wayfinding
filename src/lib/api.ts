/**
 * Client side of the photo analysis call.
 *
 * Posts to our own /api/analyze endpoint — never to api.anthropic.com. The API
 * key stays on the server; the browser bundle contains no credentials.
 */

import type { AnalyzeRequest, GuidanceResult, LocationContext } from '../types';

export class AnalysisError extends Error {}

/** Send the photo and destination for analysis. Throws AnalysisError on failure. */
export async function requestGuidance(
  photoDataUrl: string,
  destination: string,
  location: LocationContext | null,
): Promise<GuidanceResult> {
  const imageBase64 = photoDataUrl.split(',')[1] ?? '';

  const payload: AnalyzeRequest = { destination, imageBase64, location };

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
