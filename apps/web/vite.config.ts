import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const SERVER_ORIGIN = process.env.SERVER_ORIGIN ?? 'http://localhost:3000'

const TEST_ROUTES = '\\.(test|spec)\\.[tj]sx?$'
const DEV_ONLY_ROUTES = 'showcase'

const PROXY = {
  '/api': { target: SERVER_ORIGIN, changeOrigin: true },
  '/healthz': { target: SERVER_ORIGIN, changeOrigin: true },
  '/readyz': { target: SERVER_ORIGIN, changeOrigin: true },
}

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
    proxy: PROXY,
  },
  // The e2e suite serves the built bundle through `preview` rather than the dev server, so the
  // dependency optimizer — which re-runs when a lazily-routed chunk pulls in a dependency nobody
  // has visited yet, and can hand a mid-flight page a second copy of React — does not exist during
  // a test run. `preview` needs the same proxy as `server`: the SPA learns where to open its sync
  // socket from `GET /api/config`.
  preview: {
    port: 5173,
    strictPort: true,
    proxy: PROXY,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'baseline-widely-available',
  },
}))
