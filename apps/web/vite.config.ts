import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';
const CALL = process.env.CALL_SERVICE_URL ?? 'http://127.0.0.1:3007';
const PRESENCE = process.env.PRESENCE_SERVICE_URL ?? 'http://127.0.0.1:3005';
const NOTIFICATION = process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3006';

/**
 * `--mode lan` is this app served to the rest of the network rather than to the
 * machine running it, and it has to be HTTPS to be worth anything.
 *
 * Browsers withhold `crypto.subtle`, `navigator.mediaDevices` and the rest of
 * the secure-context APIs from a plain-http origin unless that origin is
 * localhost. This app is end-to-end encrypted, so the first thing it does on a
 * LAN address over http is fail to generate a key - not a degraded call, no
 * usable app at all. A self-signed certificate clears that bar for the price of
 * one click through the browser's warning, once per machine.
 *
 * There used to be a `lan-sfu` plugin here, rewriting an SFU's ICE candidates
 * to this host's LAN address and relaying its media port, because a proxy table
 * can stand in for signalling and not for media. It is gone: media never comes
 * near this server now, so serving the app is the whole of the job.
 */
export default defineConfig(({ mode }) => {
  const lan = mode === 'lan';

  return {
    // One .env for the whole repo, same as the desktop app.
    envDir: fileURLToPath(new URL('../../', import.meta.url)),
    plugins: [react(), ...(lan ? [basicSsl()] : [])],
    // Served at the root of the gateway - `https://nexora.example.com/` is the
    // app, `/admin` is the panel - so asset URLs are domain-rooted.
    base: '/',
    // The icon is the same icon; keeping one copy means it cannot drift.
    publicDir: fileURLToPath(new URL('../desktop/public', import.meta.url)),
    resolve: {
      alias: {
        // The shared packages build to CommonJS for the Node services. Rollup
        // cannot see named exports through that, so the bundle is pointed at
        // the TypeScript source instead - which it can also tree-shake.
        '@nexora/shared-types': fileURLToPath(
          new URL('../../packages/shared-types/src/index.ts', import.meta.url),
        ),
        '@nexora/permissions': fileURLToPath(
          new URL('../../packages/permissions/src/index.ts', import.meta.url),
        ),
      },
    },
    server: {
      port: 5175,
      strictPort: true,
      // Loopback unless this run is meant for the network.
      host: lan,
      // Development stands in for the Nginx gateway, exactly as the desktop dev
      // server does. The route table mirrors infrastructure/nginx/nginx.conf,
      // minus /api/v1/remote and /ws/remote: the web client has no remote
      // desktop section, so proxying the gateway it never calls would be a lie
      // about what this build can reach.
      proxy: {
        '/api/v1/auth': AUTH,
        '/api/v1/servers': SERVER,
        '/api/v1/channels': SERVER,
        '/api/v1/messages': CHAT,
        '/api/v1/friends': CHAT,
        '/api/v1/users': CHAT,
        '/api/v1/dm': CHAT,
        '/api/v1/uploads': CHAT,
        '/api/v1/e2ee': CHAT,
        '/api/v1/calls': CALL,
        '/api/v1/notifications': NOTIFICATION,
        '/ws/chat': { target: CHAT, ws: true },
        '/ws/presence': { target: PRESENCE, ws: true },
        // Call signalling. Media never comes through here, or through the
        // gateway this stands in for: peers reach each other directly.
        '/ws/call': { target: CALL, ws: true },
      },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
