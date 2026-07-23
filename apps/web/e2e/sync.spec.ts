import { expect, type Locator, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

const NAME = '[data-testid="workspace-name"]'
const INPUT = '[data-testid="workspace-name-input"]'
const ERROR = '[data-testid="workspace-error"]'
const STATUS = '[data-testid="connection-status"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

// The rename surface requires an authenticated admin now that routes are gated; the
// bootstrap admin (pinned by YAPM_BOOTSTRAP_ADMIN_EMAIL in the Playwright env) provides it.
async function openWorkspace(page: Page): Promise<Locator> {
  await ensureAccount(page, ADMIN)
  const name = page.locator(NAME)
  await expect(name).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected')
  return name
}

async function renameWithKeyboard(page: Page, next: string): Promise<void> {
  await page.locator(NAME).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(INPUT)).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(next)
  await page.keyboard.press('Enter')
}

test('a keyboard-only rename round-trips through the server', async ({ page }) => {
  await openWorkspace(page)
  const next = unique('Keyboard rename')

  await renameWithKeyboard(page, next)

  await expect(page.locator(NAME)).toHaveText(next)
  await expect(page.locator(ERROR)).toHaveCount(0)

  await page.reload()
  await expect(page.locator(NAME)).toHaveText(next)
})

test('a rejected write rolls back and surfaces the rejection', async ({ page }) => {
  const before = unique('Before rejection')
  await openWorkspace(page)
  await renameWithKeyboard(page, before)
  await expect(page.locator(NAME)).toHaveText(before)

  await renameWithKeyboard(page, '   ')

  await expect(page.locator(ERROR)).toHaveText('Workspace name cannot be empty')
  await expect(page.locator(INPUT)).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.locator(NAME)).toHaveText(before)

  await page.reload()
  await expect(page.locator(NAME)).toHaveText(before)
})

test('a rename in one client propagates to another without a reload', async ({ browser }) => {
  const first = await browser.newContext()
  const second = await browser.newContext()

  try {
    const watcher = await first.newPage()
    const editor = await second.newPage()
    await openWorkspace(watcher)
    await openWorkspace(editor)

    const next = unique('Propagated')
    await renameWithKeyboard(editor, next)
    await expect(editor.locator(NAME)).toHaveText(next)

    await expect(watcher.locator(NAME)).toHaveText(next)
  } finally {
    await first.close()
    await second.close()
  }
})

test('reads keep working while disconnected and writes are refused, not dropped', async ({
  page,
  context,
}) => {
  const before = unique('Before offline')
  await openWorkspace(page)
  await renameWithKeyboard(page, before)
  await expect(page.locator(NAME)).toHaveText(before)

  await context.setOffline(true)
  await expect(page.locator(STATUS)).not.toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'disconnected', {
    timeout: 30_000,
  })

  await expect(page.locator(NAME)).toHaveText(before)

  const attempted = unique('Typed while offline')
  await renameWithKeyboard(page, attempted)

  await expect(page.locator(ERROR)).toContainText('Not connected')
  await expect(page.locator(INPUT)).toHaveValue(attempted)

  await context.setOffline(false)
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })

  await page.locator(INPUT).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(NAME)).toHaveText(attempted)
  await expect(page.locator(ERROR)).toHaveCount(0)
})
