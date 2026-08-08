import { expect, type Page } from '@playwright/test'
import { findCycle, findIssue, openDb, seedCycleDigest, seedLinkedPr } from './db'
import { test } from './fixtures'
import { ADMIN, ensureAccount, stop } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const PRESETS = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

function isoDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<void> {
  const teamName = unique('Team')
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(teamName)
  await dialog.getByLabel('Key').fill(randomKey())
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const teamLink = page.getByRole('link', { name: new RegExp(teamName) })
  await expect(teamLink).toBeVisible({ timeout: 20_000 })
  await teamLink.click()
  await stop(page, 'Issues').click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  const row = page.locator(ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

async function openCycles(page: Page): Promise<void> {
  await stop(page, 'Cycles').click()
  await expect(page.getByRole('button', { name: 'New cycle' })).toBeVisible({ timeout: 20_000 })
}

async function createCycle(page: Page, name: string): Promise<void> {
  await page.getByTestId('new-cycle').click()
  await page.getByLabel('Cycle name').fill(name)
  await page.getByLabel('Start date').fill(isoDate(-1))
  await page.getByLabel('End date').fill(isoDate(7))
  await page.getByRole('button', { name: 'Create cycle' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible({
    timeout: 20_000,
  })
}

async function assignIssueToCycle(
  page: Page,
  issueTitle: string,
  cycleName: string,
): Promise<void> {
  await stop(page, 'Issues').click()
  await page.locator(ROW).filter({ hasText: issueTitle }).click()
  await page.getByRole('button', { name: /^Cycle:/ }).click()
  await page.getByRole('menuitem', { name: new RegExp(cycleName) }).click()
  await page.keyboard.press('Escape')
}

test('a completed cycle shows the AI digest with working evidence links; keyboard + all themes', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)

  const issueTitle = unique('Digest work')
  await createIssue(page, issueTitle)

  const cycleName = unique('Digest cycle')
  await openCycles(page)
  await createCycle(page, cycleName)
  await assignIssueToCycle(page, issueTitle, cycleName)

  // Seed the delivery evidence + mark the issue done (done issues stay in the cycle at completion),
  // then complete the cycle, then seed the pre-computed digest referencing the issue + its PR.
  const db = openDb()
  let issueId: string
  let pullRequestId: string
  try {
    const issue = await findIssue(db, issueTitle)
    issueId = issue.id
    const seeded = await seedLinkedPr(db, {
      teamId: issue.teamId,
      issueId: issue.id,
      repo: 'acme/app',
      prNumber: 7,
      prState: 'merged',
      ciConclusion: 'success',
    })
    pullRequestId = seeded.pullRequestId
    await db.db.updateTable('issue').set({ status: 'done' }).where('id', '=', issue.id).execute()
  } finally {
    await db.close()
  }

  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()
  await page.getByTestId('complete-cycle').click()

  const seedDb = openDb()
  try {
    const cycle = await findCycle(seedDb, cycleName)
    await seedCycleDigest(seedDb, {
      teamId: cycle.teamId,
      cycleId: cycle.id,
      status: 'ready',
      provider: 'anthropic',
      model: 'mock-model-1',
      estimatedCostUsd: 0.02,
      content: {
        headline: 'This cycle shipped the reconnect fix.',
        sections: [
          {
            title: 'What shipped',
            items: [
              {
                kind: 'shipped',
                summary: 'The reconnect path was fixed and merged.',
                evidenceRefs: [
                  { kind: 'issue', id: issueId, label: 'DIGEST-1' },
                  { kind: 'pull_request', id: pullRequestId, label: 'acme/app#7' },
                ],
                confidence: 'high',
              },
            ],
          },
        ],
      },
    })
  } finally {
    await seedDb.close()
  }

  await page.reload()
  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()

  const digest = page.getByTestId('cycle-digest')
  await expect(digest).toBeVisible({ timeout: 30_000 })
  await expect(digest.getByTestId('digest-narrative')).toBeVisible()
  await expect(digest.getByText('This cycle shipped the reconnect fix.')).toBeVisible()
  await expect(digest.getByText('The reconnect path was fixed and merged.')).toBeVisible()
  await expect(digest.getByTestId('digest-framing')).toContainText('AI-generated')
  await expect(digest.getByTestId('digest-framing')).toContainText('mock-model-1')

  // The PR evidence links out to the external entity.
  await expect(digest.getByTestId('evidence-external')).toHaveAttribute(
    'href',
    'https://github.com/acme/app/pull/7',
  )

  // The issue evidence link is keyboard-operable and opens the referenced issue.
  const issueLink = digest.getByTestId('evidence-issue')
  await issueLink.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Issue detail' })).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  // Opening the issue navigated the app to the Issues route; return to Cycles so the
  // theme loop's reloads land on the cycle view where the digest lives.
  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()
  await expect(page.getByTestId('cycle-digest')).toBeVisible({ timeout: 30_000 })

  // The digest renders in every preset, light and dark.
  for (const preset of PRESETS) {
    for (const mode of MODES) {
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
      await page.getByRole('button', { name: new RegExp(cycleName) }).click()
      await expect(page.getByTestId('cycle-digest')).toBeVisible({ timeout: 30_000 })
    }
  }
})

test('with AI off, the completed cycle renders the raw-evidence fallback and is never blocked', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)

  const issueTitle = unique('Fallback work')
  await createIssue(page, issueTitle)

  const cycleName = unique('Fallback cycle')
  await openCycles(page)
  await createCycle(page, cycleName)
  await assignIssueToCycle(page, issueTitle, cycleName)

  const db = openDb()
  try {
    const issue = await findIssue(db, issueTitle)
    await seedLinkedPr(db, {
      teamId: issue.teamId,
      issueId: issue.id,
      repo: 'acme/app',
      prNumber: 9,
      prState: 'merged',
      ciConclusion: 'failure',
    })
    await db.db.updateTable('issue').set({ status: 'done' }).where('id', '=', issue.id).execute()
  } finally {
    await db.close()
  }

  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()
  await page.getByTestId('complete-cycle').click()

  // AI is off in e2e (no key), so the pre-compute writes `ai_off`. Seed that status.
  const seedDb = openDb()
  try {
    const cycle = await findCycle(seedDb, cycleName)
    await seedCycleDigest(seedDb, { teamId: cycle.teamId, cycleId: cycle.id, status: 'ai_off' })
  } finally {
    await seedDb.close()
  }

  await page.reload()
  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()

  const digest = page.getByTestId('cycle-digest')
  await expect(digest).toBeVisible({ timeout: 30_000 })
  await expect(digest.getByTestId('digest-fallback')).toBeVisible()
  await expect(digest.getByTestId('digest-narrative')).toHaveCount(0)
  // The raw evidence stands alone: the shipped issue and its linked PR are listed.
  await expect(digest.getByTestId('fallback-issue').filter({ hasText: issueTitle })).toBeVisible()
  await expect(digest.getByText('acme/app#9')).toBeVisible()

  // Opening the issue from the fallback is never blocked.
  await digest.getByTestId('fallback-issue').filter({ hasText: issueTitle }).click()
  await expect(page.getByRole('dialog', { name: 'Issue detail' })).toBeVisible({ timeout: 20_000 })
})
