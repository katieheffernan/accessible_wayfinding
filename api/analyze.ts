/**
 * POST /api/analyze — Vercel serverless function.
 *
 * Thin HTTP wrapper around `analyze()`. The Anthropic API key lives in this
 * function's environment (Vercel project settings, or .env locally) and is never
 * sent to the browser.
 */

import { analyze, AnalyzeError } from '../server/analyze';

/**
 * Minimal shape of what Vercel's Node runtime passes in. Declared locally so the
 * project doesn't need the @vercel/node package just for two types.
 */
interface RequestLike {
  method?: string;
  body?: unknown;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

/** A vision call with thinking can take a while; don't let the platform cut it off. */
export const config = { maxDuration: 60 };

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'Use POST.' });
    return;
  }

  try {
    const result = await analyze(req.body);
    res.status(200).json(result);
  } catch (error) {
    const status = error instanceof AnalyzeError ? error.status : 500;
    const message =
      error instanceof AnalyzeError
        ? error.message
        : 'Something went wrong analyzing the photo.';

    if (status >= 500) {
      console.error('[api/analyze]', error);
    }

    res.status(status).json({ error: message });
  }
}
