import { defineConfig, devices } from '@playwright/test'

const DATABASE_URL = process.env.DATABASE_URL
const ZERO_CACHE_URL = process.env.E2E_ZERO_CACHE_URL ?? 'http://localhost:4848'
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 3210)

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
    // One origin. In every shipped deployment the app server serves the built SPA *and* the API
    // from the same origin (`mountSpa`, `WEB_DIST_DIR`); a separate web server on a second port
    // exists only in the dev loop. Pointing the suite at the server is therefore both simpler and
    // closer to production than either `vite dev` or `vite preview` — and it deletes the proxy,
    // which is where the preview experiment broke `/api/zero/token`.
    baseURL: SERVER_ORIGIN,
    trace: 'retain-on-failure',
    // Without this every action inherits `timeout: 0` and is bounded only by the test timeout, so
    // one action that can never succeed consumes the whole budget and the run reports the
    // teardown that follows it rather than the action that failed. A bounded action fails where
    // it happened, naming the selector.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Build the SPA, then boot the server that serves it. One command so Playwright waits for
      // `/readyz` only once the bundle `mountSpa` needs is on disk.
      command:
        'pnpm --filter @yapm/web exec vite build && pnpm --filter @yapm/server exec tsx src/index.ts',
      url: `${SERVER_ORIGIN}/readyz`,
      cwd: '../..',
      timeout: 240_000,
      // Never adopt a listener that happens to hold the port: under this harness an adopted
      // server means `vite build` silently did not run and the suite is asserting against an
      // arbitrary OLD bundle — the worst failure mode a harness can have, because every result
      // is about code that is not the checked-out code.
      reuseExistingServer: false,
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
        // The SPA reads this back through `GET /api/config`, which is the only way it learns where
        // to open its sync socket. Same origin now, so there is no proxy in the path.
        ZERO_CACHE_PUBLIC_URL: ZERO_CACHE_URL,
        BETTER_AUTH_SECRET: process.env.E2E_BETTER_AUTH_SECRET ?? 'e2e-development-secret-value',
        BETTER_AUTH_URL: SERVER_ORIGIN,
        WEB_ORIGIN: SERVER_ORIGIN,
        YAPM_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
      },
    },
  ],
})
