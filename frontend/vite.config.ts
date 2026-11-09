/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load all variables (not only VITE_*) so dev-server-only settings stay out of the client bundle.
  const env = loadEnv(mode, import.meta.dirname, '');
  const apiProxy = {
    '/api': {
      target: env.API_PROXY_TARGET || 'http://localhost:3000',
      changeOrigin: true,
    },
  };

  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true, proxy: apiProxy },
    preview: { port: 4173, strictPort: true, proxy: apiProxy },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      // Above the 5 s findBy/waitFor ceiling (src/test/setup.ts), so failures report what was missing.
      testTimeout: 15_000,
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
