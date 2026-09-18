import { defineConfig, loadEnv } from 'vite';
import { analyzeDevServer } from './server/dev-middleware.ts';

export default defineConfig(({ mode }) => {
  // Load .env into process.env so the dev-only /api/analyze middleware can read
  // ANTHROPIC_API_KEY. The empty prefix means "no VITE_ prefix required" — these
  // stay server-side and are never injected into the client bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [analyzeDevServer()],
    server: {
      // The camera and geolocation APIs need a secure context. localhost counts
      // as secure; to test on a real phone, see "Testing on a phone" in README.md.
      host: true,
    },
    build: {
      outDir: 'dist',
    },
  };
});
