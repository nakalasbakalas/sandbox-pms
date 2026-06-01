import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig, PluginOption } from "vite";

import sparkPlugin from "@github/spark/spark-vite-plugin";
import createIconImportProxy from "@github/spark/vitePhosphorIconProxyPlugin";
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname
const sparkVitePort = Number(process.env.SPARK_VITE_PORT || 5000)

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // DO NOT REMOVE
    createIconImportProxy() as PluginOption,
    sparkPlugin({ port: sparkVitePort }) as PluginOption,
  ],
  resolve: {
    alias: {
      '@github/spark/hooks': resolve(projectRoot, 'src/lib/spark-hooks.ts'),
      '@': resolve(projectRoot, 'src')
    }
  },
  optimizeDeps: {
    exclude: ['@github/spark/hooks'],
  },
  build: {
    chunkSizeWarningLimit: 3000,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:10000',
    },
  },
});
