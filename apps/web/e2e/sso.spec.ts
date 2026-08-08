import { expect, type Page } from '@playwright/test'
import { deleteSsoProvider, findUserId, openDb, seedSsoProvider } from './db'
import { test } from './fixtures'
import { ADMIN, ensureAccount, mintInvite, uniqueEmail } from './support'

// The SSO settings surface end to end: reachable by keyboard from the user menu, operable by
// keyboard once there, absent for everyone who is not a workspace admin, and legible in all three
// presets light and dark.
//
// What this file CANNOT do is complete a registration: that performs OIDC discovery against a real
// issuer and the harness has none. So the successful-registration facts — the redirect URI and the
// minted TXT record value — are asserted in `apps/server/src/sso/admin-routes.pg.test.ts`, and what
// is asserted here is everything the browser reaches without an identity provider, including that a
// failed registration is reported as a failure rather than as something to pay for.

const PROVIDER_ID = `e2e-idp-${Date.now().toString(36)}`
const DOMAIN = 'sso-e2e.example.test'
// PHRASES, not words. The page's own honest copy says "there is no seat count and no SSO tier" and
// names the licence in the docs link, so a bare /seat|licence/ matches the very sentences that
// prove the point. What free-means-free forbids is the ASK — a price, a plan gate, a trial — and
// none of these phrasings can appear in copy that has nothing to sell.
const UPSELL = /upgrade to|seat cap|licen[cs]e key|per user\/month|start (a )?trial/i

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
}

test('an admin reaches and operates the SSO surface with the keyboard alone', async ({ page }) => {
  await enterApp(page)

  // Into the surface by keyboard, from the same menu the AI and connector pages hang off — and by
  // key press, not by click: the popup's roving focus is the only way a keyboard-only admin reaches
  // this page, so it is what this navigation exercises. A menu part that throws on open takes every
  // entry down with it, which no assertion on the trigger alone would notice.
  await page.getByRole('button', { name: /account menu/i }).focus()
  await page.keyboard.press('Enter')
  const entry = page.getByRole('menuitem', { name: 'Single sign-on' })
  await expect(entry).toBeVisible({ timeout: 20_000 })
  // Walk down rather than counting: the entry's position among Connectors, AI and Sign out is
  // arrangement, not behaviour, and the fact under test is that arrow keys reach it at all. The
  // bound is the menu's own length, so adding an item to the menu never turns this red.
  const menuLength = await page.getByRole('menuitem').count()
  for (let step = 0; step < menuLength; step += 1) {
    if (await entry.evaluate((node) => node === document.activeElement)) break
    await page.keyboard.press('ArrowDown')
  }
  await expect(
    entry,
    `the SSO entry must be reachable within ${menuLength} arrow presses`,
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Single sign-on', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByTestId('sso-no-providers')).toBeVisible()

  // Tab order is DOM order through the five fields a registration needs. Enter submits: after the
  // first field is put into focus, every step to the submission is a key press.
  await page.getByLabel('Provider id').focus()
  await page.keyboard.type(PROVIDER_ID)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Email domain')).toBeFocused()
  await page.keyboard.type(DOMAIN)
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Issuer URL')).toBeFocused()
  await page.keyboard.type('https://idp.example.test')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Discovery URL (optional)')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Client ID')).toBeFocused()
  await page.keyboard.type('e2e-client-id-4321')
  await page.keyboard.press('Tab')
  await expect(page.getByLabel('Client secret')).toBeFocused()
  await page.keyboard.type('e2e-placeholder-not-a-real-secret')
  await page.keyboard.press('Enter')

  // There is no IdP at `idp.example.test`, so this fails — and the failure is a stated reason, not
  // a wall. The two surfaces that could plausibly carry an ask, the registration form and the
  // sentence that reports the refusal, name nothing to buy.
  await expect(page.getByTestId('sso-register-error')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('sso-register-error')).not.toHaveText(UPSELL)
  await expect(page.getByTestId('sso-register-form')).not.toHaveText(UPSELL)
})

test('an unverified provider shows the DNS record an admin has to publish', async ({ page }) => {
  await enterApp(page)

  const db = openDb()
  try {
    await seedSsoProvider(db, {
      providerId: PROVIDER_ID,
      domain: DOMAIN,
      userId: await findUserId(db, ADMIN.email),
    })

    await page.goto('/settings/sso')
    const provider = page.locator(`[data-provider-id="${PROVIDER_ID}"]`)
    await expect(provider).toBeVisible({ timeout: 20_000 })
    // First paint must not steal focus onto a destructive control. React runs layout effects twice
    // on mount under StrictMode — which every dev build and therefore every one of these runs uses —
    // so the confirm/cancel focus swap guards on the previous value, not on a one-shot flag.
    await expect(provider.getByTestId('sso-remove')).not.toBeFocused()
    await expect(provider.getByTestId('sso-verified-badge')).toHaveText('Domain not verified')
    // The record NAME is derived in the browser and renders before anything is minted.
    await expect(provider.getByTestId('sso-verification')).toContainText(
      `_better-auth-token-${PROVIDER_ID}.${DOMAIN}`,
    )
    // Rotation is a control on the page, not a curl in the docs — and it never reads a secret back.
    await expect(provider.getByLabel(`New client secret for ${PROVIDER_ID}`)).toHaveValue('')
    await expect(page.locator('body')).not.toContainText('e2e-placeholder-not-a-real-secret')

    // The one destructive control keeps focus: the confirm takes it, Escape gives it back.
    await provider.getByTestId('sso-remove').focus()
    await page.keyboard.press('Enter')
    await expect(provider.getByTestId('sso-remove-confirm')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(provider.getByTestId('sso-remove')).toBeFocused()

    // Legible in every preset, light and dark — no new colour pair, so verified state is words.
    for (const preset of ['warm', 'focused', 'editorial'] as const) {
      for (const mode of ['light', 'dark'] as const) {
        await page.evaluate(
          ([theme, appearance]) => {
            window.localStorage.setItem(
              'yapm:pref',
              JSON.stringify({ theme, mode: appearance, accent: null }),
            )
          },
          [preset, mode] as const,
        )
        await page.reload()
        await expect(page.locator('html')).toHaveAttribute('data-theme', preset)
        const row = page.locator(`[data-provider-id="${PROVIDER_ID}"]`)
        await expect(row.getByTestId('sso-verified-badge')).toBeVisible({ timeout: 20_000 })
        await expect(row.getByTestId('sso-verification')).toBeVisible()
      }
    }

    // And the removal itself, which unmounts the control that is holding focus. The confirm does
    // not disable itself while the request is in flight — that would blur it to `<body>` before the
    // row could hand focus anywhere — so the heading catches it. jsdom never blurs on disable, so
    // this is the assertion only a real browser can make.
    await provider.getByTestId('sso-remove').focus()
    await page.keyboard.press('Enter')
    await expect(provider.getByTestId('sso-remove-confirm')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(provider).toHaveCount(0, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Single sign-on', level: 1 })).toBeFocused()
  } finally {
    await deleteSsoProvider(db, PROVIDER_ID)
    await db.close()
  }
})

test('a member and a viewer get the admins-only absence, not an error or a form', async ({
  page,
  newContext,
}) => {
  await enterApp(page)

  for (const role of ['member', 'viewer'] as const) {
    const link = await mintInvite(page, { role })
    const account = {
      email: uniqueEmail(`sso-${role}`),
      password: `${role}-password-1234`,
      name: `SSO ${role} ${Date.now().toString(36)}`,
    }

    const context = await newContext()
    const other = await context.newPage()
    await other.goto(link)
    await expect(other.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
    await other.getByRole('button', { name: 'Create one' }).click()
    await other.getByLabel('Name').fill(account.name)
    await other.getByLabel('Email').fill(account.email)
    await other.getByLabel('Password', { exact: true }).fill(account.password)
    await other.getByTestId('login-submit').click()
    await expect(other.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })

    await other.goto('/settings/sso')
    await expect(other.getByTestId('sso-admin-only')).toBeVisible({ timeout: 20_000 })
    await expect(other.getByTestId('sso-register-form')).toHaveCount(0)
    await expect(other.getByRole('alert')).toHaveCount(0)
  }
})
