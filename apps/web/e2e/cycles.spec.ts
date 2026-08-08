import { expect, type Page } from '@playwright/test'
import { test } from './fixtures'
import { ADMIN, ensureAccount, stop } from './support'

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
  await stop(page, 'Issues').click()
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
  await stop(page, 'Cycles').click()
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

async function assignIssueToCycle(page: Page, issueTitle: string, cycleName: string) {
  await stop(page, 'Issues').click()
  await page.locator(ROW).filter({ hasText: issueTitle }).click()
  await page.getByRole('button', { name: /^Cycle:/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(cycleName) }).click()
  await page.keyboard.press('Escape')
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
  await stop(page, 'Issues').click()
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

test('the Cycles view is fully keyboard-operable', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  const issueTitle = unique('KB cycle work')
  await createIssue(page, issueTitle)

  await openCycles(page)
  const cycleA = unique('KB Sprint A')
  const cycleB = unique('KB Sprint B')
  await createCycle(page, cycleA, -1, 7)
  await createCycle(page, cycleB, 8, 15)
  await assignIssueToCycle(page, issueTitle, cycleA)

  await openCycles(page)

  // The rail is keyboard-operable: focus a cycle button and feature it with Enter.
  const railB = page.getByRole('button', { name: new RegExp(cycleB) })
  await railB.focus()
  await page.keyboard.press('Enter')
  await expect(railB).toHaveAttribute('aria-current', 'true')

  // Space activates a rail button too; feature cycle A (which holds the issue).
  const railA = page.getByRole('button', { name: new RegExp(cycleA) })
  await railA.focus()
  await page.keyboard.press('Space')
  await expect(railA).toHaveAttribute('aria-current', 'true')

  // Keyboard-open a listed issue: focus its cycle row and press Enter — the detail opens.
  const cycleRow = page.locator(CYCLE_ROW).filter({ hasText: issueTitle })
  await expect(cycleRow).toBeVisible({ timeout: 20_000 })
  await cycleRow.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Issue detail' })).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  // Complete the featured cycle with the keyboard, then confirm the issue rolled to cycle B.
  await openCycles(page)
  await railA.focus()
  await page.keyboard.press('Enter')
  const complete = page.getByTestId('complete-cycle')
  await complete.focus()
  await page.keyboard.press('Enter')
  await railB.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(CYCLE_ROW).filter({ hasText: issueTitle })).toBeVisible({
    timeout: 20_000,
  })
})

test('cycle grouping and filtering in the list are keyboard-operable', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  const inCycle = unique('KB grouped')
  const noCycle = unique('KB ungrouped')
  await createIssue(page, inCycle)
  await createIssue(page, noCycle)

  await openCycles(page)
  const cycleA = unique('KB Group cycle')
  await createCycle(page, cycleA, -1, 7)
  await assignIssueToCycle(page, inCycle, cycleA)

  // Group the list by cycle with the keyboard (native select): buckets appear, "No cycle" last.
  await stop(page, 'Issues').click()
  const groupBy = page.getByLabel('Group by')
  await groupBy.focus()
  await groupBy.selectOption('cycle')
  await expect(page.getByText(cycleA, { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('No cycle', { exact: true })).toBeVisible()

  // Filter by the cycle using the keyboard: open the menu, toggle the option, close it.
  const filterButton = page.getByRole('button', { name: 'Filter by Cycle' })
  await filterButton.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: new RegExp(cycleA) }).press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator(ROW).filter({ hasText: inCycle })).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(ROW).filter({ hasText: noCycle })).toHaveCount(0)
})
