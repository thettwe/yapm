import type { Page } from '@playwright/test'
import { expect, type NewContext, test } from './fixtures'
import { readReplica, replicaHolds } from './replica'
import { ADMIN, ensureAccount, openWorkspaceOverview, stop, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const BADGE = '[data-testid="inbox-badge"]'
const ISSUE_ROW = '[data-testid="issue-row"]'
const NOTIFICATION_ROW = '[data-testid="notification-row"]'

function unique(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function randomKey(): string {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let key = ''
  for (let i = 0; i < 4; i += 1) key += letters[Math.floor(Math.random() * letters.length)]
  return key
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await openWorkspaceOverview(page)
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<string> {
  const teamName = unique('Relay')
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
  return teamName
}

// The issue must have claimed its per-team number before anyone is assigned to it: `subject_key`
// is a write-time snapshot of `<TEAM>-<number>`, so assigning while the row is still pending would
// prove nothing about the key the inbox renders.
async function createNumberedIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  const row = page.locator(ISSUE_ROW).filter({ hasText: title })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await expect(row).not.toHaveAttribute('data-pending', '', { timeout: 20_000 })
}

// A shareable link bound to the team, so accepting it joins the workspace AND the team in one
// step. The email field is left empty deliberately: filling it would fire the invite-email POST,
// which is a different capability with its own tests and no transport configured here.
async function inviteToTeam(page: Page, teamName: string): Promise<string> {
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Team (optional)').selectOption({ label: teamName })
  await dialog.getByRole('button', { name: 'Create invite' }).click()
  return await page.getByTestId('invite-link').first().inputValue()
}

interface Recipient {
  page: Page
  name: string
  complaints: string[]
}

async function acceptInvite(newContext: NewContext, inviteLink: string) {
  const credentials = {
    email: uniqueEmail('notified'),
    password: 'recipient-password-1234',
    name: `Notified Member ${Date.now().toString(36)}`,
  }
  const context = await newContext()
  const page = await context.newPage()
  // The badge sits in the app shell, so anything it says on the console is said on every page of
  // the product rather than once. Collected here and asserted at the end of the run through this
  // browser, which is the only tier where a component library's dev-build complaints exist at all.
  const complaints: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') complaints.push(message.text())
  })
  await page.goto(inviteLink)
  await page.getByRole('button', { name: 'Create one' }).click()
  await page.getByLabel('Name').fill(credentials.name)
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password', { exact: true }).fill(credentials.password)
  await page.getByTestId('login-submit').click()
  await openWorkspaceOverview(page)
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
  return { context, recipient: { page, name: credentials.name, complaints } satisfies Recipient }
}

// Filter to one option, then Enter off the input. Typing narrows the list to a single stable
// choice rather than clicking a row cmdk is still re-sorting as data syncs in. The input is
// located by role, not by placeholder: the palette rewrites its placeholder per page, so
// `Type a command or search…` exists on the root page and nowhere else.
// The root palette's persistent escalation row echoes the typed query back, so it matches every
// option name this helper is given; it is excluded by text rather than by an exact name, because
// the assign rows carry more than the label they are looked up by.
async function choose(page: Page, query: string, option: string, wait = 20_000): Promise<void> {
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible({ timeout: 20_000 })
  const search = palette.getByRole('combobox')
  await search.fill(query)
  const match = page
    .getByRole('option', { name: option })
    .filter({ hasNotText: 'Search everything for' })
  await expect(match).toBeVisible({ timeout: wait })
  await search.press('Enter')
  await expect(palette).toBeHidden({ timeout: 20_000 })
}

// Keyboard-only assignment, exactly as a person does it: focus the row, press A, pick the member.
async function assignTo(page: Page, issueTitle: string, memberName: string): Promise<void> {
  const row = page.locator(ISSUE_ROW).filter({ hasText: issueTitle })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.focus()
  await page.keyboard.press('j')
  await page.keyboard.press('a')
  // The roster reaches this client by sync, so the member option can arrive after the palette.
  await choose(page, `Assign to ${memberName}`, `Assign to ${memberName}`, 30_000)
  // The row's assignee avatar carries the member's name, so this waits for the write to land
  // rather than racing the fan-out that follows it.
  await expect(row.getByLabel(memberName)).toBeVisible({ timeout: 20_000 })
}

async function runPaletteCommand(page: Page, query: string, option: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+k')
  await choose(page, query, option)
}

async function openTeamIssues(page: Page, teamName: string): Promise<void> {
  await page.goto('/')
  await page.getByRole('link', { name: new RegExp(teamName) }).click()
  await stop(page, 'Issues').click()
  await expect(page.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
}

interface Fixture {
  teamName: string
  issueTitle: string
  recipient: Recipient
}

// The admin creates a team and a numbered issue, then invites a second person onto that team in
// their own browser. Every test here needs exactly this, and nothing here has assigned anything
// yet — the recipient's inbox is provably empty at the start of each test.
async function twoClients(page: Page, newContext: NewContext): Promise<Fixture> {
  await enterApp(page)
  const teamName = await openTeam(page)
  const issueTitle = unique('Reconnect loop freezes the board')
  await createNumberedIssue(page, issueTitle)
  const inviteLink = await inviteToTeam(page, teamName)
  const { recipient } = await acceptInvite(newContext, inviteLink)
  await openTeamIssues(page, teamName)
  return { teamName, issueTitle, recipient }
}

// THE TWO-CLIENT PASS. This is the one tier that can express the claim at all: an assignment made
// in browser A lights a badge in browser B with no reload, no polling and no request from B. A
// unit test can only assert that a count renders; an integration test can only assert that a row
// exists. Neither can assert that the row crossed the wire into a second live client.
//
// The second half is H4 as two real browsers see it. The admin is not merely denied a UI — the
// row never reaches their replica at all, which is asserted against the persisted IndexedDB bytes
// and not against the DOM, because "not rendered" and "not received" are different guarantees.
test('an assignment in one client lights the recipient’s badge in another, with no reload', async ({
  page,
  newContext,
}) => {
  test.slow()
  const { issueTitle, recipient } = await twoClients(page, newContext)
  const bee = recipient.page

  // The recipient parks on the workspace overview — an app-shell surface, so the badge is
  // mounted and its subscription is live. The baseline matters: without it, "1 unread" could be
  // a badge that was always wrong.
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 0 unread', { timeout: 20_000 })

  await assignTo(page, issueTitle, recipient.name)

  // No reload, no navigation, no interaction of any kind in the recipient's browser.
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 1 unread', { timeout: 30_000 })

  // Keyboard-only from the badge: it is a link in the tab order, so focus plus Enter reaches
  // the inbox without a pointer.
  await bee.locator(BADGE).focus()
  await bee.keyboard.press('Enter')
  await expect(bee.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })

  const row = bee.locator(NOTIFICATION_ROW)
  await expect(row).toHaveCount(1)
  await expect(row).toHaveAttribute('data-read', 'false')
  await expect(row).toContainText(`${ADMIN.name} assigned you`)
  await expect(row).toContainText(issueTitle)

  // The list takes the cursor on arrival, which is what makes `j` then Enter possible at all.
  await expect(row).toBeFocused()
  await bee.keyboard.press('j')
  await bee.keyboard.press('Enter')

  const panel = bee.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByRole('textbox', { name: 'Issue title' })).toHaveValue(issueTitle)

  // Back to the inbox by history, not by reload: the read stamp came from the mutator, not from
  // a re-fetch, and the badge recounts from the same synced rows the list holds.
  await bee.goBack()
  await expect(bee.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })
  await expect(bee.locator(NOTIFICATION_ROW)).toHaveAttribute('data-read', 'true', {
    timeout: 20_000,
  })
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 0 unread', { timeout: 20_000 })

  // The positive control for the walk below: the recipient's own replica DOES hold the row, so
  // "no notification rows" read from another replica means the row was withheld and not that the
  // walk cannot see notifications.
  await expect
    .poll(() => readReplica(bee).then((r) => r.rows.some((row) => row.table === 'notification')), {
      timeout: 30_000,
    })
    .toBe(true)

  // H4: the workspace admin who CAUSED this notification cannot read it. They run the same
  // synced query — the badge on this very page is that subscription — and receive nothing.
  await page.goto('/')
  await expect(page.locator(BADGE)).toHaveAccessibleName('Inbox, 0 unread', { timeout: 20_000 })
  // The second control: the admin's replica demonstrably holds this workspace's data, so the
  // absence below is read from a populated replica rather than an empty one.
  await expect.poll(() => replicaHolds(page, issueTitle), { timeout: 30_000 }).toBe(true)
  const adminReplica = await readReplica(page)
  expect(adminReplica.rows.some((replicaRow) => replicaRow.table === 'notification')).toBe(false)

  // Nothing this change's own surfaces said on the console along the way. Scoped by component
  // rather than asserted empty, because the issue-detail panel this walk ends on carries its own
  // pre-existing Base UI complaint, which is not this change's to fix or to hide.
  const ours = /\b(InboxBadge|InboxView|InboxRow)\b/
  expect(recipient.complaints.filter((line) => ours.test(line))).toEqual([])
})

// The palette half of the surface (tasks 7.5): both new entries, reached only from the keyboard,
// and the guarantee that a comment notification names the comment without carrying a word of it.
test('the palette reaches the inbox and marks it read, and no comment body follows', async ({
  page,
  newContext,
}) => {
  test.slow()
  const { teamName, issueTitle, recipient } = await twoClients(page, newContext)
  const bee = recipient.page
  const confidential = `payroll-${Date.now().toString(36)}`

  await assignTo(page, issueTitle, recipient.name)

  // A comment from the admin on the issue the recipient now owns: the recipient is the
  // assignee, so they are a comment recipient, and the admin is the actor, so they are not.
  const issueRow = page.locator(ISSUE_ROW).filter({ hasText: issueTitle })
  await issueRow.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  const composer = panel.getByRole('textbox', { name: 'Add a comment' })
  await composer.click()
  await page.keyboard.type(`Rolling this back because ${confidential} is exposed`)
  await panel.getByRole('button', { name: 'Comment', exact: true }).click()

  // The recipient works from the team issue list, which is where the palette lives.
  await openTeamIssues(bee, teamName)
  await runPaletteCommand(bee, 'Go to inbox', 'Go to inbox')

  await expect(bee.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })
  await expect(bee.locator(NOTIFICATION_ROW)).toHaveCount(2, { timeout: 30_000 })
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 2 unread', { timeout: 20_000 })
  const list = bee.getByRole('region', { name: 'Notifications' })
  // The row's phrase is the actor and the verb, with the subject drawn beside it in its own
  // columns — so the comment row now reads `<ADMIN> commented` rather than `… commented on
  // ENG-1`. The claim is identical: this row names this actor and this verb.
  await expect(list).toContainText(`${ADMIN.name} commented`)
  await expect(list).toContainText(`${ADMIN.name} assigned you`)
  // And the subject is drawn, once, as the row's title.
  await expect(list).toContainText(issueTitle)

  // The whole point of cutting excerpts: the comment reached the inbox as an event, and its
  // text did not reach it at all.
  await expect(list).not.toContainText(confidential)

  await bee.goBack()
  await expect(bee.getByRole('button', { name: 'New issue' })).toBeVisible({ timeout: 20_000 })
  await runPaletteCommand(bee, 'Mark all notifications as read', 'Mark all notifications as read')
  await runPaletteCommand(bee, 'Go to inbox', 'Go to inbox')

  await expect(bee.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 0 unread', { timeout: 20_000 })
  const rows = bee.locator(NOTIFICATION_ROW)
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toHaveAttribute('data-read', 'true')
  await expect(rows.nth(1)).toHaveAttribute('data-read', 'true')
})
