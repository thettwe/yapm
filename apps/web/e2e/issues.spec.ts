import { expect, type Locator, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
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

// Task 8.2: the list must be correct in all three presets, light and dark. Setting the theme
// cache before load forces the preset/mode; the grouped list and the reality-strip slot must
// render from tokens with no hardcoded values in every combination.
test('the grouped list renders in all three presets, light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Preset issue')
  await createIssue(page, title)

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

      // The status group and the created row (with its unlinked reality strip) render.
      await expect(page.getByRole('region', { name: 'Todo', exact: true })).toBeVisible({
        timeout: 20_000,
      })
      const created = row(page, title)
      await expect(created).toBeVisible()
      await expect(created.getByLabel('No delivery signal yet')).toBeVisible()
    }
  }
})

// Task 8.2: a viewer reads work data but is denied every write, across the list, the detail
// panel, and the palette. Self-contained: the admin creates a team, an issue, and a viewer
// invite; a second browser context accepts it, joins the team for read scope, and verifies
// the read-only surfaces.
test('a viewer reads issues but cannot write across list, detail, and palette', async ({
  page,
  browser,
}) => {
  await enterApp(page)
  const teamName = await openTeamIssues(page)

  const issueTitle = unique('Viewer sees')
  await createIssue(page, issueTitle)
  await expect(row(page, issueTitle)).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })

  // The admin mints a viewer invite from the workspace overview.
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()
  expect(inviteLink).toContain('/invite?token=')

  const viewer = {
    email: uniqueEmail('issue-viewer'),
    password: 'viewer-password-1234',
    name: `Issue Viewer ${Date.now().toString(36)}`,
  }
  const context = await browser.newContext()
  try {
    const vp = await context.newPage()
    await vp.goto(inviteLink)
    await expect(vp.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
    await vp.getByRole('button', { name: 'Create one' }).click()
    await vp.getByLabel('Name').fill(viewer.name)
    await vp.getByLabel('Email').fill(viewer.email)
    await vp.getByLabel('Password', { exact: true }).fill(viewer.password)
    await vp.getByTestId('login-submit').click()
    await expect(vp.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
    await expect(vp.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    // The viewer joins the team for read scope, then opens its issues.
    const teamCard = vp.getByRole('listitem').filter({ hasText: teamName })
    await teamCard.getByRole('button', { name: 'Join this team' }).click()
    await vp.getByRole('link', { name: new RegExp(teamName) }).click()
    await vp.getByRole('link', { name: 'Issues' }).click()

    // List: the viewer reads the admin's issue.
    await expect(row(vp, issueTitle)).toBeVisible({ timeout: 20_000 })

    // Detail: opening the issue is fully read-only.
    const target = row(vp, issueTitle)
    await target.focus()
    await vp.keyboard.press('Enter')
    const panel = vp.getByRole('dialog', { name: 'Issue detail' })
    await expect(panel).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByRole('heading', { name: issueTitle })).toBeVisible()
    await expect(panel.getByRole('textbox', { name: 'Issue title' })).toHaveCount(0)
    await expect(panel.getByRole('textbox', { name: 'Issue description' })).toHaveCount(0)
    await expect(panel.getByRole('textbox', { name: 'Add a comment' })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: /^Status:/ })).toBeDisabled()
    await vp.keyboard.press('Escape')

    // Palette: no write commands are offered even with a focused target.
    await target.focus()
    await vp.keyboard.press('ControlOrMeta+k')
    await expect(vp.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
    await expect(vp.getByRole('option', { name: /Change status/ })).toHaveCount(0)
    await expect(vp.getByRole('option', { name: /^Assign/ })).toHaveCount(0)
    await expect(vp.getByRole('option', { name: /Add label/ })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
