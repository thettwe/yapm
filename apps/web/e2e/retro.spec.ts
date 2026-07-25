import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const DRAFT = '[data-testid="retro-draft"]'
const CARD = '[data-testid="retro-card"]'
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

async function openTeam(page: Page): Promise<string> {
  const teamName = unique('Retro team')
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
  return teamName
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

// A retro hangs off a completed cycle, so every scenario needs one: two cycles, then complete
// the first — which also opens its retrospective through the same mutator the scheduler uses.
async function completedCycleWithRetro(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Cycles' }).click()
  await expect(page.getByRole('button', { name: 'New cycle' })).toBeVisible({ timeout: 20_000 })
  const first = unique('Retro sprint')
  const second = unique('Next sprint')
  await createCycle(page, first, -8, -1)
  await createCycle(page, second, 0, 7)
  await page.getByRole('button', { name: new RegExp(first) }).click()
  await page.getByTestId('complete-cycle').click()
  await page.getByRole('button', { name: new RegExp(first) }).click()
  await expect(page.getByTestId('cycle-retro-link')).toBeVisible({ timeout: 20_000 })
}

async function openRetro(page: Page): Promise<void> {
  await page.getByTestId('cycle-retro-link').click()
  await expect(page.getByRole('navigation', { name: 'Retro phase' })).toBeVisible({
    timeout: 20_000,
  })
  // The retro row syncs a tick before its columns; wait for the board itself, not just the shell.
  await expect(page.locator('[data-retro-column]')).toHaveCount(3, { timeout: 20_000 })
}

function phaseStep(page: Page, phase: string) {
  return page.locator(`[data-testid="retro-phase-step"][data-phase="${phase}"]`)
}

async function syncedUserId(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const response = await fetch('/api/zero/token', { credentials: 'include' })
    const data = (await response.json()) as { userID: string }
    return data.userID
  })
}

interface ReplicaRow {
  table: string
  json: string
}

interface Replica {
  /** Everything persisted, verbatim — for "this string is nowhere in the replica". */
  raw: string
  /** The same bytes decomposed into synced rows, each tagged with the table it belongs to. */
  rows: ReplicaRow[]
}

// The client's ACTUAL replica, read out of IndexedDB rather than inferred from the DOM: the spec's
// wording is "any client replica is inspected", and a DOM assertion cannot tell "not rendered" from
// "not received". Zero persists its whole replica as a handful of B-tree chunks, so a per-record
// check would be meaningless (everything co-occurs inside one chunk) — the walk therefore descends
// into the chunks and lifts out each `e/<table>/<id>` entry as its own row, which is the granularity
// the guarantee is about.
async function readReplica(page: Page): Promise<Replica> {
  return await page.evaluate(async () => {
    const chunks: string[] = []
    const rows: { table: string; json: string }[] = []

    const visit = (node: unknown): void => {
      if (Array.isArray(node)) {
        const [key, value] = node
        if (
          typeof key === 'string' &&
          key.startsWith('e/') &&
          typeof value === 'object' &&
          value !== null &&
          !Array.isArray(value)
        ) {
          rows.push({ table: key.slice(2).split('/')[0] ?? '', json: JSON.stringify(value) })
          return
        }
        for (const child of node) visit(child)
        return
      }
      if (typeof node === 'object' && node !== null) {
        for (const child of Object.values(node)) visit(child)
      }
    }

    for (const info of await indexedDB.databases()) {
      const name = info.name
      if (name === undefined) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const stores = [...db.objectStoreNames]
      if (stores.length > 0) {
        const transaction = db.transaction(stores, 'readonly')
        for (const store of stores) {
          const values = await new Promise<unknown[]>((resolve, reject) => {
            const request = transaction.objectStore(store).getAll()
            request.onsuccess = () => resolve(request.result as unknown[])
            request.onerror = () => reject(request.error)
          })
          for (const value of values) {
            chunks.push(JSON.stringify(value))
            visit(value)
          }
        }
      }
      db.close()
    }
    for (const key of Object.keys(window.localStorage)) {
      chunks.push(`${key}:${window.localStorage.getItem(key) ?? ''}`)
    }
    return { raw: chunks.join('\n'), rows }
  })
}

async function replicaHolds(page: Page, needle: string): Promise<boolean> {
  const { raw } = await readReplica(page)
  return raw.includes(needle)
}

test('a whole retro runs end to end from the keyboard', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)

  // Nobody facilitates an auto-opened retro until someone claims the seat.
  const claim = page.getByTestId('retro-claim-facilitator')
  await claim.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-phase-forward')).toBeVisible({ timeout: 20_000 })

  // `c` opens the composer; Enter submits and KEEPS it open for the next card.
  await page.keyboard.press('c')
  const composer = page.getByTestId('retro-composer')
  await expect(composer).toBeFocused()
  await composer.fill('Pairing shortened the review loop')
  await page.keyboard.press('Enter')
  await composer.fill('Review wait was long')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator(DRAFT)).toHaveCount(2, { timeout: 20_000 })

  // Nothing is in `retro_card` yet: during brainstorm there is nothing to hide, because a draft
  // syncs to its author alone.
  await expect(page.locator(CARD)).toHaveCount(0)

  // `]` advances a phase, and advancing out of brainstorm publishes every draft as a card.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'group')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await expect(page.locator(CARD)).toHaveCount(2, { timeout: 20_000 })

  // Group the two cards from the keyboard alone: focus a card, `g`, pick the other.
  await page.locator(CARD).first().focus()
  await page.keyboard.press('g')
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('Review wait was long')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-group')).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 })

  // `]` into vote, then `v` spends a dot on the focused cluster and `Shift+V` takes it back.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'vote')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 })
  await expect(page.getByTestId('retro-vote-budget')).toHaveText('3/3 dots left')
  await page.getByTestId('retro-group').focus()
  await page.keyboard.press('v')
  await expect(page.getByTestId('retro-vote-budget')).toHaveText('2/3 dots left', {
    timeout: 20_000,
  })
  await page.getByTestId('retro-group').focus()
  await page.keyboard.press('V')
  await expect(page.getByTestId('retro-vote-budget')).toHaveText('3/3 dots left', {
    timeout: 20_000,
  })

  // `]` into discuss, `a` captures an action, and ⌘/Ctrl+Enter turns it into a real issue.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'discuss')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await page.keyboard.press('a')
  const actionComposer = page.getByTestId('retro-action-composer')
  await expect(actionComposer).toBeFocused()
  await actionComposer.fill('Rotate a review buddy each cycle')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('retro-action')).toHaveCount(1, { timeout: 20_000 })

  await page.getByTestId('retro-convert-action').focus()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByTestId('retro-action-issue')).toBeVisible({ timeout: 20_000 })

  // `]` twice more closes the retro; `[` steps back exactly one phase.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'actions')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'closed')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await page.keyboard.press('[')
  await expect(phaseStep(page, 'actions')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
})

test('the data panel is useful with no connectors and seeds an evidence-anchored card', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)

  // The differentiator, on an instance with no connector configured at all: Delivered is computed
  // from cycles alone, and Flow says exactly what would light it up instead of drawing zeros.
  const panel = page.getByTestId('retro-seed-panel')
  await expect(panel).toBeVisible({ timeout: 20_000 })
  const delivered = page.locator('[data-testid="retro-seed-section"][data-section="delivered"]')
  await expect(delivered.getByTestId('retro-seed-widget')).toHaveCount(7, { timeout: 20_000 })
  await expect(delivered.locator('[data-metric="carried_twice_plus"]')).toBeVisible()
  const flow = page.locator('[data-testid="retro-seed-section"][data-section="flow"]')
  await expect(flow.getByTestId('retro-seed-empty')).toContainText('Connect GitHub')
  await expect(flow.getByTestId('retro-seed-widget')).toHaveCount(0)

  // "Add a card from this widget", from the keyboard: the composer opens carrying the figure.
  const seedButton = delivered.locator('[data-metric="shipped"]').getByTestId('retro-seed-add-card')
  await seedButton.focus()
  await expect(seedButton).toBeFocused()
  await page.keyboard.press('Enter')
  const composer = page.getByTestId('retro-composer')
  await expect(composer).toBeFocused({ timeout: 20_000 })
  await expect(page.getByTestId('retro-composer-seeded')).toContainText('From Shipped')
  await composer.fill('Only a handful shipped — what got in the way?')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // The card carries the evidence link back to the number that prompted it.
  const chip = page.locator(DRAFT).getByTestId('retro-evidence-chip')
  await expect(chip).toHaveText('Shipped', { timeout: 20_000 })
  await chip.focus()
  await page.keyboard.press('Enter')
  await expect(delivered.locator('[data-metric="shipped"]')).toBeFocused({ timeout: 20_000 })

  // The same action is in the palette, so nothing here is pointer- or shortcut-only.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog', { name: 'Retro command palette' })).toBeVisible({
    timeout: 20_000,
  })
  await page.keyboard.type('add a card from a figure')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Carried twice or more')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-composer-seeded')).toContainText('From Carried twice')
})

test('the retro command palette reaches every retro action', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)

  await page.getByTestId('retro-claim-facilitator').click()
  await expect(page.getByTestId('retro-phase-forward')).toBeVisible({ timeout: 20_000 })

  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Retro command palette' })
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('new card')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-composer')).toBeFocused({ timeout: 20_000 })
  await page.getByTestId('retro-composer').fill('From the palette')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.locator(DRAFT)).toHaveCount(1, { timeout: 20_000 })

  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('advance')
  await page.keyboard.press('Enter')
  await expect(phaseStep(page, 'group')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })

  // Into `vote`: the palette casts a dot on the focused card AND takes it back, so neither half of
  // dot voting is shortcut-or-pointer only.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'vote')).toHaveAttribute('aria-current', 'step', { timeout: 20_000 })
  await page.locator(CARD).first().focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('cast a dot')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-vote-budget')).toHaveText('2/3 dots left', {
    timeout: 20_000,
  })

  await page.locator(CARD).first().focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('take a dot back')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-vote-budget')).toHaveText('3/3 dots left', {
    timeout: 20_000,
  })

  // Into `discuss`: an action captured from the palette is also CONVERTED from the palette, which
  // is the one retro action that had no palette entry at all.
  await page.keyboard.press(']')
  await expect(phaseStep(page, 'discuss')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('new action')
  await page.keyboard.press('Enter')
  const actionComposer = page.getByTestId('retro-action-composer')
  await expect(actionComposer).toBeFocused({ timeout: 20_000 })
  await actionComposer.fill('Rotate a review buddy each cycle')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('retro-action')).toHaveCount(1, { timeout: 20_000 })

  await page.getByTestId('retro-convert-action').focus()
  await page.keyboard.press('ControlOrMeta+k')
  await expect(palette).toBeVisible({ timeout: 20_000 })
  await page.keyboard.type('convert this action')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('retro-action-issue')).toBeVisible({ timeout: 20_000 })
})

// The three settings of an empty retro. Each one had a mutator and no caller: the format and the
// budget were unreachable from the product entirely, and anonymity could be flipped after publish
// by stepping the phase back — which is the one thing a storage-layer guarantee must never allow.
test('format, dot budget and anonymity are set on an empty retro and close afterwards', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)
  await page.getByTestId('retro-claim-facilitator').click()

  const format = page.getByTestId('retro-format')
  await expect(format).toBeVisible({ timeout: 20_000 })
  await format.selectOption('mad_sad_glad')
  await expect(page.locator('[data-retro-column]').first()).toContainText('Mad', {
    timeout: 20_000,
  })

  const budget = page.getByTestId('retro-vote-budget-set')
  await budget.selectOption('5')

  const anonymity = page.getByTestId('retro-anonymity-toggle')
  await anonymity.click()
  await expect(anonymity).toHaveAttribute('data-anonymous', 'true', { timeout: 20_000 })

  // A card, published — and every one of the three closes, on this phase and on a step back into
  // `brainstorm`, because by then there is something to re-column and something to attribute.
  await page.keyboard.press('c')
  const composer = page.getByTestId('retro-composer')
  await expect(composer).toBeFocused()
  await composer.fill('Something to attribute')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')
  await page.keyboard.press(']')
  await expect(page.locator(CARD)).toHaveCount(1, { timeout: 20_000 })
  await expect(page.getByTestId('retro-vote-budget-set')).toHaveCount(0)

  await page.keyboard.press('[')
  await expect(phaseStep(page, 'brainstorm')).toHaveAttribute('aria-current', 'step', {
    timeout: 20_000,
  })
  await expect(page.getByTestId('retro-format')).toHaveCount(0)
  await expect(page.getByTestId('retro-vote-budget-set')).toHaveCount(0)
  await expect(page.getByTestId('retro-anonymity-toggle')).toHaveCount(0)
  await expect(page.getByText('Anonymous', { exact: true }).first()).toBeVisible()
})

test('the retro is correct across every preset in light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)

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
      const isDark = await page.locator('html').evaluate((el) => el.classList.contains('dark'))
      expect(isDark).toBe(mode === 'dark')
      await expect(page.getByRole('navigation', { name: 'Retro phase' })).toBeVisible({
        timeout: 20_000,
      })
    }
  }
})

// THE TWO-CLIENT PASS (tasks 5.5): the anonymity guarantee as two real browsers see it.
//
// Client 1 is the bootstrap admin, who opens the retro, claims the seat and marks it anonymous.
// Client 2 is a second account in its own browser context, on the team through a member invite.
// The decisive assertions are made against client 2's REPLICA, not its DOM — during `brainstorm`
// client 1's draft has not reached it at all, and after the facilitator advances, the card body is
// there while nothing in the same record names its author.
//
// Note what is deliberately NOT asserted: that client 1's user id is absent from client 2's replica
// outright. It is present, and must be — the workspace roster syncs to every member, which is what
// renders an assignee picker, and so does "who is facilitating". The leak shape is an author bound
// to CONTENT, so the assertion is made per synced row, by table.
test('two clients: brainstorm stays private and advancing reveals a card with no author', async ({
  page,
  browser,
}) => {
  await enterApp(page)
  const teamName = await openTeam(page)
  await completedCycleWithRetro(page)
  await openRetro(page)
  const retroUrl = page.url()
  const facilitatorId = await syncedUserId(page)

  await page.getByTestId('retro-claim-facilitator').click()
  const anonymity = page.getByTestId('retro-anonymity-toggle')
  await expect(anonymity).toHaveAttribute('data-anonymous', 'false', { timeout: 20_000 })
  await anonymity.click()
  await expect(anonymity).toHaveAttribute('data-anonymous', 'true', { timeout: 20_000 })

  // A member invite bound to this team, so accepting it also joins the team. `member` is the
  // dialog's default role, which is what the second participant must be.
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  const inviteDialog = page.getByRole('dialog')
  await inviteDialog.getByLabel('Team (optional)').selectOption({ label: teamName })
  await inviteDialog.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const participant = {
    email: uniqueEmail('retro-participant'),
    password: 'participant-password-1234',
    name: `Retro Participant ${Date.now().toString(36)}`,
  }
  const context = await browser.newContext()
  try {
    const second = await context.newPage()
    await second.goto(inviteLink)
    await second.getByRole('button', { name: 'Create one' }).click()
    await second.getByLabel('Name').fill(participant.name)
    await second.getByLabel('Email').fill(participant.email)
    await second.getByLabel('Password', { exact: true }).fill(participant.password)
    await second.getByTestId('login-submit').click()
    await expect(second.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
    await expect(second.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    await second.goto(retroUrl)
    await expect(second.locator('[data-retro-column]')).toHaveCount(3, { timeout: 20_000 })
    await expect(second.getByText('Anonymous')).toBeVisible({ timeout: 20_000 })

    const facilitatorCard = 'I did not feel safe raising this in standup'
    const participantCard = 'Our estimates were fantasy again'

    await page.goto(retroUrl)
    await expect(page.locator('[data-retro-column]')).toHaveCount(3, { timeout: 20_000 })
    await page.keyboard.press('c')
    await page.getByTestId('retro-composer').fill(facilitatorCard)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Escape')
    await expect(page.locator(DRAFT)).toHaveCount(1, { timeout: 20_000 })

    await second.keyboard.press('c')
    await second.getByTestId('retro-composer').fill(participantCard)
    await second.keyboard.press('Enter')
    await second.keyboard.press('Escape')
    await expect(second.locator(DRAFT)).toHaveCount(1, { timeout: 20_000 })

    // Each client holds exactly its own draft and no card at all: during brainstorm there is
    // nothing in `retro_card` yet, so there is nothing to hide.
    await expect(second.locator(DRAFT)).toHaveText([participantCard])
    await expect(second.locator(CARD)).toHaveCount(0)
    await expect(page.locator(DRAFT)).toHaveText([facilitatorCard])
    await expect(page.locator(CARD)).toHaveCount(0)

    // The control, polled: Zero flushes its in-memory head to IndexedDB on its own schedule, so an
    // absence read too early would mean nothing at all. Client 2's own draft has to land first —
    // then the walk is demonstrably reading a populated replica.
    await expect.poll(() => replicaHolds(second, participantCard), { timeout: 30_000 }).toBe(true)
    const brainstorm = await readReplica(second)
    // Client 1's draft has not arrived, in any form, anywhere in the persisted bytes.
    expect(brainstorm.raw).not.toContain(facilitatorCard)
    // And the only draft rows in this replica are its owner's.
    const brainstormDrafts = brainstorm.rows.filter((row) => row.table === 'retro_draft')
    expect(brainstormDrafts.length).toBe(1)
    for (const row of brainstormDrafts) {
      expect(row.json).toContain(participantCard)
      expect(row.json).not.toContain(facilitatorId)
    }
    expect(brainstorm.rows.some((row) => row.table === 'retro_card')).toBe(false)

    // Advance out of brainstorm. Publish is server-only, so the card arrives at both clients a sync
    // tick later — with no author on the row, because the retro is anonymous.
    await page.getByTestId('retro-phase-forward').click()
    await expect(phaseStep(page, 'group')).toHaveAttribute('aria-current', 'step', {
      timeout: 20_000,
    })
    await expect(second.locator(CARD)).toHaveCount(2, { timeout: 20_000 })
    await expect(second.getByText(facilitatorCard)).toBeVisible({ timeout: 20_000 })

    await expect.poll(() => replicaHolds(second, facilitatorCard), { timeout: 30_000 }).toBe(true)
    const revealed = await readReplica(second)
    const cards = revealed.rows.filter((row) => row.table === 'retro_card')
    expect(cards.length).toBe(2)
    expect(cards.some((row) => row.json.includes(facilitatorCard))).toBe(true)
    for (const row of cards) {
      expect(row.json).toContain('"authorDisplayId":null')
      expect(row.json).not.toContain(facilitatorId)
    }

    // The general form of the guarantee, stated over the whole replica: no row of any table that
    // carries retro CONTENT names the author. `retro` itself (who is facilitating, who opened it)
    // and `retro_presence` (who is in the room) deliberately do, and neither binds a person to
    // anything written — which is why the content tables are named exhaustively here.
    const content = ['retro_card', 'retro_draft', 'retro_vote', 'retro_vote_tally', 'retro_group']
    for (const row of revealed.rows.filter((entry) => content.includes(entry.table))) {
      expect(row.json).not.toContain(facilitatorId)
    }
  } finally {
    await context.close()
  }
})
