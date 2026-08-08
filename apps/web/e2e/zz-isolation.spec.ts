import { expect } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { test } from './fixtures'
import { ADMIN, ensureAccount } from './support'

// The falsifiable check for the whole change, and the reason for the `zz` prefix: Playwright orders
// spec FILES lexicographically and this suite runs `fullyParallel: false, workers: 1`, so this file
// runs last. Everything the other twenty-one specs created has passed through here.
//
// On a suite without the per-test reset this fails on its first assertion: eighteen spec files call
// `create-team` and thirteen call `create-invite` into one workspace that nothing ever cleans, and
// the archived `app-frame` trace recorded 45 teams, 13 members and 12 invites by this point.
//
// It is deliberately more than a database count. The counts only say Postgres is clean; the browser
// assertions say the SYNCED REPLICA is clean too, which is the half a bulk delete could plausibly
// get wrong — a client that renders rows the reset removed would pass a `select count(*)` and still
// break the next spec.

async function countRows(db: Database, table: string): Promise<number> {
  const { rows } = await db.pool.query<{ rows: number }>(
    `select count(*)::int as rows from "${table}"`,
  )
  return rows[0]?.rows ?? 0
}

test('the workspace this run leaves behind holds no accumulated fixtures', async ({
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

  // And what Postgres holds behind it. `project` and `issue` have no surface reachable without a
  // team, so they are asserted where they live.
  for (const table of ['team', 'invite', 'project', 'issue', 'cycle', 'retro']) {
    expect(
      await countRows(workspaceDb, table),
      `${table} should be empty after every preceding spec`,
    ).toBe(0)
  }

  // Exactly one account and one membership: the bootstrap admin, re-created by this test's own
  // sign-up and re-promoted by `bootstrapFirstAdmin`'s required-email gate. Two would mean an
  // earlier spec's account survived the reset; zero would mean the promotion never fired.
  expect(await countRows(workspaceDb, 'user')).toBe(1)
  expect(await countRows(workspaceDb, 'workspace_member')).toBe(1)
})
