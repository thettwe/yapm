import { type Browser, type BrowserContext, test as base } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { openDb } from './db'
import { assertBaseline, resetToBaseline } from './reset'

export type NewContext = (options?: Parameters<Browser['newContext']>[0]) => Promise<BrowserContext>

export interface E2eFixtures {
  baseline: undefined
  newContext: NewContext
}

export interface E2eWorkerFixtures {
  workspaceDb: Database
}

// Every test starts from the state the server leaves behind at boot. Per test, not per file:
// Playwright has no per-file fixture scope, and a worker-scoped memo of "the last file I saw"
// breaks under `retries: 1` — the worker is replaced mid-file after a failure, so the memo is lost
// and a later test in that file silently loses state it was written to depend on.
//
// There is deliberately no opt-out. A test that needs a team, an invite or a second member builds
// them itself; nothing it builds outlives it.
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

  baseline: [
    async ({ workspaceDb }, use) => {
      await resetToBaseline(workspaceDb)
      await assertBaseline(workspaceDb)
      await use(undefined)
    },
    { auto: true },
  ],

  // Every second browser in the suite comes from here. Manual `browser.newContext()` in a spec body
  // has to be closed in a `finally`, which races Playwright's own teardown when the test times out
  // and reports `Target.disposeBrowserContext: Failed to find context` over the real failure. A
  // fixture's teardown is owned by Playwright, runs on the pass and the fail path alike, and closes
  // each context exactly once.
  newContext: async ({ browser }, use) => {
    const opened: BrowserContext[] = []
    await use(async (options) => {
      const context = await browser.newContext(options)
      opened.push(context)
      return context
    })
    for (const context of opened) {
      await context.close()
    }
  },
})
