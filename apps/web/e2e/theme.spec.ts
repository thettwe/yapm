import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

const CACHE_KEY = 'yapm:pref'

async function expectInApp(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
}

// Appearance lives in the account menu now (app-frame §D8). Reached with no pointer: focus the
// chip, Enter to open, then the entry.
async function openAppearance(page: Page): Promise<void> {
  const chip = page.getByRole('button', { name: /account menu for/i })
  await chip.focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Appearance' }).click()
  await expect(page.getByLabel('Theme')).toBeVisible({ timeout: 20_000 })
}

function rootTheme(page: Page): Promise<{ theme: string | null; dark: boolean; accent: string }> {
  return page.evaluate(() => {
    const root = document.documentElement
    return {
      theme: root.getAttribute('data-theme'),
      dark: root.classList.contains('dark'),
      accent: root.style.getPropertyValue('--accent').trim(),
    }
  })
}

test.describe('theme preference', () => {
  test('applies the cached theme on the document root before first paint (no flash)', async ({
    browser,
  }) => {
    const context = await browser.newContext()
    try {
      // Seed the bootstrap cache before any page script runs, mimicking a prior session.
      await context.addInitScript(() => {
        localStorage.setItem(
          'yapm:pref',
          JSON.stringify({ theme: 'editorial', mode: 'dark', accent: '#2288cc' }),
        )
      })
      const page = await context.newPage()
      await page.goto('/login')

      // The synchronous inline script in index.html sets these before the bundle mounts, so
      // the very first paint is already the cached theme — no default-to-warm flash.
      const applied = await rootTheme(page)
      expect(applied.theme).toBe('editorial')
      expect(applied.dark).toBe(true)
      expect(applied.accent).toBe('#2288cc')
    } finally {
      await context.close()
    }
  })

  test('defaults to warm when no cache is present', async ({ browser }) => {
    const context = await browser.newContext()
    try {
      const page = await context.newPage()
      await page.goto('/login')
      const applied = await rootTheme(page)
      expect(applied.theme).toBe('warm')
    } finally {
      await context.close()
    }
  })

  test('keyboard-only theme, mode, and accent change persist across reload', async ({ page }) => {
    await ensureAccount(page, ADMIN)
    await expectInApp(page)

    // Open the appearance dialog from the keyboard. It folded into the account menu with the rest
    // of the settings when the three-band frame landed: appearance is a setting, not a destination.
    await openAppearance(page)

    // Preset change.
    const themeSelect = page.getByLabel('Theme')
    await expect(themeSelect).toBeVisible()
    await themeSelect.selectOption('focused')
    await expect.poll(async () => (await rootTheme(page)).theme).toBe('focused')

    // Mode toggle by keyboard.
    const before = (await rootTheme(page)).dark
    const modeToggle = page.getByRole('button', { name: /^(Dark|Light)$/ })
    await modeToggle.focus()
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await rootTheme(page)).dark).toBe(!before)

    // Accent value typed and confirmed by keyboard; the auto-derived vars apply live.
    const accentInput = page.getByLabel('Accent color value')
    await accentInput.focus()
    await accentInput.fill('#22aa55')
    await page.keyboard.press('Enter')
    await expect.poll(async () => (await rootTheme(page)).accent).toBe('#22aa55')

    // The email preference rides the same popover and the same `preference.set` mutator, and it is
    // the ONLY field here with no localStorage cache behind it — so surviving a reload proves the
    // mutator wrote it and the synced row came back, not that a bootstrap cache replayed it.
    const emailSelect = page.getByLabel('Email notifications')
    await emailSelect.focus()
    await emailSelect.selectOption('none')
    await expect(emailSelect).toHaveValue('none')

    // The preference is cached (bootstrap source of truth) and synced via the mutator.
    const cached = await page.evaluate((key) => localStorage.getItem(key), CACHE_KEY)
    expect(cached).toContain('focused')
    expect(cached).toContain('#22aa55')
    expect(cached).not.toContain('none')

    // Reload: the theme + accent survive with no pointer interaction and no flash.
    await page.reload()
    await expectInApp(page)
    await expect.poll(async () => (await rootTheme(page)).theme).toBe('focused')
    await expect.poll(async () => (await rootTheme(page)).accent).toBe('#22aa55')

    // And so does the email preference, read straight back off the synced row.
    await openAppearance(page)
    await expect(page.getByLabel('Email notifications')).toHaveValue('none')
  })
})
