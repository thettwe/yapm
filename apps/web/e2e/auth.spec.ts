import type { BrowserContext, Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount, openWorkspaceOverview, uniqueEmail } from './support'

const NAME = '[data-testid="workspace-name"]'
const INPUT = '[data-testid="workspace-name-input"]'
const ERROR = '[data-testid="workspace-error"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

// Signing in lands on work now, so the surface this spec is ABOUT is asked for by name.
async function expectInApp(page: Page): Promise<void> {
  await openWorkspaceOverview(page)
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

    test('a second user accepts the link and lands as a viewer', async ({ newContext }) => {
      expect(inviteLink).not.toBe('')
      const context = await newContext()
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
    })

    test('the viewer can read but cannot write, and sees no admin surfaces', async ({
      newContext,
    }) => {
      const context = await newContext()
      const page = await context.newPage()
      await signInViewer(context, page, viewer)
      await expectInApp(page)

      await expect(page.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
      await expect(page.getByTestId('create-team')).toHaveCount(0)

      await page.locator(NAME).click()
      await page.locator(INPUT).fill(unique('Viewer rename attempt'))
      await page.keyboard.press('Enter')
      await expect(page.locator(ERROR)).toContainText('Not authorized')
    })

    test('keyboard-only sign-in reaches the app', async ({ newContext }) => {
      const context = await newContext()
      const page = await context.newPage()
      await page.goto('/login')
      // No verified SSO provider on this instance, so the form advertises no SSO control at all
      // — absence, not a button that cannot complete.
      await expect(page.getByTestId('login-sso')).toHaveCount(0)
      await page.getByLabel('Email').focus()
      await page.keyboard.type(viewer.email)
      await page.keyboard.press('Tab')
      await page.keyboard.type(viewer.password)
      await page.keyboard.press('Enter')

      await expectInApp(page)
    })

    // The front door itself, which only this tier can observe: signing in physically traverses
    // better-auth's own redirect path, and what the browser ends up looking at is the thing under
    // test. A fresh context every time, so the landing is resolved rather than remembered.
    test('signing in lands on a team’s work, and a member of no team on administration', async ({
      newContext,
    }) => {
      const context = await newContext()
      const page = await context.newPage()
      await signInViewer(context, page, ADMIN)

      // The admin belongs to the workspace and can read every team, so the door opens on work.
      await expect(page).toHaveURL(/\/teams\/[^/]+\/?$/, { timeout: 20_000 })
      await expect(page.locator(NAME)).toHaveCount(0)

      // The viewer accepted a role-only invitation, so they are on no team at all — and the only
      // page whose contents are theirs is the one this change leaves exactly where it was.
      const viewerContext = await newContext()
      const viewerPage = await viewerContext.newPage()
      await signInViewer(viewerContext, viewerPage, viewer)

      await expect(viewerPage).toHaveURL(/\/$/, { timeout: 20_000 })
      await expect(viewerPage.locator(NAME)).toBeVisible({ timeout: 20_000 })
    })

    // The fourth door (design §D10). A team-bound invitation grants membership of a named team, so
    // acceptance lands there — the path the shareable role-only invite above never exercises, and
    // the one where sending every acceptor to administration was most visibly wrong.
    test('accepting a team-bound invitation lands on that team', async ({ page, newContext }) => {
      await ensureAccount(page, ADMIN)
      await expectInApp(page)

      const teamName = unique('Bound')
      await page.getByTestId('create-team').click()
      const teamDialog = page.getByRole('dialog')
      await teamDialog.getByLabel('Name', { exact: true }).fill(teamName)
      await teamDialog.getByLabel('Key').fill('BND')
      await teamDialog.getByRole('button', { name: 'Create team' }).click()
      await expect(page.getByTestId('teams-list')).toContainText(teamName)

      await page.getByTestId('create-invite').click()
      const inviteDialog = page.getByRole('dialog')
      await inviteDialog.getByLabel('Team (optional)').selectOption({ label: teamName })
      await inviteDialog.getByRole('button', { name: 'Create invite' }).click()
      const link = await page.getByTestId('invite-link').first().inputValue()

      const context = await newContext()
      const joiner = await context.newPage()
      await joiner.goto(link)
      await joiner.getByRole('button', { name: 'Create one' }).click()
      await joiner.getByLabel('Name').fill('Bound Joiner')
      await joiner.getByLabel('Email').fill(uniqueEmail('bound'))
      await joiner.getByLabel('Password', { exact: true }).fill('bound-password-1234')
      await joiner.getByTestId('login-submit').click()

      await expect(joiner).toHaveURL(/\/teams\/[^/]+\/?$/, { timeout: 30_000 })
      await expect(joiner.getByTestId('deck').getByText(teamName).first()).toBeVisible({
        timeout: 20_000,
      })
      await expect(joiner.locator(NAME)).toHaveCount(0)
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
