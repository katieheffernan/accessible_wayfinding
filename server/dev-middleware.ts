/**
 * Dev-only Vite plugin that serves POST /api/analyze locally.
 *
 * It calls the same `analyze()` function the deployed Vercel function calls, so
 * `npm run dev` behaves like production without needing the Vercel CLI, and there
 * is no second copy of the prompt or the Claude request to drift out of sync.
 */

import type { Plugin } from 'vite';
import { analyze, AnalyzeError } from './analyze.ts';

/** Roughly 8 MB, above the request cap in analyze.ts so oversized bodies get a clear 413. */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new AnalyzeError('That photo is too large to analyze.', 413));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export function analyzeDevServer(): Plugin {
  return {
    name: 'here-yet-analyze-dev-server',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api/analyze', async (req, res) => {
        const respond = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          respond(405, { error: 'Use POST.' });
          return;
        }

        try {
          const raw = await readBody(req);
          const result = await analyze(JSON.parse(raw));
          respond(200, result);
        } catch (error) {
          if (error instanceof SyntaxError) {
            respond(400, { error: 'Request body must be valid JSON.' });
            return;
          }

          const status = error instanceof AnalyzeError ? error.status : 500;
          const message =
            error instanceof AnalyzeError
              ? error.message
              : 'Something went wrong analyzing the photo.';

          if (status >= 500) {
            console.error('[dev /api/analyze]', error);
          }

          respond(status, { error: message });
        }
      });
    },
  };
}
