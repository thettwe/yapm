import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount, stop, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const TRIAGE_ROW = '[data-testid="triage-row"]'
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

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<string> {
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
  return teamName
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
}

// Send the list's only issue to triage through the command palette (its ambient target is the
// focused row — index 0 in a single-issue team). Filter to the single action and select it with
// the keyboard rather than clicking an unfiltered deep item: cmdk re-sorts its list on every
// render while Zero sync settles, so a click on a moving row races the re-render churn. Typing
// narrows the list to one stable option and Enter fires it off the input, immune to that churn.
// `exact`: the palette's persistent escalation row echoes the typed query back, so a substring
// name now matches the action AND `Search everything for "Send to triage" →`.
async function sendToTriage(page: Page, title: string): Promise<void> {
  const target = page.locator(ROW).filter({ hasText: title })
  await target.focus()
  await page.keyboard.press('j')
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  const search = page.getByPlaceholder(/Type a command or search/)
  await search.fill('Send to triage')
  await expect(page.getByRole('option', { name: 'Send to triage', exact: true })).toBeVisible()
  await search.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toHaveCount(0, { timeout: 20_000 })
}

async function openTriage(page: Page): Promise<void> {
  await stop(page, 'Triage').click()
  await expect(page.getByRole('heading', { name: /Triage/ })).toBeVisible({ timeout: 20_000 })
}

test('flag an issue into triage, then accept it back into the list with the keyboard', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)

  const title = unique('Incoming')
  await createIssue(page, title)
  await sendToTriage(page, title)

  await openTriage(page)
  const inboxRow = page.locator(TRIAGE_ROW).filter({ hasText: title })
  await expect(inboxRow).toBeVisible({ timeout: 20_000 })

  // Keyboard-first accept: focus the inbox row and press A. It leaves the inbox.
  await inboxRow.focus()
  await page.keyboard.press('a')
  await expect(page.locator(TRIAGE_ROW).filter({ hasText: title })).toHaveCount(0, {
    timeout: 20_000,
  })

  // Accepted issues return to the normal list.
  await stop(page, 'Issues').click()
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
})

test('decline a triage issue cancels it and clears the inbox', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  const title = unique('Reject me')
  await createIssue(page, title)
  await sendToTriage(page, title)

  await openTriage(page)
  const inboxRow = page.locator(TRIAGE_ROW).filter({ hasText: title })
  await expect(inboxRow).toBeVisible({ timeout: 20_000 })

  await inboxRow.focus()
  await page.keyboard.press('d')
  await expect(page.locator(TRIAGE_ROW).filter({ hasText: title })).toHaveCount(0, {
    timeout: 20_000,
  })

  // The declined issue reappears in the list as Canceled.
  await stop(page, 'Issues').click()
  const canceled = page.getByRole('region', { name: 'Canceled', exact: true })
  await expect(canceled.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
})

test('route a triage issue applies fields and clears the inbox', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  const title = unique('Route me')
  await createIssue(page, title)
  await sendToTriage(page, title)

  await openTriage(page)
  const inboxRow = page.locator(TRIAGE_ROW).filter({ hasText: title })
  await expect(inboxRow).toBeVisible({ timeout: 20_000 })

  // Keyboard-open the route dialog, pick a status, and submit.
  await inboxRow.focus()
  await page.keyboard.press('r')
  const dialog = page.getByRole('dialog', { name: 'Route issue' })
  await expect(dialog).toBeVisible({ timeout: 20_000 })
  await dialog.getByLabel('Status').selectOption('todo')
  await dialog.getByTestId('route-submit').click()
  await expect(page.locator(TRIAGE_ROW).filter({ hasText: title })).toHaveCount(0, {
    timeout: 20_000,
  })

  // The routed issue lands in the list under its new status.
  await stop(page, 'Issues').click()
  const todo = page.getByRole('region', { name: 'Todo', exact: true })
  await expect(todo.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
})

test('the Triage view is correct across every preset in light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  const title = unique('Themed incoming')
  await createIssue(page, title)
  await sendToTriage(page, title)
  await openTriage(page)
  const row = page.locator(TRIAGE_ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })

  // Drive presets through the real appearance control rather than injecting localStorage: the
  // synced user preference is the source of truth for the theme (theme/provider.tsx), so a raw
  // localStorage write loses to the sync override the moment a preference has been persisted
  // (e.g. by theme.spec, which runs first). Mode is device-local and reached by toggling.
  const html = page.locator('html')
  await page.getByRole('button', { name: /account menu for/i }).click()
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  const themeSelect = page.getByLabel('Theme')
  await expect(themeSelect).toBeVisible()
  const modeToggle = page.getByRole('button', { name: /^(Dark|Light)$/ })

  for (const preset of PRESETS) {
    await themeSelect.selectOption(preset)
    await expect(html).toHaveAttribute('data-theme', preset)
    for (const mode of MODES) {
      const isDark = await html.evaluate((el) => el.classList.contains('dark'))
      if (isDark !== (mode === 'dark')) await modeToggle.click()
      await expect
        .poll(() => html.evaluate((el) => el.classList.contains('dark')))
        .toBe(mode === 'dark')
      await expect(row).toBeVisible()
    }
  }
})

test('a viewer sees a read-only triage inbox', async ({ page, browser }) => {
  await enterApp(page)
  const teamName = await openTeam(page)

  const title = unique('Viewer triage')
  await createIssue(page, title)
  await sendToTriage(page, title)

  // The admin mints a viewer invite from the workspace overview.
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const viewer = {
    email: uniqueEmail('triage-viewer'),
    password: 'viewer-password-1234',
    name: `Triage Viewer ${Date.now().toString(36)}`,
  }
  const context = await browser.newContext()
  try {
    const vp = await context.newPage()
    await vp.goto(inviteLink)
    await vp.getByRole('button', { name: 'Create one' }).click()
    await vp.getByLabel('Name').fill(viewer.name)
    await vp.getByLabel('Email').fill(viewer.email)
    await vp.getByLabel('Password', { exact: true }).fill(viewer.password)
    await vp.getByTestId('login-submit').click()
    await expect(vp.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
    await expect(vp.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    // The viewer joins the team for read scope, then opens its triage inbox. The Triage link
    // lives on the issue-views switch, so reach it via Issues (the team overview only links to
    // Issues and Board).
    const teamCard = vp.getByRole('listitem').filter({ hasText: teamName })
    await teamCard.getByRole('button', { name: 'Join this team' }).click()
    await vp.getByRole('link', { name: new RegExp(teamName) }).click()
    await stop(vp, 'Issues').click()
    await stop(vp, 'Triage').click()
    await expect(vp.getByRole('heading', { name: /Triage/ })).toBeVisible({ timeout: 20_000 })

    // The viewer reads the inbox row, but every triage action is absent.
    const inboxRow = vp.locator(TRIAGE_ROW).filter({ hasText: title })
    await expect(inboxRow).toBeVisible({ timeout: 20_000 })
    await expect(vp.locator('[data-testid="triage-accept"]')).toHaveCount(0)
    await expect(vp.locator('[data-testid="triage-route"]')).toHaveCount(0)
    await expect(vp.locator('[data-testid="triage-decline"]')).toHaveCount(0)

    // The keyboard handlers are gated too: a/d/r on a focused row are no-ops.
    await inboxRow.focus()
    await vp.keyboard.press('a')
    await vp.keyboard.press('d')
    await vp.keyboard.press('r')
    await expect(vp.getByRole('dialog', { name: 'Route issue' })).toHaveCount(0)
    await expect(vp.locator(TRIAGE_ROW).filter({ hasText: title })).toBeVisible()
  } finally {
    await context.close()
  }
})
