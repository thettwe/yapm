import { countWorkspaceRows, expect, type GrowthCounts, test } from './fixtures'
import { ADMIN, ensureAccount } from './support'

// Carried from PR #41 and adapted to the isolation model this change ends with — and the reason
// for the `zz` prefix survives the adaptation: Playwright orders spec files lexicographically and
// this suite runs `fullyParallel: false, workers: 1`, so this runs last, against the workspace the
// other twenty-one files spent the whole run writing into.
//
// PR #41's version asserted a per-test reset restored an EMPTY baseline. This change's model has
// no per-test reset: the suite runs on a fresh database per run (which is what `ci.yml`'s fresh
// volumes already do), every file builds its own fixtures and passes alone, and growth within a
// run is the model working — each test's own growth is annotated by the `workspaceGrowth` fixture.
// What must not happen silently is the run's TOTAL population drifting: the 533-team workspace
// (design DI-3) was discovered three changes after the tests that built it, because nothing looked
// at the end state of a run. This file is the thing that looks.
//
// The budgets are measured, not guessed: three consecutive fresh-database runs of the full suite
// before this change landed each ended at an identical 72 teams (design DI-4), and the ceilings
// below sit ~50% above the population measured on this branch's own full run. A test that pushes a
// table past its ceiling fails HERE, named by the growth annotation on the test that wrote it —
// visible in the run that introduced it, not three changes later. Raising a ceiling is fine when
// the suite legitimately grows; the evidence it takes is the annotated growth trail, and the raise
// belongs in the same change that adds the tests.
const RUN_POPULATION_CEILING: GrowthCounts = {
  team: 120,
  invite: 60,
  project: 60,
  issue: 220,
  cycle: 400,
  retro: 40,
  comment: 60,
  notification: 60,
  attachment: 20,
  pull_request: 20,
}

test('the run ends inside its measured population budget, and the app is live on that state', async ({
  page,
  workspaceDb,
}, testInfo) => {
  // The product still stands on everything the run accumulated: a signed-in admin gets a live,
  // connected client, not a workspace wedged by its own suite.
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 30_000 },
  )

  const population = await countWorkspaceRows(workspaceDb)
  await testInfo.attach('run-end population', {
    body: JSON.stringify(population, null, 2),
    contentType: 'application/json',
  })

  for (const [table, count] of Object.entries(population)) {
    expect(
      count,
      `${table} holds ${count} rows at the end of this run, over its measured ceiling of ${
        RUN_POPULATION_CEILING[table as keyof GrowthCounts]
      } — a test is leaving the workspace materially larger than the suite's model expects; its own workspace-growth annotation names it`,
    ).toBeLessThanOrEqual(RUN_POPULATION_CEILING[table as keyof GrowthCounts])
  }
})
