import { expect, type Page, test } from '@playwright/test'
import { findIssue, openDb, readRetroAiDraft, seedRetroAiDraft } from './db'
import { readReplica } from './replica'
import { ADMIN, ensureAccount } from './support'

// The first two cases need no provider key, which is why they are e2e rather than mocks: the two
// states an operator actually ships with are "no team opted in" and "opted in, nothing configured",
// and both are reachable against the real stack. What the model RECEIVED is covered headless by
// `apps/server/src/ai/retro-draft.pg.test.ts`; what only a browser can prove is the third case — a
// drafted section, driven by the keyboard alone, holding in every preset — so that row is seeded
// straight into Postgres the way `digest.spec.ts` seeds a digest.

const STATUS = '[data-testid="connection-status"]'
const CARD = '[data-testid="retro-card"]'
const PANEL = '[data-testid="retro-ai-panel"]'
const TOGGLE = '[data-testid="retro-ai-draft-toggle"]'
const PRESETS = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const
// Always present in the Delivered section, which is computed from cycles alone — so a cited metric
// key resolves on an instance with no connectors at all.
const METRIC_KEY = 'total'

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

// One real issue on the team, so a proposal can cite an id the client can name from its own synced
// rows — the panel drops any reference it cannot resolve, which is what makes the chip meaningful.
async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  const row = page.locator('[data-testid="issue-row"]').filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
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

// Tab forward until the named control has focus, with no pointer anywhere in the walk. A stranded
// focus (`BODY`) or a walk that never arrives fails loudly rather than silently clicking instead.
async function tabTo(page: Page, testId: string, steps = 14): Promise<void> {
  for (let i = 0; i < steps; i += 1) {
    await page.keyboard.press('Tab')
    const at = await page.evaluate(() => {
      const active = document.activeElement
      if (active === null || active === document.body) return 'BODY'
      return active.getAttribute('data-testid') ?? active.tagName
    })
    expect(at, 'focus was stranded on the body').not.toBe('BODY')
    if (at === testId) return
  }
  throw new Error(`never reached ${testId} with the keyboard`)
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

// The change's signature surface, in a real browser: a drafted section beside the seed panel, walked
// with the keyboard alone from the panel's own control through both kinds of evidence, and rendered
// in every preset light and dark. The row is seeded rather than generated — the tail needs a provider
// key no e2e has — but everything downstream of the row is the shipped code path.
test('a drafted section is keyboard-operable end to end and holds in every theme', async ({
  page,
}) => {
  test.slow()
  await enterApp(page)
  await createTeam(page)

  const issueTitle = unique('Reconnect fix')
  await createIssue(page, issueTitle)

  await completedCycleWithRetro(page)
  const retroId = await openRetro(page)
  const retroUrl = page.url()
  await runToGroup(page)

  const db = openDb()
  try {
    const issue = await findIssue(db, issueTitle)
    await seedRetroAiDraft(db, {
      retroId,
      teamId: issue.teamId,
      proposals: [
        {
          category: 'win',
          summary: 'Work in this cycle reached review sooner than in the last one.',
          refs: [{ kind: 'issue', id: issue.id }],
        },
        {
          category: 'improvement',
          summary: 'Hold scope where it was this cycle rather than growing it mid-flight.',
          refs: [{ kind: 'widget', id: METRIC_KEY }],
        },
      ],
    })
  } finally {
    await db.close()
  }

  await page.goto(retroUrl)
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 30_000 })
  // The line that keeps the section from reading as a conclusion the team reached.
  await expect(page.getByTestId('retro-ai-unratified')).toBeVisible()
  await expect(page.getByTestId('retro-ai-category')).toHaveCount(2)

  // From the seed panel's own control into the section, no pointer at any step: the entity chip
  // opens the issue it cites.
  await page.getByTestId('retro-seed-toggle').focus()
  await tabTo(page, 'retro-ai-evidence-issue')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Issue detail' })).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')

  // Back on the retro with the data panel COLLAPSED, so "reveals the panel and focuses the tile" is
  // a real assertion rather than one the default state already satisfies.
  await page.goto(retroUrl)
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('retro-seed-toggle').focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-seed-widget').first()).toBeHidden()

  await tabTo(page, 'retro-ai-evidence-metric')
  await page.keyboard.press('Enter')
  const tile = page.locator(`[data-metric="${METRIC_KEY}"]`)
  await expect(tile).toBeVisible({ timeout: 20_000 })
  await expect(tile).toBeFocused()

  // Every preset, light and dark — the loop `digest.spec.ts` already runs, on the surface this
  // change adds.
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
      await expect(page.locator(PANEL)).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('retro-ai-evidence-metric')).toBeVisible()
    }
  }
})
