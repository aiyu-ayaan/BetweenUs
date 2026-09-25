import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import { serviceUrls } from '../../scripts/dev-services.mjs';

// From the repo .env, the same file the services take their ports from -
// see scripts/dev-services.mjs.
const services = serviceUrls();
const AUTH = services.AUTH_SERVICE;
const SERVER = services.SERVER_SERVICE;
const CHAT = services.CHAT_SERVICE;
const CALL = services.CALL_SERVICE;
const PRESENCE = services.PRESENCE_SERVICE;
const NOTIFICATION = services.NOTIFICATION_SERVICE;
const REMOTE = services.REMOTE_GATEWAY;

// `pnpm dev:duo` starts Electron itself - twice, with separate profiles - so it
// tells the plugin to build the main/preload bundles and stop there.
const manageElectron = process.env.BETWEENUS_NO_ELECTRON !== '1';

export default defineConfig({
  // One .env for the whole repo. VITE_API_URL lives there next to the service
  // ports it has to agree with, rather than in a second file nobody remembers.
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        ...(manageElectron ? {} : { onstart: () => undefined }),
      },
      preload: {
        input: 'electron/preload.ts',
        // The preload bundle's default hook reloads Electron - and "reload"
        // means "start it" when no Electron was launched by the plugin, which
        // would add a third, unmanaged window during `pnpm dev:duo`.
        ...(manageElectron ? {} : { onstart: () => undefined }),
      },
    }),
  ],
  resolve: {
    alias: {
      // The shared packages build to CommonJS for the Node services. Rollup
      // cannot see named exports through that, so the renderer is pointed at
      // the TypeScript source instead - which it can also tree-shake.
      '@betweenus/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
      '@betweenus/permissions': fileURLToPath(
        new URL('../../packages/permissions/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // Development stands in for the Nginx gateway, so `pnpm dev` needs no
    // gateway container and does not compete for port 8080. The route table
    // mirrors infrastructure/nginx/nginx.conf.
    proxy: {
      '/api/v1/auth': AUTH,
      '/api/v1/servers': SERVER,
      '/api/v1/channels': SERVER,
      '/api/v1/messages': CHAT,
      '/api/v1/friends': CHAT,
      '/api/v1/users': CHAT,
      '/api/v1/dm': CHAT,
      '/api/v1/statuses': CHAT,
      '/api/v1/uploads': CHAT,
      '/api/v1/e2ee': CHAT,
      '/api/v1/calls': CALL,
      '/api/v1/notifications': NOTIFICATION,
      '/api/v1/remote': REMOTE,
      '/ws/chat': { target: CHAT, ws: true },
      '/ws/presence': { target: PRESENCE, ws: true },
      '/ws/call': { target: CALL, ws: true },
      '/ws/remote': { target: REMOTE, ws: true },
    },
  },
  // The camera effects worker imports MediaPipe lazily, and a dynamic
    // import is code-splitting - which Rollup cannot do into the IIFE that
    // workers are bundled as by default. Every browser that has the frame
    // processing this worker needs has module workers too, so there is
    // nothing to lose by asking for one.
    worker: { format: 'es' },
    build: { outDir: 'dist', emptyOutDir: true },
});
