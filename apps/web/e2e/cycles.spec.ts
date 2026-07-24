import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const CYCLE_ROW = '[data-testid="cycle-issue-row"]'
const PRESETS = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<void> {
  const teamName = unique('Team')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
}

async function openCycles(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cycles' }).click()
  await expect(page.getByRole('button', { name: 'New cycle' })).toBeVisible({ timeout: 20_000 })
}

async function createCycle(page: Page, name: string, startOffset: number, endOffset: number) {
  await page.getByTestId('new-cycle').click()
  await page.getByLabel('Cycle name').fill(name)
  await page.getByLabel('Start date').fill(isoDate(startOffset))
  await page.getByLabel('End date').fill(isoDate(endOffset))
  await page.getByRole('button', { name: 'Create cycle' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible({
    timeout: 20_000,
  })
}

test('create a cycle, assign an issue, and complete it rolls the issue to the next cycle', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)

  const issueTitle = unique('Cycle work')
  await createIssue(page, issueTitle)

  await openCycles(page)
  const cycleA = unique('Sprint A')
  const cycleB = unique('Sprint B')
  await createCycle(page, cycleA, -1, 7)
  await createCycle(page, cycleB, 8, 15)

  // Assign the issue to cycle A from the issue detail.
  await page.getByRole('link', { name: 'Issues' }).click()
  await page.locator(ROW).filter({ hasText: issueTitle }).click()
  await page.getByRole('button', { name: /^Cycle:/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(cycleA) }).click()
  await page.keyboard.press('Escape')

  // The issue appears under cycle A in the Cycles view.
  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleA) }).click()
  await expect(page.locator(CYCLE_ROW).filter({ hasText: issueTitle })).toBeVisible({
    timeout: 20_000,
  })

  // Complete cycle A: the unfinished issue rolls to cycle B.
  await page.getByTestId('complete-cycle').click()
  await page.getByRole('button', { name: new RegExp(cycleB) }).click()
  await expect(page.locator(CYCLE_ROW).filter({ hasText: issueTitle })).toBeVisible({
    timeout: 20_000,
  })
})

test('the Cycles view is correct across every preset in light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await openCycles(page)
  await createCycle(page, unique('Theme cycle'), -1, 7)

  for (const preset of PRESETS) {
    for (const mode of MODES) {
      await page.evaluate(
        ([p, m]) => {
          window.localStorage.setItem(
            'yapm:pref',
            JSON.stringify({ theme: p, mode: m, accent: null }),
          )
        },
        [preset, mode] as const,
      )
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', preset)
      const isDark = await page.locator('html').evaluate((el) => el.classList.contains('dark'))
      expect(isDark).toBe(mode === 'dark')
      await expect(page.getByRole('progressbar', { name: 'Cycle progress' })).toBeVisible({
        timeout: 20_000,
      })
    }
  }
})
