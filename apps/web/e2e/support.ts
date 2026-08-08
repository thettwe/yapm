import { expect, type Locator, type Page } from '@playwright/test'

// The Playwright server env pins YAPM_BOOTSTRAP_ADMIN_EMAIL to this address, so this account
// deterministically becomes the workspace admin regardless of sign-up order. Every other
// account starts as a non-member and must accept an invite.
export const ADMIN = {
  email: 'admin@example.test',
  password: 'admin-password-1234',
  name: 'Admin User',
}

export function uniqueEmail(prefix = 'user'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`
}

export interface Credentials {
  email: string
  password: string
  name?: string
}

async function fillCredentials(page: Page, credentials: Credentials): Promise<void> {
  if (credentials.name !== undefined) {
    await page.getByLabel('Name').fill(credentials.name)
  }
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password', { exact: true }).fill(credentials.password)
}

export async function signUp(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Create one' }).click()
  await fillCredentials(page, credentials)
  await page.getByTestId('login-submit').click()
}

export async function signIn(page: Page, credentials: Credentials): Promise<void> {
  await page.goto('/login')
  await fillCredentials(page, { email: credentials.email, password: credentials.password })
  await page.getByTestId('login-submit').click()
}

// Sign up the account if it does not exist yet, otherwise sign in. The per-test baseline reset
// (`fixtures.ts`) clears every account, so the first call inside a test creates the account and the
// `/api/zero/token` that follows promotes it; a second client in the same test finds the address
// taken and falls through to sign-in.
export async function ensureAccount(page: Page, credentials: Credentials): Promise<void> {
  await signUp(page, credentials)
  // A fresh sign-up navigates into the app and unmounts the form; a duplicate keeps the
  // form mounted (staying in sign-up mode) and shows a "user already exists" alert. Settle
  // on whichever happens — the submit button leaving the DOM, or the alert appearing —
  // rather than guessing from the mode-dependent toggle label.
  const submit = page.getByTestId('login-submit')
  await Promise.race([
    submit.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {}),
    page
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => {}),
  ])
  const stillOnLogin = await submit.isVisible().catch(() => false)
  if (stillOnLogin) {
    await signIn(page, credentials)
  }
}

export type WorkspaceRole = 'admin' | 'member' | 'viewer'

export interface MintInviteOptions {
  role?: WorkspaceRole
  // A shareable link bound to a team, so accepting it joins the workspace AND that team in one
  // step. Named by the label the dialog's team select renders.
  teamName?: string
}

async function inviteLinkValues(links: Locator): Promise<string[]> {
  return await links.evaluateAll((nodes) => nodes.map((node) => (node as HTMLInputElement).value))
}

// Mint an invite from the workspace overview and return the link that was NOT on the page a moment
// ago. The `invite-link` inputs are ordered by `invites.all`'s `createdAt desc`, which is the
// query's business and not the spec's: reading `.first()` is a selector that is right by accident,
// and it stops being right the moment that ordering changes. The email field is left empty
// deliberately — filling it fires the invite-email POST, a different capability with its own tests
// and no transport configured here.
export async function mintInvite(page: Page, options: MintInviteOptions = {}): Promise<string> {
  const links = page.getByTestId('invite-link')
  const before = new Set(await inviteLinkValues(links))

  await page.getByTestId('create-invite').click()
  const dialog = page.getByRole('dialog')
  if (options.role !== undefined) {
    await dialog.getByLabel('Role', { exact: true }).selectOption(options.role)
  }
  if (options.teamName !== undefined) {
    await dialog.getByLabel('Team (optional)').selectOption({ label: options.teamName })
  }
  await dialog.getByRole('button', { name: 'Create invite' }).click()

  await expect(links).toHaveCount(before.size + 1, { timeout: 20_000 })
  const minted = (await inviteLinkValues(links)).filter((value) => !before.has(value))
  expect(
    minted,
    `expected exactly one invite link that was not on the page before (saw ${minted.length})`,
  ).toHaveLength(1)
  return minted[0] as string
}

// The deck's six destinations (app-frame band 1). Scoped to the nav landmark, because a page may
// legitimately hold its own doorway with the same label — Home's onward footer links to Issues too,
// and an unscoped lookup would match both.
export function stop(page: Page, name: string): Locator {
  return page.getByRole('navigation', { name: 'Destinations' }).getByRole('link', { name })
}

// Retros, Projects and Roadmap live behind `more▾`, which is a transient: it has to be opened.
export async function goToMore(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Destinations' }).getByRole('button').click()
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`, 'u') }).click()
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
}
