import { expect, type Page, test } from '@playwright/test'
import { openDb, readRetroAiDraft } from './db'
import { readReplica } from './replica'
import { ADMIN, ensureAccount } from './support'

// Neither case needs a provider key, which is why this is an e2e rather than a mock: the two states
// an operator actually ships with are "no team opted in" and "opted in, nothing configured", and both
// are reachable against the real stack. The generated-draft path is covered headless by
// `apps/server/src/ai/retro-draft.pg.test.ts`, which has a mocked provider and can assert what the
// model received — something no browser test can see.

const STATUS = '[data-testid="connection-status"]'
const CARD = '[data-testid="retro-card"]'
const PANEL = '[data-testid="retro-ai-panel"]'
const TOGGLE = '[data-testid="retro-ai-draft-toggle"]'

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

async function createTeam(page: Page): Promise<string> {
  const teamKey = randomKey()
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(unique('Retro AI team'))
  await dialog.getByLabel('Key').fill(teamKey)
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const link = page.getByRole('link', { name: new RegExp(teamKey) })
  await expect(link).toBeVisible({ timeout: 20_000 })
  await link.click()
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
  return teamKey
}

async function createCycle(page: Page, name: string, startOffset: number, endOffset: number) {
  await page.getByTestId('new-cycle').click()
  await page.getByLabel('Cycle name').fill(name)
  await page.getByLabel('Start date').fill(isoDate(startOffset))
  await page.getByLabel('End date').fill(isoDate(endOffset))
  await page.getByRole('button', { name: 'Create cycle' }).click()
  await expect(page.getByRole('button', { name: new RegExp(name) })).toBeVisible({
    timeout: 20_000,
  })
}

// A retro hangs off a completed cycle, and completing one opens its retro through the same mutator
// the scheduler uses.
async function completedCycleWithRetro(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cycles' }).click()
  await expect(page.getByRole('button', { name: 'New cycle' })).toBeVisible({ timeout: 20_000 })
  const first = unique('AI retro sprint')
  const second = unique('AI next sprint')
  await createCycle(page, first, -8, -1)
  await createCycle(page, second, 0, 7)
  await page.getByRole('button', { name: new RegExp(first) }).click()
  await page.getByTestId('complete-cycle').click()
  await page.getByRole('button', { name: new RegExp(first) }).click()
  await expect(page.getByTestId('cycle-retro-link')).toBeVisible({ timeout: 20_000 })
}

async function openRetro(page: Page): Promise<string> {
  await page.getByTestId('cycle-retro-link').click()
  await expect(page.getByRole('navigation', { name: 'Retro phase' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.locator('[data-retro-column]')).toHaveCount(3, { timeout: 20_000 })
  const retroId = /\/retros\/([\w-]+)/.exec(page.url())?.[1]
  if (retroId === undefined) throw new Error(`no retro id in ${page.url()}`)
  return retroId
}

function phaseStep(page: Page, phase: string) {
  return page.locator(`[data-testid="retro-phase-step"][data-phase="${phase}"]`)
}

// Claim the seat, write one card, advance out of brainstorm — the transition that publishes every
// draft as a card and, for an opted-in team, stamps the AI artifact in the same transaction.
async function runToGroup(page: Page): Promise<void> {
  const claim = page.getByTestId('retro-claim-facilitator')
  await claim.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-phase-forward')).toBeVisible({ timeout: 20_000 })

  await page.keyboard.press('c')
  const composer = page.getByTestId('retro-composer')
  await expect(composer).toBeFocused()
  await composer.fill('Reviews started sooner than last cycle')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  await page.keyboard.press(']')
  await expect(phaseStep(page, 'group')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await expect(page.locator(CARD)).toHaveCount(1, { timeout: 20_000 })
}

async function retroAiRows(retroId: string): Promise<{ status: string; proposals: number } | null> {
  const db = openDb()
  try {
    return await readRetroAiDraft(db, retroId)
  } finally {
    await db.close()
  }
}

// Tab forward from wherever focus is and record where it lands. `BODY` means focus was stranded,
// which is the failure this walk exists to catch.
async function tabTrail(page: Page, steps: number): Promise<string[]> {
  const trail: string[] = []
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab')
    trail.push(
      await page.evaluate(() => {
        const active = document.activeElement
        if (active === null || active === document.body) return 'BODY'
        return active.getAttribute('data-testid') ?? active.tagName
      }),
    )
  }
  return trail
}

test('a team that never opted in runs its retro exactly as it does without this capability', async ({
  page,
}) => {
  await enterApp(page)
  await createTeam(page)
  await completedCycleWithRetro(page)
  const retroId = await openRetro(page)

  // Before the advance there is nothing to hide: the artifact is created lazily AT the reveal, so
  // during brainstorm the rows do not exist rather than being filtered away.
  expect(await retroAiRows(retroId)).toBeNull()

  await runToGroup(page)

  // And after it, for a team nobody opted in, they still do not exist — no row, no job, no section.
  expect(await retroAiRows(retroId)).toBeNull()
  await expect(page.locator(PANEL)).toHaveCount(0)

  // The retro is fully operable, as `retro.spec.ts` requires: the seed panel is there, grouping
  // works from the keyboard, and nothing about the absent section interrupts the phase machine.
  await expect(page.getByTestId('retro-seed-panel')).toBeVisible()
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'vote')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 })

  const replica = await readReplica(page)
  expect(replica.rows.some((row) => row.table === 'retro_ai_draft')).toBe(false)
  expect(replica.rows.some((row) => row.table === 'retro_ai_proposal')).toBe(false)
})

test('opted in with nothing configured, the advance succeeds and the section is cleanly absent', async ({
  page,
}) => {
  test.slow()
  await enterApp(page)
  const teamKey = await createTeam(page)

  // Opt in through the real admin surface, so the toggle's write is part of what this proves.
  await page.goto('/settings/ai')
  const row = page.locator(`[data-testid="retro-ai-draft-row"][data-team-key="${teamKey}"]`)
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row.locator(TOGGLE)).toHaveAttribute('data-enabled', 'false')
  await row.locator(TOGGLE).focus()
  await page.keyboard.press('Enter')
  await expect(row.locator(TOGGLE)).toHaveAttribute('data-enabled', 'true', { timeout: 20_000 })

  const failures: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(message.text())
  })
  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message))

  await page.goto('/')
  await page.getByRole('link', { name: new RegExp(teamKey) }).click()
  await completedCycleWithRetro(page)
  const retroId = await openRetro(page)
  await runToGroup(page)

  // The row is stamped `pending` in the publishing transaction and the tail resolves it. With no
  // provider configured the gateway resolves to nothing, which is `ai_off` — an absence, not a
  // failure, and not a `failed`.
  await expect
    .poll(async () => (await retroAiRows(retroId))?.status ?? 'absent', { timeout: 90_000 })
    .toBe('ai_off')
  expect((await retroAiRows(retroId))?.proposals).toBe(0)

  // The client HOLDS the resolved artifact and still renders nothing — the absence is the surface's
  // decision, read from a populated replica rather than from missing data.
  const replica = await readReplica(page)
  expect(replica.rows.some((r) => r.table === 'retro_ai_draft')).toBe(true)
  expect(replica.rows.some((r) => r.table === 'retro_ai_proposal')).toBe(false)
  await expect(page.locator(PANEL)).toHaveCount(0)
  await expect(page.getByTestId('retro-ai-pending')).toHaveCount(0)

  // Tab order from the seed panel through the (absent) section into the board is unbroken.
  await page.getByTestId('retro-seed-toggle').focus()
  const trail = await tabTrail(page, 6)
  expect(trail).not.toContain('BODY')

  // Nothing this change's surfaces said on the console, and nothing crashed. Scoped by name rather
  // than asserted empty, following `notifications.spec.ts`: the retro board carries a pre-existing
  // component-library complaint that is not this change's to fix or to hide.
  const ours = /\b(RetroAiPanel|retroAiDraft|retroAiProposal|retro_ai)\b/
  expect(failures.filter((line) => ours.test(line))).toEqual([])
  expect(crashes).toEqual([])
})
