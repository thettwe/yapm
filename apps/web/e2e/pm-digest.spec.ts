import { expect, type Locator, type Page, test } from '@playwright/test'
import type { StoredPmDigestContent } from '@yapm/schema'
import {
  countPolicyAudit,
  findCycle,
  findPmDigest,
  findUserId,
  openDb,
  readDisclosureAudit,
  seedPmDigest,
} from './db'
import { readReplica } from './replica'
import { ADMIN, ensureAccount, signIn, uniqueEmail } from './support'

// THE DISCLOSURE BOUNDARY IN A REAL BROWSER, and the two properties here are properties of the
// ASSEMBLED stack rather than of any one module, which is why they are e2e at all:
//
//   1. WITH THE DEFAULT CONFIG THE SURFACE DOES NOT EXIST. Not "renders empty" — the route draws
//      nothing, the shell offers no way in, and for a reader outside the producing team the client's
//      own replica never receives the row. A unit test can assert a component returned null; only
//      this can assert that a running client holding a live sync connection never got the data.
//   2. NOTHING REACHES A READER UNTIL A HUMAN RELEASES IT. Generation, policy and publication are
//      three different subsystems (a job, an admin HTTP surface, a Zero mutator with a server
//      override), and the gate is only real if it holds across all three at once.
//
// The row itself is seeded rather than generated: the model call needs a provider key no e2e has,
// and what it produces is covered headless by `apps/server/src/ai/pm-digest.test.ts`. Everything
// downstream of the row — the second authorization axis, the publish gate, both surfaces and the
// disclosure record — is the shipped code path, exercised here end to end.

const STATUS = '[data-testid="connection-status"]'
const PRESETS = ['warm', 'focused', 'editorial'] as const
const MODES = ['light', 'dark'] as const

// Distinctive enough that finding it anywhere it should not be is unambiguous.
const HEADLINE = 'Checkout completes in one step now'
const SUMMARY = 'Customers reach payment without a second confirmation.'
const EVIDENCE_LABEL = 'ENG-142 · PR #331'

function pmContent(evidenceId: string, cycleName: string, teamName: string) {
  return {
    headline: HEADLINE,
    sections: [
      {
        title: 'Shipped',
        items: [
          {
            kind: 'shipped',
            summary: SUMMARY,
            evidenceRefs: [{ kind: 'issue', id: evidenceId, label: 'ENG-142' }],
            confidence: 'high',
          },
        ],
      },
    ],
    // Baked by yapm at generation time, because the reader can read neither the team row nor the
    // cycle row these names live in.
    subject: {
      teamName,
      cycleName,
      startDate: Date.UTC(2026, 6, 1),
      endDate: Date.UTC(2026, 6, 14),
    },
    evidenceLabels: { [evidenceId]: EVIDENCE_LABEL },
  } satisfies StoredPmDigestContent
}

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

async function createTeam(page: Page): Promise<{ name: string; key: string }> {
  const name = unique('Product team')
  const key = randomKey()
  await page.getByTestId('create-team').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill(name)
  await dialog.getByLabel('Key').fill(key)
  await dialog.getByRole('button', { name: 'Create team' }).click()
  const link = page.getByRole('link', { name: new RegExp(name) })
  await expect(link).toBeVisible({ timeout: 20_000 })
  await link.click()
  await page.getByRole('link', { name: 'Issues' }).click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
  return { name, key }
}

async function openCycles(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cycles' }).click()
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

async function openCyclePanel(page: Page, teamName: string, cycleName: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: new RegExp(teamName) }).click()
  await page.getByRole('link', { name: 'Issues' }).click()
  await openCycles(page)
  await page.getByRole('button', { name: new RegExp(cycleName) }).click()
}

// Focus and Enter, never a click: every control this change adds is a permission action, and a
// permission action nobody can reach without a pointer is not keyboard-first.
//
// Takes a LOCATOR rather than a test id, because half of these controls are repeated once per team
// and the caller is the only one who knows which team it means. A helper that resolved a test id
// itself would either explode on strict mode or, worse, quietly settle for `.first()` — a control
// in some other team's row, in the fixture workspace every spec shares.
async function press(control: Locator, key = 'Enter'): Promise<void> {
  await expect(control).toBeVisible({ timeout: 20_000 })
  await control.focus()
  await expect(control).toBeFocused()
  await control.page().keyboard.press(key)
}

// The theme cache rather than the appearance popover, on `auto-status.spec.ts`'s precedent: the
// popover writes a synced `user_preference` row that zero-cache then pushes back over the cache in
// every later spec.
async function setPreset(page: Page, preset: string, mode: 'light' | 'dark'): Promise<void> {
  await page.evaluate(
    ([p, m]) => {
      window.localStorage.setItem('yapm:pref', JSON.stringify({ theme: p, mode: m, accent: null }))
    },
    [preset, mode] as const,
  )
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', preset)
}

// What a preset actually painted. A token that failed to resolve paints nothing — transparent text
// on an unset surface — and collecting the values across presets is what makes a hardcoded literal
// FAIL rather than merely render: a literal is the same string in all six dressings.
async function painted(target: Locator): Promise<string> {
  const values = await target.evaluate((node) => {
    const style = window.getComputedStyle(node)
    return {
      color: style.color,
      surface: window.getComputedStyle(document.body).backgroundColor,
      border: style.borderTopColor,
      font: style.fontFamily,
    }
  })
  expect(values.color).not.toBe('rgba(0, 0, 0, 0)')
  expect(values.surface).not.toBe('rgba(0, 0, 0, 0)')
  expect(values.font).not.toBe('')
  return `${values.surface}|${values.color}|${values.border}`
}

// The DISTINCT `pm_digest` ids the client has actually persisted, with the two corrections a first
// CI run taught this spec:
//
//   1. Wait for the replica to hold something. "No `pm_digest` row is here" is worth nothing against
//      an IndexedDB Zero has not written to yet, and a client that has only soft-navigated since
//      sign-in has not written to one. The poll fails loudly on timeout rather than reporting an
//      emptiness that was never a fact.
//   2. Deduplicate by id. Zero persists its replica as B-tree chunks and the SAME row is lifted out
//      of more than one of them, so counting entries counts chunk copies, not entities.
async function pmDigestIdsInReplica(page: Page): Promise<string[]> {
  const replica = await readReplica(page)
  const ids = new Set<string>()
  for (const row of replica.rows) {
    if (row.table !== 'pm_digest') continue
    const id = (JSON.parse(row.json) as { id?: unknown }).id
    if (typeof id === 'string') ids.add(id)
  }
  return [...ids].sort()
}

// Polled, not sampled: a row arriving through zero-cache and a row being flushed to IndexedDB are
// two different moments, so a single read can be early. The emptiness cases settle on the first
// poll, which is what they should do.
async function expectPmDigestIds(page: Page, expected: readonly string[]): Promise<void> {
  await expect
    .poll(async () => (await readReplica(page)).rows.length, {
      timeout: 45_000,
      message: 'the client never persisted a replica row, so an emptiness claim proves nothing',
    })
    .toBeGreaterThan(0)
  await expect
    .poll(async () => await pmDigestIdsInReplica(page), { timeout: 45_000 })
    .toEqual([...expected])
}

test('with the default policy the PM reader surface does not exist, and only the team can read the row', async ({
  page,
}) => {
  test.slow()
  const crashes: string[] = []
  page.on('pageerror', (error) => crashes.push(error.message))

  await enterApp(page)
  const team = await createTeam(page)
  const cycleName = unique('Default cycle')
  await openCycles(page)
  await createCycle(page, cycleName)

  const db = openDb()
  let digestId: string
  try {
    const cycle = await findCycle(db, cycleName)
    digestId = await seedPmDigest(db, {
      teamId: cycle.teamId,
      cycleId: cycle.id,
      content: pmContent('evidence-1', cycleName, team.name),
    })
  } finally {
    await db.close()
  }

  // No way in from the shell — the entry reads the same audience the route gates on.
  await page.goto('/')
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
  await expect(page.getByTestId('pm-digests-entry')).toHaveCount(0)

  // And the route itself draws nothing. Not an empty state, which would announce that something
  // exists and is being withheld: the surface is absent.
  await page.goto('/digests')
  await expect(page.getByTestId('pm-digest-card')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Product digests' })).toHaveCount(0)
  await expect(page.getByTestId('pm-digests-empty')).toHaveCount(0)

  // The row is really there, and really readable — through the OTHER axis, by the team that
  // produced it. Without this the absence above would be satisfied by a missing row.
  //
  // NOTE WHOSE CLIENT THIS IS. This caller reaches the row legitimately: they are on the producing
  // team (by the workspace-admin bypass `teamScoped` has and `pmAudienceScoped` deliberately does
  // not), so their replica holds it through the team axis. "The row never reaches the client" is a
  // claim about a reader OUTSIDE the team, and the second test makes it there, for a viewer with no
  // membership at all — asserting it here would have asserted it of the wrong principal.
  await openCyclePanel(page, team.name, cycleName)
  const share = page.getByTestId('pm-digest-share')
  await expect(share).toBeVisible({ timeout: 30_000 })
  await expect(share).toHaveAttribute('data-published', 'false')
  await expect(share.getByTestId('pm-digest-headline')).toHaveText(HEADLINE)
  await expect(share.getByTestId('pm-digest-evidence')).toHaveText(EVIDENCE_LABEL)
  await expectPmDigestIds(page, [digestId])

  // Still unpublished in Postgres: reviewing is not releasing.
  const check = openDb()
  try {
    expect((await findPmDigest(check, digestId)).publishedAt).toBeNull()
  } finally {
    await check.close()
  }

  // The producing team's card holds in every preset, light and dark.
  const dressings = new Set<string>()
  for (const preset of PRESETS) {
    for (const mode of MODES) {
      await setPreset(page, preset, mode)
      await page.getByRole('button', { name: new RegExp(cycleName) }).click()
      await expect(page.getByTestId('pm-digest-share')).toBeVisible({ timeout: 30_000 })
      dressings.add(await painted(page.getByTestId('pm-digest-share')))
    }
  }
  // Six distinct dressings: three presets times light and dark. A hardcoded color anywhere on the
  // card would collapse them, and this is where that shows up.
  expect(dressings.size).toBe(6)

  expect(crashes).toEqual([])
})

test('a named reader reads only what a human released, keyboard-only, and loses it on retraction', async ({
  page,
  browser,
}) => {
  test.slow()
  await enterApp(page)
  const team = await createTeam(page)
  const cycleName = unique('Shared cycle')
  await openCycles(page)
  await createCycle(page, cycleName)

  const db = openDb()
  let digestId: string
  try {
    const cycle = await findCycle(db, cycleName)
    digestId = await seedPmDigest(db, {
      teamId: cycle.teamId,
      cycleId: cycle.id,
      content: pmContent('evidence-2', cycleName, team.name),
    })
  } finally {
    await db.close()
  }

  // The reader is a workspace VIEWER with no membership of the producing team — the weakest
  // principal in the product, and the one the audience list has to carry entirely on its own.
  await page.goto('/')
  await page.getByTestId('create-invite').click()
  const invite = page.getByRole('dialog')
  await invite.getByLabel('Role', { exact: true }).selectOption('viewer')
  await invite.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const reader = {
    email: uniqueEmail('product-manager'),
    password: 'reader-password-1234',
    name: 'Product Manager',
  }

  const readerContext = await browser.newContext()
  try {
    const readerPage = await readerContext.newPage()
    await readerPage.goto(inviteLink)
    await readerPage.getByRole('button', { name: 'Create one' }).click()
    await readerPage.getByLabel('Name').fill(reader.name)
    await readerPage.getByLabel('Email').fill(reader.email)
    await readerPage.getByLabel('Password', { exact: true }).fill(reader.password)
    await readerPage.getByTestId('login-submit').click()
    await expect(readerPage.locator('[data-testid="workspace-name"]')).toBeVisible({
      timeout: 20_000,
    })
    await expect(readerPage.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    // The producing team is visible to them as a team they could join, which is the workspace-wide
    // read every member has — and it is what makes the replica assertion below meaningful: this
    // client holds rows, just none of this team's work.
    await expect(readerPage.getByRole('listitem').filter({ hasText: team.name })).toBeVisible({
      timeout: 20_000,
    })

    // One reload before the replica is read: a client that has only ever soft-navigated may not
    // have flushed anything to IndexedDB yet, and the guard above would then fail on a client that
    // is behaving perfectly.
    await readerPage.reload()
    await expect(readerPage.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    // Before the policy names them: no entry, no surface, nothing in the replica.
    await expect(readerPage.getByTestId('pm-digests-entry')).toHaveCount(0)
    await expectPmDigestIds(readerPage, [])

    const readerId = await (async () => {
      const lookup = openDb()
      try {
        return await findUserId(lookup, reader.email)
      } finally {
        await lookup.close()
      }
    })()

    const policyBefore = await (async () => {
      const lookup = openDb()
      try {
        return await countPolicyAudit(lookup)
      } finally {
        await lookup.close()
      }
    })()

    // THE ADMIN NAMES THEM, through the shipped surface and from the keyboard alone. Four switches,
    // every one of them off until this moment.
    await page.goto('/settings/ai')
    // Settle on the loaded page before reading whether the block is there: an absent block and a
    // page that has not finished loading look identical, and only one of them means "configure AI".
    await expect(page.getByTestId('ai-toggle')).toBeVisible({ timeout: 20_000 })
    const block = page.getByTestId('pm-disclosure-settings')
    if ((await block.count()) === 0) {
      // The policy lives in the AI config blob, which does not exist until AI is configured at all.
      await page.getByTestId('ai-toggle').click()
    }
    await expect(block).toBeVisible({ timeout: 20_000 })

    if ((await block.getAttribute('data-enabled')) !== 'true') {
      await press(page.getByTestId('pm-disclosure-enabled'))
    }
    await expect(block).toHaveAttribute('data-enabled', 'true', { timeout: 20_000 })
    await expect(block).toHaveAttribute('data-killed', 'false')

    const teamRow = page.locator(
      `[data-testid="pm-disclosure-team-row"][data-team-key="${team.key}"]`,
    )
    await expect(teamRow).toBeVisible({ timeout: 20_000 })
    await expect(teamRow).toHaveAttribute('data-visible', 'false')
    await press(teamRow.getByTestId('pm-disclosure-team-toggle'))
    await expect(teamRow).toHaveAttribute('data-visible', 'true', { timeout: 20_000 })

    const readersToggle = teamRow.getByTestId('pm-disclosure-readers-toggle')
    await press(readersToggle)
    // A tokenized toggle rather than a native checkbox — the user agent paints a checkbox from its
    // own color scheme, which made it the one control in the product that stayed light in every dark
    // preset. `aria-pressed` carries the state.
    const readerBox = teamRow.locator(
      `[data-testid="pm-disclosure-reader"][data-user-id="${readerId}"]`,
    )
    await press(readerBox)
    await expect(readerBox).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })

    // Every policy write left a record.
    const policyAfter = await (async () => {
      const lookup = openDb()
      try {
        return await countPolicyAudit(lookup)
      } finally {
        await lookup.close()
      }
    })()
    expect(policyAfter).toBeGreaterThan(policyBefore)

    // THE GATE. Named, entitled, switched on — and STILL NO SURFACE, because no human has released
    // anything. Being named is not being told something: an empty state here would announce that a
    // channel exists and that the team on the other side has chosen not to use it.
    await readerPage.goto('/')
    await readerPage.reload()
    await expect(readerPage.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })
    await expect(readerPage.getByTestId('pm-digests-entry')).toHaveCount(0)
    await expectPmDigestIds(readerPage, [])

    await readerPage.goto('/digests')
    await expect(readerPage.getByRole('heading', { name: 'Product digests' })).toHaveCount(0)
    await expect(readerPage.getByTestId('pm-digests-empty')).toHaveCount(0)
    await expect(readerPage.getByTestId('pm-digest-card')).toHaveCount(0)

    // A HUMAN ON THE PRODUCING TEAM RELEASES IT, from the keyboard.
    await openCyclePanel(page, team.name, cycleName)
    await expect(page.getByTestId('pm-digest-share')).toBeVisible({ timeout: 30_000 })
    await press(page.getByTestId('pm-digest-publish'))

    // What the producing team is told afterwards: a count, snapshotted at release, and never a name.
    // The count is stamped by the server override, so seeing it here proves that ran.
    const readers = page.getByTestId('pm-digest-share-readers')
    await expect(readers).toContainText('Shared with 1 reader outside this team', {
      timeout: 30_000,
    })
    await expect(readers).toContainText('not a running count')
    await expect(page.getByTestId('pm-digest-share')).toHaveAttribute('data-published', 'true')
    await expect(page.getByTestId('pm-digest-share')).not.toContainText(reader.name)

    const published = await (async () => {
      const lookup = openDb()
      try {
        return {
          row: await findPmDigest(lookup, digestId),
          audit: await readDisclosureAudit(lookup, digestId),
        }
      } finally {
        await lookup.close()
      }
    })()
    expect(published.row.publishedAt).not.toBeNull()
    expect(published.row.audienceSize).toBe(1)
    expect(published.row.publishedBy).not.toBeNull()
    expect(published.audit.map((entry) => entry.event)).toContain('published')

    // AND NOW, AND ONLY NOW, THE READER READS IT — and only now does the shell offer a way in.
    await readerPage.goto('/')
    await readerPage.reload()
    await expect(readerPage.getByTestId('pm-digests-entry')).toBeVisible({ timeout: 30_000 })
    await press(readerPage.getByTestId('pm-digests-entry'))
    await expect(readerPage).toHaveURL(/\/digests$/u)
    await expect(readerPage.getByRole('heading', { name: 'Product digests' })).toBeVisible({
      timeout: 30_000,
    })
    const card = readerPage.getByTestId('pm-digest-card')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card.getByTestId('pm-digest-headline')).toHaveText(HEADLINE)
    await expect(card.getByTestId('pm-digest-item')).toContainText(SUMMARY)
    // Evidence is a baked plain-text label. The reader can open none of these targets, so there is
    // no link to open — asserted structurally rather than by reading the copy.
    await expect(card.getByTestId('pm-digest-evidence')).toHaveText(EVIDENCE_LABEL)
    expect(await card.locator('a, img, iframe').count()).toBe(0)
    await expect(card.getByTestId('pm-digest-framing')).toContainText('AI-generated')
    await expect(card.getByTestId('pm-digest-framing')).toContainText('mock-model-1')
    // The subject line is the only way this reader learns whose cycle it was.
    await expect(card).toContainText(team.name)
    await expect(card).toContainText(cycleName)

    // The reader holds the disclosed row and NOTHING ELSE of that team's: the audience axis carries
    // one table, and widening `teamScoped` would have shown up here as issues and cycles arriving.
    await expectPmDigestIds(readerPage, [digestId])
    const replica = await readReplica(readerPage)
    // The disclosure record replicates to nobody. `pm_digest` reached this client through
    // zero-cache, which is what makes this the running-stack half of the omission assertion the
    // drift test makes statically: one new table is in the Zero schema and arrived, the other is in
    // Postgres only and cannot be named by any query, so no client holds a row of it.
    expect(replica.rows.filter((row) => row.table === 'ai_disclosure_audit')).toEqual([])
    expect(replica.raw).not.toContain('ai_disclosure_audit')
    for (const table of ['issue', 'cycle', 'cycle_digest', 'label', 'saved_view', 'retro']) {
      expect(
        replica.rows.filter((row) => row.table === table && row.json.includes(cycleName)),
        `${table} rows for the producing team reached a reader outside it`,
      ).toEqual([])
    }

    // THE OTHER TWO SURFACES THIS CHANGE ADDS, in every preset, light and dark. The producing
    // team's card is swept by the first test; these two are only reachable here — the reader's view
    // needs a published row and a named principal, and the admin block needs the policy configured.
    const readerDressings = new Set<string>()
    for (const preset of PRESETS) {
      for (const mode of MODES) {
        await setPreset(readerPage, preset, mode)
        await expect(readerPage.getByTestId('pm-digest-card')).toBeVisible({ timeout: 30_000 })
        await expect(readerPage.getByTestId('pm-digest-evidence')).toHaveText(EVIDENCE_LABEL)
        readerDressings.add(await painted(readerPage.getByTestId('pm-digest-card')))
      }
    }
    expect(readerDressings.size).toBe(6)

    await page.goto('/settings/ai')
    const policyDressings = new Set<string>()
    for (const preset of PRESETS) {
      for (const mode of MODES) {
        await setPreset(page, preset, mode)
        const settings = page.getByTestId('pm-disclosure-settings')
        await expect(settings).toBeVisible({ timeout: 30_000 })
        // Scoped to THIS team's row, never document-wide: the two per-team controls exist once per
        // team in the workspace, so an unscoped locator is a strict-mode violation, and `.first()`
        // would sample another team's row — whose readers fieldset is still collapsed, and whose
        // paint therefore says nothing about the control this sweep exists to check.
        await expect(teamRow).toBeVisible({ timeout: 20_000 })
        for (const control of [
          settings.getByTestId('pm-disclosure-enabled'),
          settings.getByTestId('pm-disclosure-killed'),
          teamRow.getByTestId('pm-disclosure-team-toggle'),
          teamRow.getByTestId('pm-disclosure-readers-toggle'),
        ]) {
          await expect(control).toBeVisible({ timeout: 20_000 })
        }
        // The audience picker included: it is the control that was painted by the user agent rather
        // than by the theme, so a sweep that skipped it would have missed exactly that. The reload
        // `setPreset` does resets the row's open state, so the fieldset needs reopening every pass.
        await press(readersToggle)
        await expect(readerBox).toBeVisible({ timeout: 20_000 })
        policyDressings.add(await painted(readerBox))
      }
    }
    expect(policyDressings.size).toBe(6)

    // RETRACTION STOPS FURTHER READS.
    await openCyclePanel(page, team.name, cycleName)
    await expect(page.getByTestId('pm-digest-share')).toBeVisible({ timeout: 30_000 })
    await press(page.getByTestId('pm-digest-retract'))
    await expect(page.getByTestId('pm-digest-share')).toHaveAttribute('data-published', 'false', {
      timeout: 30_000,
    })

    const retracted = await (async () => {
      const lookup = openDb()
      try {
        return await readDisclosureAudit(lookup, digestId)
      } finally {
        await lookup.close()
      }
    })()
    expect(retracted.map((entry) => entry.event)).toContain('unpublished')

    // Proven on a FRESH client rather than on the one that already holds the row: what matters is
    // that a reader arriving after the retraction gets nothing, not that a warm replica dropped it.
    const afterContext = await browser.newContext()
    try {
      const afterPage = await afterContext.newPage()
      await signIn(afterPage, reader)
      await expect(afterPage.locator('[data-testid="workspace-name"]')).toBeVisible({
        timeout: 20_000,
      })
      await expect(afterPage.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
        timeout: 30_000,
      })
      // No way in, and no surface behind it: a retracted digest returns this reader to the state
      // they were in before anything was ever released.
      await expect(afterPage.getByTestId('pm-digests-entry')).toHaveCount(0)
      await expectPmDigestIds(afterPage, [])
      await afterPage.goto('/digests')
      await expect(afterPage.getByRole('heading', { name: 'Product digests' })).toHaveCount(0)
      await expect(afterPage.getByTestId('pm-digests-empty')).toHaveCount(0)
      await expect(afterPage.getByTestId('pm-digest-card')).toHaveCount(0)
    } finally {
      await afterContext.close()
    }
  } finally {
    await readerContext.close()
  }
})
