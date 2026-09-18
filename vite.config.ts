import { defineConfig, loadEnv } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { analyzeDevServer } from './server/dev-middleware.ts';

export default defineConfig(({ mode }) => {
  // Load .env into process.env so the dev-only /api/analyze middleware can read
  // ANTHROPIC_API_KEY. The empty prefix means "no VITE_ prefix required" — these
  // stay server-side and are never injected into the client bundle.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));

  return {
    plugins: [
      analyzeDevServer(),
      // Serve dev over HTTPS with a self-signed certificate. The camera,
      // geolocation and compass APIs all require a secure context, and
      // localhost is the only insecure origin browsers treat as secure — so
      // testing on a phone over the LAN needs real HTTPS, even if the
      // certificate is untrusted and has to be waved through once per device.
      basicSsl(),
    ],
    server: {
      // The camera and geolocation APIs need a secure context. localhost counts
      // as secure; to test on a real phone, see "Testing on a phone" in README.md.
      host: true,
      // Vite rejects requests whose Host header it doesn't recognise, which
      // would otherwise block an HTTPS tunnel. These are the hostnames of the
      // tunnels the README suggests — dev only, and narrower than allowing all.
      allowedHosts: ['.loca.lt', '.trycloudflare.com', '.ngrok-free.app', '.ngrok.io'],
    },
    build: {
      outDir: 'dist',
    },
  };
});
