import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const SERVER = process.env.SERVER_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';
const CALL = process.env.CALL_SERVICE_URL ?? 'http://127.0.0.1:3007';
const PRESENCE = process.env.PRESENCE_SERVICE_URL ?? 'http://127.0.0.1:3005';

// `pnpm dev:duo` starts Electron itself - twice, with separate profiles - so it
// tells the plugin to build the main/preload bundles and stop there.
const manageElectron = process.env.NEXORA_NO_ELECTRON !== '1';

export default defineConfig({
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
      '/ws/chat': { target: CHAT, ws: true },
      '/ws/presence': { target: PRESENCE, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
