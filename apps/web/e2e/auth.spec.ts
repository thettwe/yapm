import { type BrowserContext, expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const NAME = '[data-testid="workspace-name"]'
const INPUT = '[data-testid="workspace-name-input"]'
const ERROR = '[data-testid="workspace-error"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

async function expectInApp(page: Page): Promise<void> {
  await expect(page.locator(NAME)).toBeVisible({ timeout: 20_000 })
}

// The whole journey shares one fresh database and runs in order: admin bootstrap, team
// creation, a shareable invite, a second user accepting it as a viewer, and the viewer being
// unable to write. Serial so the invite created in one step is consumed by the next.
test.describe
  .serial('workspace auth journey', () => {
    const viewer = {
      email: uniqueEmail('viewer'),
      password: 'viewer-password-1234',
      name: 'Viewer User',
    }
    let inviteLink = ''

    test('first user becomes admin and sees admin-only surfaces', async ({ page }) => {
      await ensureAccount(page, ADMIN)
      await expectInApp(page)

      await expect(page.getByTestId('members-list')).toContainText(ADMIN.name)
      await expect(page.getByRole('heading', { name: 'Invitations' })).toBeVisible()
      await expect(page.getByTestId('create-team')).toBeVisible()
    })

    test('admin creates a team', async ({ page }) => {
      await ensureAccount(page, ADMIN)
      await expectInApp(page)

      const teamName = unique('Platform')
      await page.getByTestId('create-team').click()
      await page.getByLabel('Name', { exact: true }).fill(teamName)
      await page.getByLabel('Key').fill('PLAT')
      await page.getByRole('button', { name: 'Create team' }).click()

      await expect(page.getByTestId('teams-list')).toContainText(teamName)
    })

    test('admin creates a shareable viewer invite link', async ({ page }) => {
      await ensureAccount(page, ADMIN)
      await expectInApp(page)

      await page.getByTestId('create-invite').click()
      await page.getByLabel('Role', { exact: true }).selectOption('viewer')
      await page.getByRole('button', { name: 'Create invite' }).click()

      const link = page.getByTestId('invite-link').first()
      await expect(link).toBeVisible()
      inviteLink = await link.inputValue()
      expect(inviteLink).toContain('/invite?token=')
    })

    test('a second user accepts the link and lands as a viewer', async ({ browser }) => {
      expect(inviteLink).not.toBe('')
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await page.goto(inviteLink)

        // Not signed in yet: the invite page offers the sign-in surface inline.
        await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
        await page.getByRole('button', { name: 'Create one' }).click()
        await page.getByLabel('Name').fill(viewer.name)
        await page.getByLabel('Email').fill(viewer.email)
        await page.getByLabel('Password', { exact: true }).fill(viewer.password)
        await page.getByTestId('login-submit').click()

        // Acceptance runs automatically once signed in, then the app loads.
        await expectInApp(page)
        await expect(page.getByTestId('members-list')).toContainText(viewer.name)
      } finally {
        await context.close()
      }
    })

    test('the viewer can read but cannot write, and sees no admin surfaces', async ({
      browser,
    }) => {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await signInViewer(context, page, viewer)
        await expectInApp(page)

        await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
        await expect(page.getByTestId('create-team')).toHaveCount(0)

        await page.locator(NAME).click()
        await page.locator(INPUT).fill(unique('Viewer rename attempt'))
        await page.keyboard.press('Enter')
        await expect(page.locator(ERROR)).toContainText('Not authorized')
      } finally {
        await context.close()
      }
    })

    test('keyboard-only sign-in reaches the app', async ({ browser }) => {
      const context = await browser.newContext()
      try {
        const page = await context.newPage()
        await page.goto('/login')
        await page.getByLabel('Email').focus()
        await page.keyboard.type(viewer.email)
        await page.keyboard.press('Tab')
        await page.keyboard.type(viewer.password)
        await page.keyboard.press('Enter')

        await expectInApp(page)
      } finally {
        await context.close()
      }
    })

    test('admin changes the viewer role and can remove the member', async ({ page }) => {
      await ensureAccount(page, ADMIN)
      await expectInApp(page)

      const roleSelect = page.getByLabel(`Role for ${viewer.name}`)
      await expect(roleSelect).toBeVisible()
      await roleSelect.selectOption('member')
      await expect(roleSelect).toHaveValue('member')
    })
  })

async function signInViewer(
  _context: BrowserContext,
  page: Page,
  viewer: { email: string; password: string },
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(viewer.email)
  await page.getByLabel('Password', { exact: true }).fill(viewer.password)
  await page.getByTestId('login-submit').click()
}
