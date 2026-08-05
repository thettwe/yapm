import { expect, type Locator, type Page, test } from '@playwright/test'
import { findIssue, openDb, seedLinkedPr } from './db'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const DIVERGENCE = 'PR merged but this issue is not marked done'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

function row(page: Page, title: string): Locator {
  return page.locator(ROW).filter({ hasText: title })
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeamIssues(page: Page): Promise<void> {
  const teamName = unique('Team')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()

  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(row(page, title)).toBeVisible({ timeout: 20_000 })
  // The server-authoritative number must settle so the row is persisted in the DB before seeding.
  await expect(row(page, title)).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

test('a linked merged PR lights up the reality strip and divergence flag on row and detail', async ({
  page,
}) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Reality issue')
  await createIssue(page, title)

  const db = openDb()
  try {
    const issue = await findIssue(db, title)
    await seedLinkedPr(db, {
      teamId: issue.teamId,
      issueId: issue.id,
      repo: 'acme/app',
      prNumber: 7,
      prState: 'merged',
      ciConclusion: 'failure',
    })
  } finally {
    await db.close()
  }

  // The rows sync in from zero-cache; the seeded issue's placeholder is replaced by a real strip
  // and, because the PR is merged while the issue is not done, the divergence flag appears.
  const target = row(page, title)
  await expect(target.locator('[data-slot="reality-strip"]')).toBeVisible({ timeout: 30_000 })
  await expect(target.getByLabel(DIVERGENCE)).toBeVisible({ timeout: 30_000 })
  await expect(target.getByLabel('No delivery signal yet')).toHaveCount(0)

  // Detail shows the linked PR (with a link out to GitHub) and the divergence reason.
  await target.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByRole('link', { name: /acme\/app#7/ })).toBeVisible({ timeout: 30_000 })
  await expect(panel.getByText(DIVERGENCE).first()).toBeVisible()
})

test('a deployment carrying the merge commit lights the deploy glyph, and Delivery narrows to what has not shipped', async ({
  page,
}) => {
  await enterApp(page)
  await openTeamIssues(page)

  const shipped = unique('Shipped change')
  const waiting = unique('Waiting change')
  await createIssue(page, shipped)
  await createIssue(page, waiting)

  const db = openDb()
  try {
    const shippedIssue = await findIssue(db, shipped)
    await seedLinkedPr(db, {
      teamId: shippedIssue.teamId,
      issueId: shippedIssue.id,
      repo: 'acme/app',
      prNumber: 11,
      prState: 'merged',
      ciConclusion: 'success',
      mergeCommitSha: 'aaaa1111',
      deployment: { sha: 'aaaa1111' },
    })
    const waitingIssue = await findIssue(db, waiting)
    await seedLinkedPr(db, {
      teamId: waitingIssue.teamId,
      issueId: waitingIssue.id,
      repo: 'acme/app',
      prNumber: 12,
      prState: 'merged',
      ciConclusion: 'success',
      mergeCommitSha: 'bbbb2222',
      // A deployment that carried somebody ELSE's commit is not a deployment of this change.
      deployment: { sha: 'cccc3333' },
    })
  } finally {
    await db.close()
  }

  // The deploy glyph is named in the strip's accessible summary — and only for the change whose
  // merge commit a deployment actually carried.
  const shippedStrip = row(page, shipped).locator('[data-slot="reality-strip"]')
  await expect(shippedStrip).toHaveAttribute('aria-label', /Deployed/, { timeout: 30_000 })
  const waitingStrip = row(page, waiting).locator('[data-slot="reality-strip"]')
  await expect(waitingStrip).toBeVisible({ timeout: 30_000 })
  await expect(waitingStrip).not.toHaveAttribute('aria-label', /Deployed/)

  // Apply Delivery -> "Merged, not deployed" with the keyboard alone; only the unshipped row
  // survives the filter that shipped empty until this change.
  await page.getByRole('button', { name: 'Filter by Delivery' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('menuitem', { name: 'Merged, not deployed' }).press('Enter')
  await page.keyboard.press('Escape')
  await expect(row(page, waiting)).toBeVisible({ timeout: 20_000 })
  await expect(row(page, shipped)).toHaveCount(0)
})

test('the reality strip renders in all three presets, light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Preset reality')
  await createIssue(page, title)

  const db = openDb()
  try {
    const issue = await findIssue(db, title)
    await seedLinkedPr(db, { teamId: issue.teamId, issueId: issue.id, ciConclusion: 'failure' })
  } finally {
    await db.close()
  }

  const target = row(page, title)
  await expect(target.locator('[data-slot="reality-strip"]')).toBeVisible({ timeout: 30_000 })

  for (const preset of ['warm', 'focused', 'editorial'] as const) {
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate(
        ([p, m]) => {
          window.localStorage.setItem(
            'yapm:pref',
            JSON.stringify({ theme: p, mode: m, accent: null }),
          )
        },
        [preset, mode] as const,
      )
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', preset)
      await expect(row(page, title).locator('[data-slot="reality-strip"]')).toBeVisible({
        timeout: 30_000,
      })
    }
  }
})

test('an admin sees the connector settings surface; a viewer cannot', async ({ page, browser }) => {
  await enterApp(page)

  // The GitHub App env is absent in e2e, so the connector is disabled and the surface shows a
  // "not configured" state naming the env vars, with a link to the setup docs.
  await page.goto('/settings/connectors')
  await expect(page.getByRole('heading', { name: 'Connectors' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('not-configured')).toBeVisible()
  await expect(page.getByText('GITHUB_APP_ID')).toBeVisible()
  await expect(page.getByRole('link', { name: /Set up the GitHub connector/ })).toBeVisible()

  // Mint a viewer invite, accept it in a second context, and confirm the surface is denied.
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const viewer = {
    email: uniqueEmail('connector-viewer'),
    password: 'viewer-password-1234',
    name: `Connector Viewer ${Date.now().toString(36)}`,
  }
  const context = await browser.newContext()
  try {
    const vp = await context.newPage()
    await vp.goto(inviteLink)
    await expect(vp.getByRole('heading', { name: /sign in to yapm/i })).toBeVisible()
    await vp.getByRole('button', { name: 'Create one' }).click()
    await vp.getByLabel('Name').fill(viewer.name)
    await vp.getByLabel('Email').fill(viewer.email)
    await vp.getByLabel('Password', { exact: true }).fill(viewer.password)
    await vp.getByTestId('login-submit').click()
    await expect(vp.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })

    await vp.goto('/settings/connectors')
    await expect(vp.getByText(/available to workspace admins only/)).toBeVisible({
      timeout: 20_000,
    })
    await expect(vp.getByTestId('not-configured')).toHaveCount(0)
  } finally {
    await context.close()
  }
})
