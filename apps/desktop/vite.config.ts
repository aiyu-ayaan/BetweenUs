import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';
const CALL = process.env.CALL_SERVICE_URL ?? 'http://127.0.0.1:3007';
const PRESENCE = process.env.PRESENCE_SERVICE_URL ?? 'http://127.0.0.1:3005';
const NOTIFICATION = process.env.NOTIFICATION_SERVICE_URL ?? 'http://127.0.0.1:3006';
const REMOTE = process.env.REMOTE_GATEWAY_URL ?? 'http://127.0.0.1:3008';

// `pnpm dev:duo` starts Electron itself - twice, with separate profiles - so it
// tells the plugin to build the main/preload bundles and stop there.
const manageElectron = process.env.NEXORA_NO_ELECTRON !== '1';

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
      '@nexora/shared-types': fileURLToPath(
        new URL('../../packages/shared-types/src/index.ts', import.meta.url),
      ),
      '@nexora/permissions': fileURLToPath(
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
      '/api/v1/uploads': CHAT,
      '/api/v1/e2ee': CHAT,
      '/api/v1/calls': CALL,
      '/api/v1/notifications': NOTIFICATION,
      '/api/v1/remote': REMOTE,
      // LiveKit signalling, same prefix and same stripping as the gateway does,
      // so LIVEKIT_URL can be "/livekit" in development too. An absolute
      // ws://127.0.0.1:7880 works here as well, but it sends a client to *its
      // own* loopback - which is another SFU entirely once the app is packaged
      // and pointed at a real deployment.
      '/livekit': {
        target: 'http://127.0.0.1:7880',
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
      '/ws/chat': { target: CHAT, ws: true },
      '/ws/presence': { target: PRESENCE, ws: true },
      '/ws/remote': { target: REMOTE, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
