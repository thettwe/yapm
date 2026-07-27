import { expect, type Locator, type Page, test } from '@playwright/test'
import type { Database } from '@yapm/schema/db'
import { findIssue, findUserId, openDb, seedComment, setIssueDescription } from './db'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const ISSUE_ROW = '[data-testid="issue-row"]'
const LOCAL_ROW = '[cmdk-item][data-value^="local:issue:"]'
const SERVER_ROW = '[cmdk-item][data-value^="server:"]'
const ESCALATE_ROW = 'search:everything'

// Why this tier exists at all, stated once (design D19). Two of the four assertions below cannot be
// made anywhere else:
//
//  - The INSTANT half of the falsifiable check. "The first frame is computed on-device" is a claim
//    about a keystroke, a fetch and a frame — three things jsdom has no honest version of. It is
//    measured here as a `performance` interval from the keydown to the frame the row renders in,
//    with the search route blocked and every `fetch` to it timestamped in the page.
//  - Cursor stability across an ASYNCHRONOUS group arrival. The component test settles a mocked
//    response inside `act`; that proves the reducer, not the interaction. Only a real 150 ms
//    debounce over a real request against a real index can move a row under a real arrow key.
//
// The other two — a cross-team comment found through the real indexer, and a pointer-free
// escalation across two routes — are integration facts about the whole stack, not about a
// component.

interface SearchProbe {
  pressedAt: number
  paintedAt: number
  requests: number[]
}

declare global {
  interface Window {
    __yapmSearchProbe?: SearchProbe
  }
}

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function token(prefix: string): string {
  return `zqx${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeamIssues(page: Page, prefix: string): Promise<string> {
  const teamName = unique(prefix)
  await page.goto('/')
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

// The issue must have claimed its per-team number before anything reads it back: the search row
// renders `<TEAM>-<number>`, and a row still holding its optimistic null would render without one.
async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  const row = page.locator(ISSUE_ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

// The index is maintained by a JOB (H10), so freshness is a few seconds rather than a transaction.
// Waiting on the document row rather than on the DOM is what makes every assertion after it
// deterministic: the client issues one request per settled query and does not retry a miss, so a
// surface polled before the indexer ran would stay empty forever and time out for the wrong reason.
async function waitForIndexed(db: Database, entityId: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const row = await db.db
          .selectFrom('search_document')
          .select('entity_id')
          .where('entity_id', '=', entityId)
          .executeTakeFirst()
        return row !== undefined
      },
      { timeout: 90_000, intervals: [500, 1_000, 2_000], message: 'the search indexer never ran' },
    )
    .toBe(true)
}

// `data-pending` clearing means the client saw the synced row, which is one replication hop behind
// the commit these reads want. Polling rather than reading once, so the lookup fails only when the
// row genuinely is not there.
async function findIssueRow(db: Database, title: string): Promise<{ id: string; teamId: string }> {
  let found: { id: string; teamId: string } | undefined
  await expect
    .poll(
      async () => {
        found = await findIssue(db, title).catch(() => undefined)
        return found !== undefined
      },
      { timeout: 20_000, intervals: [250, 500, 1_000], message: `no issue row titled ${title}` },
    )
    .toBe(true)
  if (found === undefined) throw new Error(`no issue row titled ${title}`)
  return found
}

async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('ControlOrMeta+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  return page.getByPlaceholder('Type a command or search…')
}

// Every `fetch` to the search route, timestamped on the SAME clock as the paint. Installed as an
// init script because it has to be in place before the app's first request, and read back rather
// than asserted in Node because "had the row painted yet when the request went out?" is a question
// about ordering inside the page, which a Playwright-side counter can only answer approximately.
async function installFetchProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probe: SearchProbe = { pressedAt: 0, paintedAt: 0, requests: [] }
    window.__yapmSearchProbe = probe
    const original = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : (input as Request).url
      if (url.includes('/api/v1/search')) probe.requests.push(performance.now())
      return original(input, init)
    }
  })
}

// Arm the keystroke measurement. `requestAnimationFrame` rather than the mutation callback itself:
// the callback runs as a microtask before the frame is composited, and the claim is about what the
// caller SEES.
async function armKeystrokeProbe(page: Page, rowSelector: string): Promise<void> {
  await page.evaluate((selector) => {
    const probe = window.__yapmSearchProbe
    if (probe === undefined) throw new Error('the fetch probe was never installed')
    probe.pressedAt = 0
    probe.paintedAt = 0
    probe.requests = []

    window.addEventListener(
      'keydown',
      () => {
        if (probe.pressedAt === 0) probe.pressedAt = performance.now()
      },
      { capture: true },
    )

    const observer = new MutationObserver(() => {
      if (probe.paintedAt !== 0) return
      if (document.querySelector(selector) === null) return
      observer.disconnect()
      requestAnimationFrame(() => {
        probe.paintedAt = performance.now()
      })
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  }, rowSelector)
}

async function readProbe(page: Page): Promise<SearchProbe> {
  const probe = await page.evaluate(() => window.__yapmSearchProbe ?? null)
  expect(probe, 'the probe is gone — the page reloaded').not.toBeNull()
  return probe as SearchProbe
}

test.describe('search', () => {
  let db: Database

  test.beforeAll(() => {
    db = openDb()
  })

  test.afterAll(async () => {
    await db.close()
  })

  // 11.1 — the INSTANT half of the falsifiable check, and the promise that fails first if search
  // is ever quietly re-plumbed through the server.
  test('the on-device group paints from a description before any request leaves the page', async ({
    page,
    context,
  }) => {
    test.slow()
    await installFetchProbe(page)

    // Blocked at the route level: nothing this test does can reach the index, so any row it shows
    // was computed from rows Zero had already replicated.
    let attempts = 0
    await page.route('**/api/v1/search*', async (route) => {
      attempts += 1
      await route.abort('connectionfailed')
    })

    await enterApp(page)
    await openTeamIssues(page, 'Instant')
    const title = unique('Nothing in this title')
    await createIssue(page, title)

    // The token lives ONLY in the description — the exact case the old "Jump to issue" group could
    // not answer, and the case the on-device pass exists for.
    const found = token('instant')
    const issue = await findIssueRow(db, title)
    await setIssueDescription(db, issue.id, `Only in the description: ${found} and nothing else.`)

    // Settle: wait until the edited description has replicated into this client's corpus.
    let input = await openPalette(page)
    await input.fill(found)
    await expect(page.locator(LOCAL_ROW).filter({ hasText: title })).toBeVisible({
      timeout: 30_000,
    })
    await page.keyboard.press('Escape')

    // Re-open on a query that matches NOTHING, so the measured keystroke is the one that takes the
    // row from absent to present. One character, so the keydown that starts the clock is the same
    // keydown that produces the match.
    input = await openPalette(page)
    await input.fill(`${found}z`)
    await expect(page.locator(LOCAL_ROW)).toHaveCount(0)

    await armKeystrokeProbe(page, LOCAL_ROW)
    await input.press('Backspace')
    await expect
      .poll(async () => (await readProbe(page)).paintedAt, { timeout: 10_000 })
      .toBeGreaterThan(0)

    const probe = await readProbe(page)
    const elapsed = probe.paintedAt - probe.pressedAt
    expect(probe.pressedAt).toBeGreaterThan(0)
    // CLAUDE.md #9, measured rather than asserted in prose.
    expect(elapsed, `keypress to painted row took ${elapsed.toFixed(1)}ms`).toBeLessThan(100)
    // THE assertion: not one request to the search route had been issued by the time the row was
    // on screen. A row that waited on the network could not satisfy this at any latency.
    expect(probe.requests.filter((at) => at <= probe.paintedAt)).toEqual([])
    await expect(page.locator(LOCAL_ROW).filter({ hasText: title })).toBeVisible()

    // …and the request DOES go out, 150 ms later. Without this the assertion above would also hold
    // for a build that never asks the server anything, which is a different product.
    await expect
      .poll(async () => (await readProbe(page)).requests.length, { timeout: 10_000 })
      .toBeGreaterThan(0)
    const after = await readProbe(page)
    expect(after.requests.every((at) => at > after.paintedAt)).toBe(true)

    // The seam degrades, it does not hang. Offline is read from the EXISTING sync connection, so
    // dropping the network is what has to produce the label — not a second notion of "online".
    await context.setOffline(true)
    await expect
      .poll(async () => await page.locator(STATUS).getAttribute('data-connection'), {
        timeout: 60_000,
      })
      .not.toBe('connected')
    await input.fill(found)
    await expect
      .poll(async () => await page.getByTestId('palette-server-state').textContent(), {
        timeout: 30_000,
        message: 'the server group hung instead of reporting itself offline',
      })
      .toMatch(/Offline/)
    // Still answering from the replica with the network gone — the other half of the promise.
    await expect(page.locator(LOCAL_ROW).filter({ hasText: title })).toBeVisible()
    await context.setOffline(false)

    // Sanity on the block itself: an aborted route would still have counted an attempt, so a zero
    // here would mean the assertion above was measuring a route nothing ever calls.
    expect(attempts).toBeGreaterThan(0)
  })

  // 11.2 — the COMPLETE half. A comment on an issue nobody has opened, in a team the caller is not
  // in: unreachable by the on-device pass by construction, because comments sync only for the open
  // issue and other teams' issues do not sync at all.
  test('a comment on another team is found through the index, and only by someone who may read it', async ({
    page,
    browser,
  }) => {
    test.slow()
    await enterApp(page)

    const teamName = await openTeamIssues(page, 'Complete A')
    await createIssue(page, unique('An issue on the team the teammate joins'))

    await page.goto('/')
    await page.getByTestId('create-invite').click()
    const inviteDialog = page.getByRole('dialog')
    await inviteDialog.getByLabel('Team (optional)').selectOption({ label: teamName })
    await inviteDialog.getByRole('button', { name: 'Create invite' }).click()
    const inviteLink = await page.getByTestId('invite-link').first().inputValue()

    await openTeamIssues(page, 'Complete B')
    const hostTitle = unique('The issue holding the comment')
    await createIssue(page, hostTitle)

    const found = token('comment')
    const host = await findIssueRow(db, hostTitle)
    const commentId = await seedComment(db, {
      teamId: host.teamId,
      issueId: host.id,
      authorId: await findUserId(db, ADMIN.email),
      body: `The deploy pipeline ${found} stalls on its second attempt every single time.`,
    })
    await waitForIndexed(db, commentId)

    await page.goto(`/search?q=${found}`)
    const hit = page.getByRole('option').filter({ hasText: hostTitle })
    await expect(hit).toBeVisible({ timeout: 30_000 })
    // The snippet is `ts_headline` output rendered as SEGMENTS: the highlight is a `<mark>`, never
    // interpreted markup.
    await expect(hit.locator('mark').first()).toContainText(found)
    await expect(hit).toContainText('stalls on its second attempt')

    const teammate = await browser.newContext()
    try {
      const other = await teammate.newPage()
      await other.goto(inviteLink)
      await other.getByRole('button', { name: 'Create one' }).click()
      await other.getByLabel('Name').fill('Team A Only')
      await other.getByLabel('Email').fill(uniqueEmail('teamaonly'))
      await other.getByLabel('Password', { exact: true }).fill('teammate-password-1234')
      await other.getByTestId('login-submit').click()
      await expect(other.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })

      await other.goto(`/search?q=${found}`)
      // The same bytes a token that exists nowhere produces. Not "0 results you may not see" —
      // nothing at all, which is what keeps search from being an oracle over the other team.
      await expect(other.getByTestId('search-empty')).toBeVisible({ timeout: 30_000 })
      await expect(other.getByRole('option')).toHaveCount(0)
      await expect(other.getByTestId('search-announcement')).toHaveText(
        '0 results on this device, 0 results from the server.',
      )
    } finally {
      await teammate.close()
    }
  })

  // 11.3 — cursor stability against a REAL asynchronous arrival. The component tier settles a
  // mocked response inside `act`; this one arrows into the list while a real request is in flight.
  test('the active row does not move when the server group arrives late', async ({ page }) => {
    test.slow()
    await enterApp(page)
    await openTeamIssues(page, 'Stable')

    const found = token('stable')
    const titles = [1, 2, 3].map((n) => `${found} candidate ${n}`)
    for (const title of titles) await createIssue(page, title)
    const last = await findIssueRow(db, titles[2] ?? '')
    await waitForIndexed(db, last.id)

    // The late arrival has to be something the on-device pass structurally cannot hold, or the
    // duplicate suppression removes it and there is no server group left to arrive. A comment on an
    // issue nobody has opened is exactly that: comments sync only for the open issue, so this row
    // reaches the list through the index or not at all.
    const commentId = await seedComment(db, {
      teamId: last.teamId,
      issueId: last.id,
      authorId: await findUserId(db, ADMIN.email),
      body: `A late note about ${found} that only the index can reach.`,
    })
    await waitForIndexed(db, commentId)

    // Slow enough that the arrow keys are pressed while the request is unmistakably outstanding.
    await page.route('**/api/v1/search*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      await route.continue()
    })

    const input = await openPalette(page)
    await input.fill(found)
    await expect(page.locator(LOCAL_ROW)).toHaveCount(3, { timeout: 30_000 })
    await expect(page.locator(SERVER_ROW)).toHaveCount(0)

    await input.press('ArrowDown')
    await input.press('ArrowDown')

    const activeBefore = await page
      .locator('[cmdk-item][data-selected="true"]')
      .getAttribute('data-value')
    const order = async () =>
      await page
        .locator('[cmdk-item]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-value') ?? ''))
    const before = await order()
    expect(activeBefore).toBe(before[2])

    await expect(page.locator(SERVER_ROW).first()).toBeVisible({ timeout: 30_000 })
    // Exactly one: the comment. The three issues the server also matched are already in the
    // on-device group above, and a build that rendered them twice would show four rows here.
    await expect(page.locator(SERVER_ROW)).toHaveCount(1)

    const after = await order()
    const activeAfter = await page
      .locator('[cmdk-item][data-selected="true"]')
      .getAttribute('data-value')
    // The list really did grow underneath the cursor — otherwise "it did not move" is a claim
    // about nothing happening.
    expect(after.length).toBeGreaterThan(before.length)
    expect(activeAfter).toBe(activeBefore)
    // Identity is not enough: the row must still be where the caller left it, which is what a
    // re-sorting scorer would break while keeping the identity intact.
    expect(after.indexOf(activeAfter ?? '')).toBe(before.indexOf(activeBefore ?? ''))
    expect(after.slice(0, before.length)).toEqual(before)
  })

  // 11.4 — the escalation, end to end, without a pointer. Not one `click()` below.
  test('palette to /search to a result and back, from the keyboard alone', async ({ page }) => {
    test.slow()
    await enterApp(page)
    await openTeamIssues(page, 'Escalate')

    const found = token('escalate')
    const title = `${found} the row to open`
    await createIssue(page, title)
    const issue = await findIssueRow(db, title)
    await waitForIndexed(db, issue.id)

    const input = await openPalette(page)
    await input.fill(found)

    const selected = page.locator('[cmdk-item][data-selected="true"]')
    for (let step = 0; step < 12; step += 1) {
      if ((await selected.getAttribute('data-value')) === ESCALATE_ROW) break
      await input.press('ArrowDown')
    }
    await expect(selected).toHaveAttribute('data-value', ESCALATE_ROW)
    await input.press('Enter')

    await expect(page).toHaveURL(new RegExp(`/search\\?q=${found}`))
    const searchInput = page.getByTestId('search-input')
    await expect(searchInput).toBeFocused()
    await expect(searchInput).toHaveValue(found)

    const option = page.getByRole('option').filter({ hasText: title })
    await expect(option).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('option', { selected: true }).first()).toBeVisible()

    await searchInput.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/teams/[^/]+/issues\\?open=${issue.id}`))
    await expect(page.getByRole('dialog', { name: 'Issue detail' })).toBeVisible({
      timeout: 20_000,
    })

    // The query is in the URL, so Back is correct rather than approximately correct: the surface
    // comes back with its query intact and its results still there.
    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/search\\?q=${found}`))
    await expect(page.getByTestId('search-input')).toHaveValue(found)
    await expect(page.getByRole('option').filter({ hasText: title })).toBeVisible({
      timeout: 30_000,
    })
  })
})
