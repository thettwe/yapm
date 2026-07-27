import { defineConfig, devices } from '@playwright/test'

const DATABASE_URL = process.env.DATABASE_URL
const ZERO_CACHE_URL = process.env.E2E_ZERO_CACHE_URL ?? 'http://localhost:4848'
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3210)
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174)

if (DATABASE_URL === undefined) {
  throw new Error(
    [
      'DATABASE_URL is required to run the sync end-to-end tests.',
      'These tests need the same three pieces the app needs: Postgres (wal_level=logical),',
      'zero-cache, and the yapm server. See openspec/changes/archive/2026-07-23-foundation/zero-operations.md.',
    ].join('\n'),
  )
}

const SERVER_ORIGIN = `http://localhost:${SERVER_PORT}`

export default defineConfig({
  testDir: './e2e',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm --filter @yapm/server exec tsx src/index.ts',
      url: `${SERVER_ORIGIN}/readyz`,
      cwd: '../..',
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL,
        PORT: String(SERVER_PORT),
        LOG_LEVEL: 'warn',
        CYCLE_MAINTENANCE: 'false',
        // The index is maintained by a job, so its freshness is a real wait. Two seconds instead
        // of the ten-second default keeps `search.spec.ts` honest about the lag while bounding it:
        // the specs wait on the document row, never on a fixed sleep.
        SEARCH_INDEX_INTERVAL_SECONDS: '2',
        // The shipped default is `/var/lib/yapm/files`, which is where the container writes and
        // which no developer machine will let a normal user create. `/readyz` probes the directory
        // at boot (gating, deliberately — a read-only mount must not take traffic), so this env is
        // what keeps the harness reaching `ready` at all. `data/` is gitignored.
        STORAGE_LOCAL_DIR: 'data/e2e-files',
        BETTER_AUTH_SECRET: process.env.E2E_BETTER_AUTH_SECRET ?? 'e2e-development-secret-value',
        BETTER_AUTH_URL: SERVER_ORIGIN,
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        YAPM_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
      },
    },
    {
      command: `pnpm exec vite dev --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        SERVER_ORIGIN,
        VITE_ZERO_CACHE_URL: ZERO_CACHE_URL,
      },
    },
  ],
})
