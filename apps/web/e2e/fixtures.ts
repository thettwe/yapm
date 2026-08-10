import { type Browser, type BrowserContext, test as base, type Page } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { openDb } from './db'

export type NewContext = (options?: Parameters<Browser['newContext']>[0]) => Promise<BrowserContext>

// Zero writes the reason here before its default handler reloads the page
// (`reload-error-handler.ts`, verified against the installed 1.8.0). If a reload ever fires
// without the product's handlers having intercepted it, this is where its name is.
const ZERO_RELOAD_REASON_KEY = '_zeroReloadReason'

interface ReloadWatch {
  attach: (context: BrowserContext) => void
  violations: string[]
}

// The tables the specs fill. `user` and `workspace_member` are deliberately absent: accounts are
// reused across a run by design (`ensureAccount`), so their growth is the model, not a leak.
const GROWTH_TABLES = [
  'team',
  'invite',
  'project',
  'issue',
  'cycle',
  'retro',
  'comment',
  'notification',
  'attachment',
  'pull_request',
] as const

export type GrowthCounts = Record<(typeof GROWTH_TABLES)[number], number>

export async function countWorkspaceRows(db: Database): Promise<GrowthCounts> {
  const counts = {} as Record<(typeof GROWTH_TABLES)[number], number>
  for (const table of GROWTH_TABLES) {
    const { rows } = await db.pool.query<{ rows: number }>(
      `select count(*)::int as rows from "${table}"`,
    )
    counts[table] = rows[0]?.rows ?? 0
  }
  return counts
}

export interface E2eFixtures {
  reloadWatch: ReloadWatch
  workspaceGrowth: undefined
  newContext: NewContext
}

export interface E2eWorkerFixtures {
  workspaceDb: Database
}

export const test = base.extend<E2eFixtures, E2eWorkerFixtures>({
  workspaceDb: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies out of this destructuring pattern and rejects a first parameter that is not one.
    async ({}, use) => {
      const db = openDb()
      await use(db)
      await db.close()
    },
    { scope: 'worker' },
  ],

  // The tripwire, not a fix (design D3): a reload chain was hypothesized as the cause of a
  // long-running failure and survived a merged proposal before measurement falsified it — this
  // assertion would have killed the theory in an afternoon. Any page that reloads without the
  // test asking fails the test that saw it, naming the reload and the reason the client gave.
  //
  // Detection is the new document's own navigation entry: `location.reload()` (the library's
  // default for `UpdateNeeded` / `ClientStateNotFound`) produces `type: "reload"`, while
  // `page.goto` produces `type: "navigate"` — so a test navigating deliberately never trips it,
  // and a deliberate `page.reload()` is pre-authorized by the wrapper below.
  reloadWatch: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies out of this destructuring pattern and rejects a first parameter that is not one.
    async ({}, use) => {
      const violations: string[] = []

      const attachPage = (page: Page) => {
        let allowedReloads = 0
        const originalReload = page.reload.bind(page)
        page.reload = (options?: Parameters<Page['reload']>[0]) => {
          allowedReloads += 1
          return originalReload(options)
        }
        page.on('load', () => {
          // The credit is consumed synchronously here, BEFORE the probe: the evaluate below can
          // lose a race with a second navigation and throw, and a credit left behind by that race
          // would silently absorb a later Zero-initiated reload on the same page. Consumed up
          // front, the credit is tied to the first load after the deliberate `page.reload()` —
          // and restored only if that load proves not to have been a reload at all.
          const credited = allowedReloads > 0
          if (credited) allowedReloads -= 1
          void (async () => {
            try {
              const nav = await page.evaluate(() => {
                const entry = performance.getEntriesByType('navigation')[0] as
                  | PerformanceNavigationTiming
                  | undefined
                return {
                  type: entry?.type ?? 'navigate',
                  reason: sessionStorage.getItem('_zeroReloadReason'),
                  url: location.href,
                }
              })
              if (nav.type !== 'reload') {
                if (credited) allowedReloads += 1
                return
              }
              if (credited) return
              violations.push(
                `unrequested reload at ${nav.url} — reason: ${nav.reason ?? 'none recorded (not a Zero reload)'}`,
              )
            } catch {
              // The page navigated again or closed under the probe; the next load reports itself.
              // A consumed credit stays consumed — the load it paid for was this one.
            }
          })()
        })
      }

      const attach = (context: BrowserContext) => {
        for (const page of context.pages()) attachPage(page)
        context.on('page', attachPage)
      }

      await use({ attach, violations })

      if (violations.length > 0) {
        throw new Error(
          [
            'The page reloaded without the test asking for it.',
            ...violations,
            `A reload naming a ${ZERO_RELOAD_REASON_KEY} reason means the sync client's own handler fired — the product handlers in ZeroRoot should have made that unreachable.`,
          ].join('\n'),
        )
      }
    },
    { auto: true },
  ],

  // The default context gets the watcher too, not only the ones `newContext` mints.
  context: async ({ context, reloadWatch }, use) => {
    reloadWatch.attach(context)
    await use(context)
  },

  // Accumulation stays visible (task 5b.6): a test that leaves the workspace materially larger
  // than it found it says so in its own report, instead of being discovered three changes later
  // as a 533-team workspace (design DI-3). Visibility, not a gate — the suite's isolation model
  // is a fresh database per run, and growth within a run is the model working.
  workspaceGrowth: [
    async ({ workspaceDb }, use, testInfo) => {
      const before = await countWorkspaceRows(workspaceDb)
      await use(undefined)
      const after = await countWorkspaceRows(workspaceDb)
      const grown = GROWTH_TABLES.filter((table) => after[table] > before[table]).map(
        (table) => `${table} +${after[table] - before[table]}`,
      )
      if (grown.length > 0) {
        testInfo.annotations.push({ type: 'workspace-growth', description: grown.join(', ') })
      }
    },
    { auto: true },
  ],

  // Every second browser in the suite comes from here (carried from PR #41). A manual
  // `browser.newContext()` in a spec body has to be closed in a `finally`, which races
  // Playwright's own teardown when the test times out and reports
  // `Target.disposeBrowserContext: Failed to find context` over the real failure — the
  // misreporting that produced two wrong diagnoses. A fixture's teardown is owned by
  // Playwright, runs on the pass and the fail path alike, and closes each context exactly once.
  newContext: async ({ browser, reloadWatch }, use) => {
    const opened: BrowserContext[] = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      reloadWatch.attach(context)
      opened.push(context)
      return context
    })
    for (const context of opened) {
      await context.close()
    }
  },
})

export { expect } from '@playwright/test'
