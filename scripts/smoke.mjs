#!/usr/bin/env node
import { chromium } from '@playwright/test'

// Compose smoke test: boot the production three-container image and prove it (a) serves the
// SPA, (b) accepts the first sign-up — which wins first-user-wins bootstrap, becoming the
// workspace admin and seeding demo content — and (c) actually SYNCS: the Zero client
// connects to zero-cache and the connection status resolves to "connected". An
// unauthenticated visit to / now renders the login page, so we must authenticate first.
//
// The sign-up is performed in one page, then the app is loaded in a fresh authenticated page
// (sharing the session cookie) to make the "connected" assertion deterministic: a fresh mount
// with the cookie already set connects immediately, whereas the tab that performed the sign-up
// races the reactive session/redirect transition. Timeouts are generous because zero-cache
// cold start on a fresh stack can take a while.
const url = (process.env.SMOKE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const timeout = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000)

const email = `smoke-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.test`
const password = 'smoke-password-1234'
const name = 'Smoke Test'

const browser = await chromium.launch()
try {
  const context = await browser.newContext()

  // 1) Sign up the first user. Mirror apps/web/e2e/support.ts signUp() exactly: open /login,
  //    switch to sign-up mode, fill the exact Name / Email / Password labels, then submit.
  const signup = await context.newPage()
  await signup.goto(`${url}/login`, { waitUntil: 'domcontentloaded', timeout })
  await signup.getByRole('button', { name: 'Create one' }).click({ timeout })
  await signup.getByLabel('Name').fill(name)
  await signup.getByLabel('Email').fill(email)
  await signup.getByLabel('Password', { exact: true }).fill(password)

  const alert = signup.getByRole('alert')
  await signup.getByTestId('login-submit').click({ timeout })

  // A failed sign-up keeps the form mounted and surfaces an alert; a success unmounts it.
  // Race the two so a server-side failure reports its message instead of timing out blindly.
  const outcome = await Promise.race([
    signup
      .getByTestId('login-submit')
      .waitFor({ state: 'hidden', timeout })
      .then(() => 'ok')
      .catch(() => 'unknown'),
    alert
      .waitFor({ state: 'visible', timeout })
      .then(() => 'alert')
      .catch(() => 'unknown'),
  ])
  if (outcome === 'alert') {
    throw new Error(`sign-up failed: ${(await alert.textContent())?.trim() ?? 'unknown error'}`)
  }

  // The better-auth session cookie is the authoritative proof the account was created,
  // independent of the mode-dependent form transition above.
  const deadline = Date.now() + timeout
  let authenticated = false
  while (!authenticated && Date.now() < deadline) {
    authenticated = (await context.cookies()).some((c) => c.name === 'better-auth.session_token')
    if (!authenticated) await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!authenticated) {
    throw new Error('sign-up did not establish a session cookie')
  }
  await signup.close().catch(() => {})

  // 2) The real sync-in-prod check: load the app authenticated and wait for Zero to connect.
  const app = await context.newPage()
  const errors = []
  app.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  app.on('pageerror', (error) => errors.push(error.message))

  await app.goto(`${url}/`, { waitUntil: 'domcontentloaded', timeout })
  await app
    .locator('[data-testid="connection-status"][data-connection="connected"]')
    .waitFor({ state: 'attached', timeout })

  if (errors.length > 0) {
    throw new Error(`browser console reported errors:\n${errors.join('\n')}`)
  }

  console.log(
    `smoke ok: signed up "${email}", the prod image served the SPA, and Zero sync connected`,
  )
} finally {
  await browser.close()
}
