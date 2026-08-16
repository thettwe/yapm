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

// Sign up the account if it does not exist yet, otherwise sign in. Idempotent across a run
// on a shared database (the first call creates the account; later calls fall through to
// sign-in when sign-up reports the address is taken).
export async function ensureAccount(page: Page, credentials: Credentials): Promise<void> {
  await signUp(page, credentials)
  // A fresh sign-up leaves `/login` once the landing decision resolves; a duplicate stays on it
  // (in sign-up mode) and shows a "user already exists" alert. Settle on whichever happens — the
  // URL changing, or the alert appearing — rather than guessing from the mode-dependent label.
  //
  // The URL, not the submit button's visibility: the button is a rendered node and the sign-in
  // surface is re-entered by every state `/login` treats as unsettled, so probing for it reads a
  // transient render as "still signed out" and submits the form a second time. The URL only
  // changes when the decision has actually been taken.
  await Promise.race([
    page.waitForURL((url) => url.pathname !== '/login', { timeout: 15_000 }).catch(() => {}),
    page
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: 15_000 })
      .catch(() => {}),
  ])
  if (new URL(page.url()).pathname === '/login') {
    await signIn(page, credentials)
  }
}

// Signing in lands on a team's Home where the caller has one, so a spec that needs the workspace
// administration surface asks for it by name rather than assuming the door opens onto it. Four
// helpers already did exactly this; this is the one copy of it.
//
// The wait for the entry surface to resolve comes FIRST and is not decoration: `signIn` returns as
// soon as it has clicked submit, and a `goto` fired while the sign-in — or an invitation
// acceptance — is still in flight aborts the request that grants what the spec is about to assert.
export async function openWorkspaceOverview(page: Page): Promise<void> {
  await page.waitForURL((url) => url.pathname !== '/login' && url.pathname !== '/invite', {
    timeout: 20_000,
  })
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
}

// The deck's six destinations (app-frame band 1). Scoped to the nav landmark, because a page may
// legitimately hold its own doorway with the same label — Home's onward footer links to Issues too,
// and an unscoped lookup would match both.
export function stop(page: Page, name: string): Locator {
  return page.getByRole('navigation', { name: 'Destinations' }).getByRole('link', { name })
}

// Retros, Projects and Roadmap live behind `more▾`, which is a transient: it has to be opened.
// The deck is drawn on every route, so its button is clickable the instant a route change starts
// — before the transient behind it can respond. A click that lands in that window opens nothing,
// and the menu item never enters the DOM. Opening is therefore retried until an item is actually
// there, which is the only observable that says the transient is live.
// The retry keys on `aria-expanded` rather than clicking blind: the trigger is a toggle, so a
// retry that clicks an already-open menu closes it, and the loop then oscillates instead of
// converging. Opening is idempotent this way, and the item is clicked while the menu is known open.
export async function goToMore(page: Page, name: string): Promise<void> {
  const opener = page.getByRole('navigation', { name: 'Destinations' }).getByRole('button')
  const item = page.getByRole('menuitem', { name: new RegExp(`^${name}`, 'u') })
  await expect(async () => {
    if ((await opener.getAttribute('aria-expanded')) !== 'true') {
      await opener.click()
    }
    await expect(item).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await item.click()
}

// The account menu is the same transient shape as `more▾` — a Base UI menu whose trigger is
// clickable before the menu can respond — so it takes the same aria-expanded-keyed retry:
// opening is idempotent, and the item is clicked only while the menu is known open.
export async function signOut(page: Page): Promise<void> {
  const opener = page.getByRole('button', { name: /account menu/i })
  const item = page.getByRole('menuitem', { name: 'Sign out' })
  await expect(async () => {
    if ((await opener.getAttribute('aria-expanded')) !== 'true') {
      await opener.click()
    }
    await expect(item).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
  await item.click()
  await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
}
