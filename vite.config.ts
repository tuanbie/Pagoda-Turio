import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = process.env.BACKEND_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': backend,
      '/ws': { target: backend.replace(/^http/, 'ws'), ws: true },
    },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: { manualChunks: { three: ['three'], react: ['react', 'react-dom'] } },
    },
  },
});
