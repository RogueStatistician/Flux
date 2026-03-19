import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    open: false,
    proxy: {
      '/api':  'http://localhost:3001',
      '/auth': 'http://localhost:3001',
      // /invite/* is handled client-side by React Router (InvitePage);
      // no proxy needed — Vite dev server serves index.html for it.
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Ensure asset URLs are absolute (/assets/...) so deep routes like
    // /invite/:token don't resolve them relative to their own path segment.
    assetsDir: 'assets',
  },
  base: '/',
})
