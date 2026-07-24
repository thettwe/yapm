import { expect, type Locator, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

function row(page: Page, title: string): Locator {
  return page.locator(ROW).filter({ hasText: title })
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

// Create a team from the workspace overview and open its issue list.
async function openTeamIssues(page: Page): Promise<string> {
  const teamName = unique('Team')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()

  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()

  // The team-detail "Issues" link must reach the standalone issue list, not re-render detail.
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
  await expect(
    page.getByRole('heading', { name: new RegExp(`${teamName} · Issues`) }),
  ).toBeVisible()
  return teamName
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(row(page, title)).toBeVisible({ timeout: 20_000 })
}

test('the issue list is reachable and issues persist across a reload', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Persist issue')
  await createIssue(page, title)

  // The server-authoritative number settles from its pending state without a reload.
  await expect(row(page, title)).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })

  await page.reload()
  await expect(row(page, title)).toBeVisible({ timeout: 20_000 })
})

test('keyboard navigation changes an issue status and it persists', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Keyboard issue')
  await createIssue(page, title)

  const target = row(page, title)
  await target.focus()
  await page.keyboard.press('j')
  await expect(target).toBeFocused({ timeout: 10_000 })

  // "s" opens the status palette scoped to the focused issue; filter to "In Progress" and
  // select it with the keyboard (the primary interaction; avoids click races with cmdk's
  // re-render churn while sync is settling).
  await page.keyboard.press('s')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  const search = page.getByPlaceholder(/Set status of/)
  await search.fill('Progress')
  await expect(page.getByRole('option', { name: /Set status: In Progress/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Set status: Backlog/ })).toHaveCount(0)
  await search.press('Enter')

  const inProgress = page.getByRole('region', { name: 'In Progress', exact: true })
  await expect(inProgress.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await expect(
    page
      .getByRole('region', { name: 'In Progress', exact: true })
      .locator(ROW)
      .filter({ hasText: title }),
  ).toBeVisible({ timeout: 20_000 })
})

test('the command palette creates an issue from anywhere in the list', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()

  await page.getByRole('option', { name: /New issue/ }).click()
  const title = unique('Palette issue')
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')

  await expect(row(page, title)).toBeVisible({ timeout: 20_000 })
})

test('filtering by text narrows the list', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const keep = unique('Keepalpha')
  const hide = unique('Hidebeta')
  await createIssue(page, keep)
  await createIssue(page, hide)

  await page.getByLabel('Search issues').fill(keep)

  await expect(row(page, keep)).toBeVisible()
  await expect(row(page, hide)).toHaveCount(0)
})

async function openIssue(page: Page, title: string): Promise<Locator> {
  const target = row(page, title)
  await target.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible()
  return panel
}

test('an issue opens to a detail panel where the description and comments persist', async ({
  page,
}) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Detail issue')
  await createIssue(page, title)
  await expect(row(page, title)).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })

  const panel = await openIssue(page, title)
  await expect(panel.getByRole('textbox', { name: 'Issue title' })).toHaveValue(title)

  const description = panel.getByRole('textbox', { name: 'Issue description' })
  await description.click()
  await page.keyboard.type('Root cause identified in the reconnect path')

  const composer = panel.getByRole('textbox', { name: 'Add a comment' })
  await composer.click()
  await page.keyboard.type('Investigating this now')
  await panel.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(
    panel.getByRole('article').filter({ hasText: 'Investigating this now' }),
  ).toBeVisible({ timeout: 20_000 })

  // Let the debounced description write settle authoritatively, then reload: the panel
  // reopens from the ?open search param and both edits are still there.
  await page.waitForTimeout(900)
  await page.reload()

  const reopened = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(reopened).toBeVisible({ timeout: 20_000 })
  await expect(reopened.getByText('Root cause identified in the reconnect path')).toBeVisible()
  await expect(
    reopened.getByRole('article').filter({ hasText: 'Investigating this now' }),
  ).toBeVisible()
})

test('status can be changed from the detail panel and persists', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Detail status')
  await createIssue(page, title)
  await expect(row(page, title)).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })

  const panel = await openIssue(page, title)
  await panel.getByRole('button', { name: /^Status:/ }).click()
  await page.getByRole('menuitem', { name: /In Progress/ }).click()

  await expect(panel.getByRole('button', { name: 'Status: In Progress' })).toBeVisible({
    timeout: 20_000,
  })

  await page.reload()
  const reopened = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(reopened.getByRole('button', { name: 'Status: In Progress' })).toBeVisible({
    timeout: 20_000,
  })
})
