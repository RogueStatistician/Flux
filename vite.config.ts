import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            sourcemap: true,
            rollupOptions: {
              // Native modules must stay external — loaded by Electron at runtime
              external: ['better-sqlite3'],
            },
          },
        },
      },
      // Preload is compiled separately by esbuild (see build:preload script)
      // so that it can be output as true CJS, which Electron's preload
      // context requires even when package.json has "type":"module".
    ]),
    renderer(),
  ],
  server: {
    open: false, // WSL: don't auto-open browser; Electron is the UI
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
