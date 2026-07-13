import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

const projectRoot = import.meta.dirname

export default defineConfig({
  root: resolve(projectRoot, 'src-lite'),
  plugins: [react()],
  resolve: {
    alias: {
      '@lite': resolve(projectRoot, 'src-lite'),
    },
  },
  build: {
    outDir: resolve(projectRoot, 'dist-lite'),
    emptyOutDir: true,
    manifest: true,
    sourcemap: true,
    chunkSizeWarningLimit: 300,
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://127.0.0.1:10000',
    },
  },
})
