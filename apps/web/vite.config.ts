import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER_ORIGIN = process.env.SERVER_ORIGIN ?? 'http://localhost:3000'

const TEST_ROUTES = '\\.(test|spec)\\.[tj]sx?$'
const DEV_ONLY_ROUTES = 'showcase'

export default defineConfig(({ command }) => ({
  plugins: [
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern:
        command === 'build' ? `${DEV_ONLY_ROUTES}|${TEST_ROUTES}` : TEST_ROUTES,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: SERVER_ORIGIN, changeOrigin: true },
      '/healthz': { target: SERVER_ORIGIN, changeOrigin: true },
      '/readyz': { target: SERVER_ORIGIN, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'baseline-widely-available',
  },
}))
