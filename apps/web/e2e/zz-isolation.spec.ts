import { expect } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { test } from './fixtures'
import { ADMIN, ensureAccount } from './support'

// The falsifiable check for the whole change, and the reason for the `zz` prefix: Playwright orders
// spec FILES lexicographically and this suite runs `fullyParallel: false, workers: 1`, so this runs
// last, on the database the other twenty-one specs spent the whole run writing to.
//
// Be precise about what that means, because the loose version of this sentence is wrong. The
// per-test fixture resets BEFORE each test, so what this test literally inherits is not the run's
// accumulation — it is the baseline the reset produced from it. What is unique to this position in
// the suite is the SIZE of the job that reset had to do: everything twenty-one files created had to
// disappear immediately before these assertions ran. On a suite without the reset the same
// assertions fail on the first one — eighteen files call `create-team` and thirteen call
// `create-invite` into a workspace nothing cleans, and the archived `app-frame` trace recorded 45
// teams, 13 members and 12 invites by this point in a run.
//
// Two things here are NOT covered by `assertBaseline`, which is why the spec exists on top of the
// gate that already runs before every test:
//
//  1. The browser. `assertBaseline` reads Postgres; a client rendering rows the bulk delete removed
//     would pass a `select count(*)` and still break the next spec. The empty states below are the
//     only assertion in the suite that the SYNCED REPLICA reached the baseline too.
//  2. The gate's own coverage. `assertBaseline` derives its tables from `information_schema`, so a
//     table wrongly added to `IGNORED_TABLES` drops out of the reset AND out of the assertion
//     together, silently. The tables below are named as literals on purpose: they are the ones
//     earlier specs fill, and a hard-coded list is exactly the right instrument for checking a
//     derived one.

async function countRows(db: Database, table: string): Promise<number> {
  const { rows } = await db.pool.query<{ rows: number }>(
    `select count(*)::int as rows from "${table}"`,
  )
  return rows[0]?.rows ?? 0
}

test('after a whole run of fixtures, the baseline is what a signed-in admin sees', async ({
  page,
  workspaceDb,
}) => {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('[data-testid="connection-status"]')).toHaveAttribute(
    'data-connection',
    'connected',
    { timeout: 30_000 },
  )

  // What a signed-in admin sees: the two empty states, and one member — themselves.
  await expect(page.getByTestId('teams-list')).toHaveCount(0)
  await expect(page.getByText('No teams yet.')).toBeVisible()
  await expect(page.getByTestId('invites-list')).toHaveCount(0)
  await expect(page.getByText('No invitations yet.')).toBeVisible()
  await expect(page.getByTestId('members-list').getByRole('listitem')).toHaveCount(1)
  await expect(page.getByTestId('members-list')).toContainText(ADMIN.name)

  // And what Postgres holds behind it. Every table here is one an earlier spec fills and no surface
  // on this page could report — `project` and `issue` need a team to be reachable at all, and
  // `comment`, `notification`, `attachment` and `pull_request` are reachable only from an issue.
  for (const table of [
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
  ]) {
    expect(
      await countRows(workspaceDb, table),
      `${table} still holds rows at the baseline the last reset of this run produced`,
    ).toBe(0)
  }

  // Exactly one account and one membership: the bootstrap admin, re-created by this test's own
  // sign-up and re-promoted by `bootstrapFirstAdmin`'s required-email gate. Two would mean an
  // earlier spec's account survived the reset; zero would mean the promotion never fired.
  expect(await countRows(workspaceDb, 'user')).toBe(1)
  expect(await countRows(workspaceDb, 'workspace_member')).toBe(1)
})
