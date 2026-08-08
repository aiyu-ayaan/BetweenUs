import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';
const WORKSPACE = process.env.WORKSPACE_SERVICE_URL ?? 'http://127.0.0.1:3003';
const CHAT = process.env.CHAT_SERVICE_URL ?? 'http://127.0.0.1:3004';

export default defineConfig({
  plugins: [
    react(),
    electron({
      main: { entry: 'electron/main.ts' },
      preload: { input: 'electron/preload.ts' },
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
      '/api/v1/workspaces': WORKSPACE,
      '/api/v1/channels': WORKSPACE,
      '/api/v1/messages': CHAT,
      '/api/v1/uploads': CHAT,
      '/ws/chat': { target: CHAT, ws: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
