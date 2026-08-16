import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount, openWorkspaceOverview, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const TOGGLE = '[data-testid="status-automation-toggle"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await openWorkspaceOverview(page)
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function createTeam(page: Page): Promise<string> {
  const teamKey = randomKey()
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(unique('Automation team'))
  await dialog.getByLabel('Key').fill(teamKey)
  await dialog.getByRole('button', { name: 'Create team' }).click()
  await expect(page.getByRole('link', { name: new RegExp(teamKey) })).toBeVisible({
    timeout: 20_000,
  })
  return teamKey
}

// Tab from the document root until focus lands on the target. The bound is the page's own count of
// tabbable candidates, not a magic number: a control that IS in the tab order is reached within one
// full cycle, and one that is not fails instead of hanging — on a shared e2e database the number of
// teams (and so of rows above the target) grows through the run, so a fixed bound would be a flake.
async function tabTo(page: Page, selector: string): Promise<void> {
  const bound = await page.evaluate(
    () =>
      document.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ).length + 2,
  )
  await page.locator('body').press('Tab')
  for (let i = 0; i < bound; i += 1) {
    if ((await page.locator(`${selector}:focus`).count()) > 0) return
    await page.keyboard.press('Tab')
  }
  throw new Error(`${selector} was not reachable by Tab within ${bound} stops`)
}

// Seed the bootstrap cache and reload, exactly as every other preset matrix in this suite does. It
// has to be the cache and NOT the appearance popover: the popover writes a synced `user_preference`
// row, and once the shared admin account has one, zero-cache pushes it back over the cache in every
// later spec — which silently breaks five other preset tests that run after this one.
async function setPreset(page: Page, preset: string, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(
    ([p, m]) => {
      window.localStorage.setItem('yapm:pref', JSON.stringify({ theme: p, mode: m, accent: null }))
    },
    [preset, mode] as const,
  )
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', preset)
}

test('an admin turns status automation on with the keyboard and the setting survives a reload', async ({
  page,
}) => {
  await enterApp(page)
  const teamKey = await createTeam(page)

  await page.goto('/settings/connectors')
  await expect(page.getByRole('heading', { name: 'Status automation' })).toBeVisible({
    timeout: 20_000,
  })

  const row = page.locator(`[data-testid="status-automation-row"][data-team-key="${teamKey}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })
  // Off by default: a team that nobody has opted in behaves exactly as every team does today.
  await expect(row.locator(TOGGLE)).toHaveAttribute('data-enabled', 'false')

  await tabTo(page, `[data-team-key="${teamKey}"] ${TOGGLE}`)
  await expect(row.locator(TOGGLE)).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(row.locator(TOGGLE)).toHaveAttribute('data-enabled', 'true', { timeout: 20_000 })
  await expect(row).toContainText('On')

  // The round trip that matters: the write left the browser, landed in Postgres as a timestamp,
  // replicated back down the sync socket, and a cold client reads it as enabled. An optimistic-only
  // toggle passes every assertion above this line and fails here.
  await page.reload()
  const afterReload = page.locator(
    `[data-testid="status-automation-row"][data-team-key="${teamKey}"] ${TOGGLE}`,
  )
  await expect(afterReload).toHaveAttribute('data-enabled', 'true', { timeout: 30_000 })

  // And it turns back off, so opting in is not a one-way door.
  await afterReload.focus()
  await page.keyboard.press('Enter')
  await expect(afterReload).toHaveAttribute('data-enabled', 'false', { timeout: 20_000 })
  await page.reload()
  await expect(
    page.locator(`[data-testid="status-automation-row"][data-team-key="${teamKey}"] ${TOGGLE}`),
  ).toHaveAttribute('data-enabled', 'false', { timeout: 30_000 })
})

test('a member cannot reach the status-automation control', async ({ page, newContext }) => {
  await enterApp(page)
  await createTeam(page)

  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('member')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const member = {
    email: uniqueEmail('automation-member'),
    password: 'member-password-1234',
    name: `Automation Member ${Date.now().toString(36)}`,
  }
  const context = await newContext()
  const mp = await context.newPage()
  await mp.goto(inviteLink)
  await expect(mp.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
  await mp.getByRole('button', { name: 'Create one' }).click()
  await mp.getByLabel('Name').fill(member.name)
  await mp.getByLabel('Email').fill(member.email)
  await mp.getByLabel('Password', { exact: true }).fill(member.password)
  await mp.getByTestId('login-submit').click()
  await expect(mp.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })

  await mp.goto('/settings/connectors')
  await expect(mp.getByText(/available to workspace admins only/)).toBeVisible({
    timeout: 20_000,
  })
  await expect(mp.getByTestId('status-automation')).toHaveCount(0)
  await expect(mp.locator(TOGGLE)).toHaveCount(0)
})

test('the status-automation section renders in all three presets, light and dark', async ({
  page,
}) => {
  await enterApp(page)
  const teamKey = await createTeam(page)

  await page.goto('/settings/connectors')
  const row = page.locator(`[data-testid="status-automation-row"][data-team-key="${teamKey}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })

  const surfaces = new Set<string>()

  for (const preset of ['warm', 'focused', 'editorial'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      await setPreset(page, preset, mode)
      await expect(row).toBeVisible({ timeout: 30_000 })

      // A token that failed to resolve in a preset paints nothing — transparent text on an unset
      // surface. The computed values are the only honest proof the row is dressed in this theme,
      // and collecting them across presets proves they came from the preset rather than a literal.
      const painted = await row.evaluate((node) => {
        const style = window.getComputedStyle(node)
        return {
          color: style.color,
          surface: window.getComputedStyle(document.body).backgroundColor,
          font: style.fontFamily,
          border: style.borderTopColor,
        }
      })
      expect(painted.color).not.toBe('rgba(0, 0, 0, 0)')
      expect(painted.surface).not.toBe('rgba(0, 0, 0, 0)')
      expect(painted.border).not.toBe('rgba(0, 0, 0, 0)')
      expect(painted.font).not.toBe('')
      surfaces.add(`${painted.surface}|${painted.color}|${painted.border}`)
    }
  }

  // Six distinct dressings: three presets times light and dark. A hardcoded color anywhere in the
  // row would collapse them and this is where that shows up.
  expect(surfaces.size).toBe(6)
})
