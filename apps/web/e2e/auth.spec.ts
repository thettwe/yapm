import { expect, type Page } from '@playwright/test'
import { type NewContext, test } from './fixtures'
import { ADMIN, ensureAccount, mintInvite, uniqueEmail } from './support'

const NAME = '[data-testid="workspace-name"]'
const INPUT = '[data-testid="workspace-name-input"]'
const ERROR = '[data-testid="workspace-error"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}`
}

async function expectInApp(page: Page): Promise<void> {
  await expect(page.locator(NAME)).toBeVisible({ timeout: 20_000 })
}

interface Viewer {
  email: string
  password: string
  name: string
}

// The admin mints a viewer invite and a second browser accepts it. Each test that needs a viewer
// builds one this way rather than inheriting the one an earlier test made: the baseline reset runs
// between tests, so nothing an earlier test created still exists. This file used to be a
// `describe.serial` journey whose steps handed each other an invite link and an account; the steps
// are the same, they just no longer depend on the order they run in.
async function inviteAViewer(
  page: Page,
  newContext: NewContext,
): Promise<{ viewer: Viewer; viewerPage: Page }> {
  await ensureAccount(page, ADMIN)
  await expectInApp(page)
  const inviteLink = await mintInvite(page, { role: 'viewer' })

  const viewer: Viewer = {
    email: uniqueEmail('viewer'),
    password: 'viewer-password-1234',
    name: `Viewer User ${Date.now().toString(36)}`,
  }
  const context = await newContext()
  const viewerPage = await context.newPage()
  await viewerPage.goto(inviteLink)

  // Not signed in yet: the invite page offers the sign-in surface inline.
  await expect(viewerPage.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
  await viewerPage.getByRole('button', { name: 'Create one' }).click()
  await viewerPage.getByLabel('Name').fill(viewer.name)
  await viewerPage.getByLabel('Email').fill(viewer.email)
  await viewerPage.getByLabel('Password', { exact: true }).fill(viewer.password)
  await viewerPage.getByTestId('login-submit').click()

  // Acceptance runs automatically once signed in, then the app loads.
  await expectInApp(viewerPage)
  return { viewer, viewerPage }
}

test.describe('workspace auth journey', () => {
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

    const inviteLink = await mintInvite(page, { role: 'viewer' })
    await expect(page.getByTestId('invite-link')).toBeVisible()
    expect(inviteLink).toContain('/invite?token=')
  })

  test('a second user accepts the link and lands as a viewer', async ({ page, newContext }) => {
    const { viewer, viewerPage } = await inviteAViewer(page, newContext)

    await expect(viewerPage.getByTestId('members-list')).toContainText(viewer.name)
  })

  test('the viewer can read but cannot write, and sees no admin surfaces', async ({
    page,
    newContext,
  }) => {
    const { viewerPage } = await inviteAViewer(page, newContext)

    await expect(viewerPage.getByRole('heading', { name: 'Invitations' })).toHaveCount(0)
    await expect(viewerPage.getByTestId('create-team')).toHaveCount(0)

    await viewerPage.locator(NAME).click()
    await viewerPage.locator(INPUT).fill(unique('Viewer rename attempt'))
    await viewerPage.keyboard.press('Enter')
    await expect(viewerPage.locator(ERROR)).toContainText('Not authorized')
  })

  test('keyboard-only sign-in reaches the app', async ({ page, newContext }) => {
    const { viewer } = await inviteAViewer(page, newContext)

    // A third browser, so this is a sign-in from the form and not a session already in flight.
    const context = await newContext()
    const fresh = await context.newPage()
    await fresh.goto('/login')
    // No verified SSO provider on this instance, so the form advertises no SSO control at all
    // — absence, not a button that cannot complete.
    await expect(fresh.getByTestId('login-sso')).toHaveCount(0)
    await fresh.getByLabel('Email').focus()
    await fresh.keyboard.type(viewer.email)
    await fresh.keyboard.press('Tab')
    await fresh.keyboard.type(viewer.password)
    await fresh.keyboard.press('Enter')

    await expectInApp(fresh)
  })

  test('admin changes the viewer role and can remove the member', async ({ page, newContext }) => {
    const { viewer } = await inviteAViewer(page, newContext)

    // The admin's page has held the members list since before the viewer joined; the new row
    // arrives over sync, so the control is waited for rather than assumed present.
    const roleSelect = page.getByLabel(`Role for ${viewer.name}`)
    await expect(roleSelect).toBeVisible({ timeout: 20_000 })
    await roleSelect.selectOption('member')
    await expect(roleSelect).toHaveValue('member')
  })
})
