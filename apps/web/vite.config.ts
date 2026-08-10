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
  // For the manual `pnpm preview` loop — a human eyeballing the built bundle. It needs the same
  // proxy as `server` because the SPA learns where to open its sync socket from `GET /api/config`.
  // The e2e suite does NOT come through here: it runs against the app server serving `dist` on
  // one origin (`mountSpa`), so no Vite process — and no dependency optimizer, which can hand a
  // mid-flight dev page a second copy of React — exists during a test run.
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
