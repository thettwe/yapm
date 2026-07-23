import { expect, type Page } from '@playwright/test'

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

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /account menu/i }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
}
