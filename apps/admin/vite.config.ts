import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const AUTH = process.env.AUTH_SERVICE_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react()],
  // Served under /admin behind the gateway, so every asset URL has to be
  // relative to that prefix rather than the domain root.
  base: '/admin/',
  server: {
    port: 5174,
    strictPort: true,
    // Stands in for the gateway in development, like the desktop dev server.
    proxy: {
      '/api/v1/admin': AUTH,
      '/api/v1/auth': AUTH,
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
