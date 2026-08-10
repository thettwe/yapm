import type { Locator, Page } from '@playwright/test'
import {
  findIssue,
  openDb,
  readRetroActionsForProposal,
  readRetroAiDraft,
  seedRetroAiDraft,
} from './db'
import { expect, test } from './fixtures'
import { readReplica } from './replica'
import { ADMIN, ensureAccount, stop } from './support'

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

// From the workspace root into the team's Issues view. The root links a team to its DETAIL page,
// which renders no view switch — Cycles, Retros and the rest are reachable only from a team
// sub-view, so every later navigation depends on landing here rather than there.
async function openTeam(page: Page, teamKey: string): Promise<void> {
  const link = page.getByRole('link', { name: new RegExp(teamKey) })
  await expect(link).toBeVisible({ timeout: 20_000 })
  await link.click()
  await stop(page, 'Issues').click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

async function createTeam(page: Page): Promise<string> {
  const teamKey = randomKey()
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(unique('Retro AI team'))
  await dialog.getByLabel('Key').fill(teamKey)
  await dialog.getByRole('button', { name: 'Create team' }).click()
  await openTeam(page, teamKey)
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
  // The Cycles link is a stop on the deck. Assert the destinations nav is mounted first, and that
  // it marks exactly one current page, so a caller that arrived from somewhere without the frame
  // fails here, named and in seconds, instead of waiting out the whole test timeout.
  const destinations = page.getByRole('navigation', { name: 'Destinations' })
  await expect(destinations).toBeVisible({ timeout: 20_000 })
  await expect(destinations.locator('[aria-current="page"]')).toHaveCount(1)
  await destinations.getByRole('link', { name: 'Cycles' }).click()
  await expect(destinations.getByRole('link', { name: 'Cycles' })).toHaveAttribute(
    'aria-current',
    'page',
  )
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
  await openTeam(page, teamKey)
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
  //
  // Polled rather than sampled: a row arriving through zero-cache and the client flushing it to
  // IndexedDB are two different moments, and a single read lands between them often enough to make
  // this the suite's one recurring flake. Diagnosed while writing `pm-digest.spec.ts`, whose replica
  // assertions poll for the same reason.
  await expect
    .poll(async () => (await readReplica(page)).rows.some((r) => r.table === 'retro_ai_draft'), {
      timeout: 45_000,
    })
    .toBe(true)
  const replica = await readReplica(page)
  expect(replica.rows.some((r) => r.table === 'retro_ai_proposal')).toBe(false)
  await expect(page.locator(PANEL)).toHaveCount(0)
  await expect(page.getByTestId('retro-ai-pending')).toHaveCount(0)

  // Tab order across the seam where the section would have been is unbroken. The room now stacks
  // the board ABOVE the seed panel and the (absent) draft section below it, so the walk runs from a
  // card forward into the panel's own control rather than the other way round; it is the same seam,
  // in the direction the document now runs. The walk is bounded at the panel deliberately — Tab
  // past the last control in the document legitimately puts `activeElement` on the body, which is
  // indistinguishable from the stranding this exists to catch.
  await page.locator(CARD).first().focus()
  await tabTo(page, 'retro-seed-toggle', 8)

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
  const { url: retroUrl } = await draftedRetro(page)
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
  // a real assertion rather than one the default state already satisfies. From `group` onward the
  // panel is a door by default — the seed-a-card path is brainstorm-only — so the collapse is now
  // asserted rather than performed.
  await page.goto(retroUrl)
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('retro-seed-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByTestId('retro-seed-widget').first()).toBeHidden()

  // THE ANCHOR IS LOAD-BEARING — do not delete it. `tabTo` counts steps from wherever focus already
  // is, and a fresh `goto` leaves it on the body, so without this the walk starts at the document
  // root and spends its budget on the chrome ahead of the panel instead of arriving. Anchoring on
  // the same control the first walk started from is what makes the step budget describe the distance
  // across this seam rather than the length of the document. Raising the budget instead would hide
  // the next regression rather than catch it.
  await page.getByTestId('retro-seed-toggle').focus()

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
      // The ratification controls hold in every preset too. Their token pairs are measured against
      // AA in `packages/ui/src/styles/contrast.test.ts`; this is the half that proves they render.
      await expect(page.getByTestId('retro-ai-agree').first()).toBeVisible()
      await expect(page.getByTestId('retro-ai-disagree').first()).toBeVisible()
    }
  }
})

// The improvement the ratification specs act on: agreed, it is the one proposal that grows the
// action path, and the action it creates carries this text verbatim.
const IMPROVEMENT = 'Hold scope where it was this cycle rather than growing it mid-flight.'

// A drafted section, ready to be ratified: everything the two ratification specs below need, seeded
// once each because the retro has to be a real one driven through the real phase machine.
async function draftedRetro(page: Page): Promise<{ url: string; retroId: string }> {
  await createTeam(page)
  const issueTitle = unique('Ratify fix')
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
          summary: IMPROVEMENT,
          refs: [{ kind: 'widget', id: METRIC_KEY }],
        },
      ],
    })
  } finally {
    await db.close()
  }

  await page.goto(retroUrl)
  await expect(page.locator(PANEL)).toBeVisible({ timeout: 30_000 })
  return { url: retroUrl, retroId }
}

// The half of the ratification surface neither a unit nor an integration test can reach: the real
// controls, in a real browser, driven with nothing but Tab and Enter — including the withdrawal,
// which is the interaction that keeps a mis-click from becoming a permanent opinion.
test('the whole ratification flow is operable with the keyboard alone', async ({ page }) => {
  test.slow()
  await enterApp(page)
  await draftedRetro(page)

  const agree = page.getByTestId('retro-ai-agree').first()
  const disagree = page.getByTestId('retro-ai-disagree').first()
  await expect(agree).toHaveAttribute('aria-pressed', 'false')

  // From the seed panel's own control into the reaction toggles, with no pointer at any step.
  await page.getByTestId('retro-seed-toggle').focus()
  await tabTo(page, 'retro-ai-agree', 20)
  await page.keyboard.press('Enter')
  await expect(agree).toHaveAttribute('aria-pressed', 'true')

  // Pressing the pressed value withdraws it: a different write, not a second opinion.
  await page.keyboard.press('Enter')
  await expect(agree).toHaveAttribute('aria-pressed', 'false')

  // The other value replaces it, and the two are mutually exclusive on screen because there is one
  // row per member per proposal in storage.
  await page.keyboard.press('Enter')
  await expect(agree).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Enter')
  await expect(disagree).toHaveAttribute('aria-pressed', 'true')
  await expect(agree).toHaveAttribute('aria-pressed', 'false')

  // Nothing anywhere on the surface reports another member's reaction, or a running total, while
  // the window is still open.
  await expect(page.getByTestId('retro-ai-verdict')).toHaveCount(0)
  await expect(page.getByTestId('retro-ai-unratified')).toBeVisible()

  // RATIFICATION IS AI-ONLY. The board's own card is on screen and carries no reaction control:
  // human cards keep dot voting as their single ranking signal, and a second differently-shaped one
  // on the same board would be two scoreboards.
  await expect(page.locator(CARD)).toHaveCount(1)
  await expect(page.locator(`${CARD} [data-testid="retro-ai-agree"]`)).toHaveCount(0)
  await expect(page.locator(`${CARD} [data-testid="retro-ai-reactions"]`)).toHaveCount(0)

  // Advance out of `vote` from the keyboard and the verdict is stamped once, server-side.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'vote')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 })
  await expect(page.getByTestId('retro-ai-agree').first()).toBeVisible()
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'discuss')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })

  // The one proposal that was reacted to carries the count the reader actually cast; the one nobody
  // touched reads as unrated, with no count at all — silence is never rendered as consent.
  const rows = page.getByTestId('retro-ai-proposal')
  await expect(rows.first()).toHaveAttribute('data-verdict', 'rejected', { timeout: 30_000 })
  await expect(page.getByTestId('retro-ai-verdict-counts').first()).toHaveText(
    '0 agreed, 1 disagreed',
  )
  await expect(rows.nth(1)).toHaveAttribute('data-verdict', 'unrated')
  await expect(rows.nth(1).getByTestId('retro-ai-verdict-counts')).toHaveCount(0)
  await expect(rows.nth(1).getByTestId('retro-ai-verdict')).toContainText('Nobody responded')

  // The window is shut: the toggles are gone rather than offering a write the server would refuse.
  await expect(page.getByTestId('retro-ai-reactions')).toHaveCount(0)
  await expect(page.getByTestId('retro-ai-unratified')).toHaveCount(0)
})

// Type a command and run the row it lands on, asserting WHICH row that is before pressing Enter.
// "agree with this ai proposal" is a substring of the disagree row's value, so a palette that ranked
// them the other way round would silently record the opposite opinion — the one failure mode where
// running the command and asserting its effect would look like a product bug rather than a ranking
// one.
async function runCommand(
  page: Page,
  palette: Locator,
  query: string,
  expected: string,
): Promise<void> {
  await expect(palette).toBeHidden({ timeout: 20_000 })
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type(query)
  await expect(palette.locator('[cmdk-item=""][data-selected="true"]')).toHaveText(expected)
  await page.keyboard.press('Enter')
}

// The palette half of the ratification surface, and the only path that turns an agreed improvement
// into a real action item from the UI. Both are keyboard-only by construction; neither is exercised
// anywhere else, and the palette's four entries act on a SNAPSHOT of the last-focused proposal —
// which is exactly what makes "react with the toggle, then clear from the palette" the interesting
// sequence: the toggle moves no focus, so the snapshot is stale by the time the palette opens.
test('every ratification command is reachable from the palette, and an agreed improvement becomes a real action', async ({
  page,
}) => {
  test.slow()
  await enterApp(page)
  const { retroId } = await draftedRetro(page)

  const palette = page.getByRole('dialog', { name: 'Retro command palette' })
  const improvement = page.locator('[data-testid="retro-ai-proposal"][data-category="improvement"]')
  const agree = improvement.getByTestId('retro-ai-agree')
  const disagree = improvement.getByTestId('retro-ai-disagree')

  // Reacted with the INLINE TOGGLE, which moves no focus — so the palette is still holding a
  // snapshot that says this member has no reaction. Clearing has to work anyway, or the command is
  // missing for precisely the member who just reacted and wants it back.
  await agree.focus()
  await page.keyboard.press('Enter')
  await expect(agree).toHaveAttribute('aria-pressed', 'true')

  await runCommand(page, palette, 'clear my reaction', 'Clear my reaction')
  await expect(agree).toHaveAttribute('aria-pressed', 'false', { timeout: 20_000 })

  // Both directions are reachable from the palette too, on whichever proposal the keyboard last
  // held.
  await agree.focus()
  await runCommand(
    page,
    palette,
    'disagree with this ai proposal',
    'Disagree with this AI proposal',
  )
  await expect(disagree).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })

  await agree.focus()
  await runCommand(page, palette, 'agree with this ai proposal', 'Agree with this AI proposal')
  await expect(agree).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
  await expect(disagree).toHaveAttribute('aria-pressed', 'false')

  // Out of `vote`, where the verdict is stamped: one agree and no disagree is `agreed`, which is the
  // only state that grows the action path.
  await expect(palette).toBeHidden({ timeout: 20_000 })
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'vote')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 })
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'discuss')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await expect(improvement).toHaveAttribute('data-verdict', 'agreed', { timeout: 30_000 })

  // The panel's own control, reached with Tab alone from the seed panel: the wiring from the
  // proposal row through `createAction` to the action list, which nothing else runs.
  await page.getByTestId('retro-seed-toggle').focus()
  await tabTo(page, 'retro-ai-add-action', 20)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-action')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByTestId('retro-action').first()).toContainText(IMPROVEMENT)

  // …and the same thing from the palette, which is the fourth AI command.
  await runCommand(
    page,
    palette,
    'add this improvement as an action',
    'Add this improvement as an action',
  )
  await expect(page.getByTestId('retro-action')).toHaveCount(2, { timeout: 20_000 })

  // Provenance and the hard line under it, read from Postgres because no surface renders either:
  // both actions record the proposal they came from, and NEITHER has an owner. Nothing on this path
  // offers one, by design — the model has no identity data to invent one from.
  const db = openDb()
  try {
    const { actions } = await readRetroActionsForProposal(db, retroId, IMPROVEMENT)
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(action.body).toBe(IMPROVEMENT)
      expect(action.assigneeId).toBeNull()
    }
  } finally {
    await db.close()
  }
})

// Multi-client convergence, which is the other thing only a browser can settle: the verdict is
// computed by somebody ELSE's phase advance, and it has to reach a client that is sitting still.
//
// Both contexts sign in as the same bootstrap admin, deliberately: a second invited account would
// make this a test of the invite flow, and the claim here is about sync, not about tallying — the
// multi-member hand-count lives in `retro-ratification.pg.test.ts` where the count can be checked
// against real rows.
test('a verdict stamped by another client arrives without a reload', async ({ newContext }) => {
  test.slow()
  const first = await newContext()
  const second = await newContext()

  const reader = await first.newPage()
  const facilitator = await second.newPage()
  await enterApp(reader)
  const { url: retroUrl } = await draftedRetro(reader)

  // The reader records a reaction and then does nothing else for the rest of the test.
  await reader.getByTestId('retro-ai-agree').first().focus()
  await reader.keyboard.press('Enter')
  await expect(reader.getByTestId('retro-ai-agree').first()).toHaveAttribute('aria-pressed', 'true')
  await expect(reader.getByTestId('retro-ai-verdict')).toHaveCount(0)

  // The other client walks the retro out of `vote`, which is the moment the verdict is computed.
  await enterApp(facilitator)
  await facilitator.goto(retroUrl)
  await expect(facilitator.locator(PANEL)).toBeVisible({ timeout: 30_000 })
  await facilitator.keyboard.press(']')
  await expect(phaseStep(facilitator, 'vote')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await facilitator.keyboard.press(']')
  await expect(phaseStep(facilitator, 'discuss')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })

  // NO RELOAD ANYWHERE ON THE READER. The stamp arrives over the sync connection, the reaction
  // toggles stand down because the window is shut, and the count is the one the reader cast.
  await expect(reader.getByTestId('retro-ai-verdict').first()).toBeVisible({ timeout: 30_000 })
  await expect(reader.getByTestId('retro-ai-verdict-counts').first()).toHaveText(
    '1 agreed, 0 disagreed',
  )
  await expect(reader.getByTestId('retro-ai-reactions')).toHaveCount(0)
  await expect(reader.getByTestId('retro-ai-unratified')).toHaveCount(0)
})
