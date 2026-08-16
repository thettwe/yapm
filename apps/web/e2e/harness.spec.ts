import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount, goToMore, openWorkspaceOverview, stop } from './support'

// The deck — and the `more▾` transient behind it — is drawn once a team is in context, so the
// goToMore probes build their own team, exactly as the rule "a spec passes alone" demands.
async function enterTeam(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await openWorkspaceOverview(page)
  const teamName = `Harness Team ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  await dialog.getByLabel('Key').fill(key)
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()
  await stop(page, 'Issues').click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

// The harness's own guarantees, proven both ways (e2e-determinism section 7). These tests are
// about the instruments, not the product: a tripwire that cannot fire and a helper that fails at
// teardown instead of at its own selector are exactly how two wrong diagnoses got written.

// 7.3 red: a page that reloads itself — the thing Zero's default handlers would do — fails the
// test that saw it. `test.fail()` makes Playwright expect the failure: the reload-watcher teardown
// throws, naming the reload, and this test goes red the day the tripwire stops firing.
test('the reload watcher fails a test whose page reloads itself', async ({ page, reloadWatch }) => {
  test.fail(true, 'deliberate: the reload watcher must fail a self-reloading page at teardown')

  await page.goto('/login')
  await page.evaluate(() => {
    setTimeout(() => location.reload(), 50)
  })
  // The violation is recorded by an async probe on the new document's load; wait until the
  // watcher has actually seen it so the teardown assertion is deterministic, not a race.
  await expect.poll(() => reloadWatch.violations.length, { timeout: 15_000 }).toBeGreaterThan(0)
  expect(reloadWatch.violations[0]).toContain('unrequested reload')
})

// 7.3 green: deliberate navigation and a deliberate `page.reload()` are the test's own acts, and
// the watcher stays quiet about both.
test('the reload watcher stays quiet for deliberate navigations and reloads', async ({
  page,
  reloadWatch,
}) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
  await page.goto('/')
  await page.reload()
  await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
  // Give the async load probes the moment they need, then hold the watcher to silence.
  await page.waitForTimeout(500)
  expect(reloadWatch.violations).toEqual([])
})

// 7.5 green: the transient opens and the helper lands on the destination.
test('goToMore reaches a destination behind the transient when it opens', async ({ page }) => {
  await enterTeam(page)

  await goToMore(page, 'Projects')
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible({ timeout: 20_000 })
})

// 7.5 red: when the item can never appear, the helper fails AT THE MENU — naming the item it was
// looking for, within its own bound — instead of burning the test budget and failing at teardown,
// which is the misreporting this whole change exists to end.
test('goToMore fails at the menu, naming the item, when the transient cannot serve it', async ({
  page,
}) => {
  await enterTeam(page)

  const started = Date.now()
  let failure: Error | null = null
  try {
    await goToMore(page, 'No Such Destination')
  } catch (error) {
    failure = error as Error
  }

  expect(failure, 'goToMore must fail when the item cannot appear').not.toBeNull()
  // It names what it was waiting for — the menu item — not a teardown artifact.
  expect(String(failure)).toContain('No Such Destination')
  expect(String(failure)).toContain('menuitem')
  // And it fails within goToMore's own 20s bound (plus margin), not the test's whole budget.
  expect(Date.now() - started).toBeLessThan(35_000)
})
