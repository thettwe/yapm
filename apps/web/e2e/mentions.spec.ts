import type { Page } from '@playwright/test'
import { expect, type NewContext, test } from './fixtures'
import { ADMIN, ensureAccount, stop, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const BADGE = '[data-testid="inbox-badge"]'
const ISSUE_ROW = '[data-testid="issue-row"]'
const NOTIFICATION_ROW = '[data-testid="notification-row"]'

const DRAFT_PREFIX = 'the reconnect backoff needs an owner'

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
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<string> {
  const teamName = unique('Mentions')
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

// The issue must have claimed its per-team number before anyone is mentioned on it: `subject_key`
// is a write-time snapshot of `<TEAM>-<number>`, and the mention row the recipient reads carries it.
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

async function inviteToTeam(page: Page, teamName: string): Promise<string> {
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Team (optional)').selectOption({ label: teamName })
  await dialog.getByRole('button', { name: 'Create invite' }).click()
  return await page.getByTestId('invite-link').first().inputValue()
}

interface Teammate {
  page: Page
  name: string
}

async function acceptInvite(newContext: NewContext, inviteLink: string) {
  const credentials = {
    email: uniqueEmail('mentioned'),
    password: 'mentioned-password-1234',
    // A name with a diacritic and a distinct second word, so the typeahead's normalisation is
    // exercised by the same account the notification assertions use rather than by a fixture.
    name: `Zoë Mentionee ${Date.now().toString(36)}`,
  }
  const context = await newContext()
  const page = await context.newPage()
  await page.goto(inviteLink)
  await page.getByRole('button', { name: 'Create one' }).click()
  await page.getByLabel('Name').fill(credentials.name)
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password', { exact: true }).fill(credentials.password)
  await page.getByTestId('login-submit').click()
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
  return { context, teammate: { page, name: credentials.name } satisfies Teammate }
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
  teammate: Teammate
}

// One team with exactly two people on it, which is what makes the unfiltered `@` list
// deterministic: the author is excluded from their own list, workspace members who are not on the
// team are held back until a query names them, so pressing `@` offers exactly one option.
async function twoClients(page: Page, newContext: NewContext): Promise<Fixture> {
  await enterApp(page)
  const teamName = await openTeam(page)
  const issueTitle = unique('Reconnect loop freezes the board')
  await createNumberedIssue(page, issueTitle)
  const inviteLink = await inviteToTeam(page, teamName)
  const { teammate } = await acceptInvite(newContext, inviteLink)
  await openTeamIssues(page, teamName)
  return { teamName, issueTitle, teammate }
}

async function openIssueDetail(page: Page, issueTitle: string) {
  const row = page.locator(ISSUE_ROW).filter({ hasText: issueTitle })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('dialog', { name: 'Issue detail' })
  await expect(panel).toBeVisible({ timeout: 20_000 })
  return panel
}

// Does the `aria-activedescendant` IDREF resolve to an element in the EDITOR'S OWN subtree? A body
// portal makes the attribute point outside it, which is invalid ARIA: it announces nothing and
// looks perfect to a sighted developer. Read from the live DOM because that is the only place the
// relationship exists — a snapshot cannot express containment.
async function activeDescendantIsInsideEditor(page: Page, ariaLabel: string): Promise<boolean> {
  return await page.evaluate((label) => {
    const editor = document.querySelector(`[role="textbox"][aria-label="${label}"]`)
    if (editor === null) return false
    const id = editor.getAttribute('aria-activedescendant')
    if (id === null) return false
    const option = document.getElementById(id)
    if (option === null) return false
    const wrapper = editor.closest('[id^="yapm-rte-"]')
    if (wrapper === null || !wrapper.contains(option)) return false
    return option.getAttribute('role') === 'option'
  }, ariaLabel)
}

// THE TIER THAT EARNS ITS PLACE, and it did: this file found two real defects on its first two
// runs (design.md I26/I27). Three handlers want the same two keys — ProseMirror's, the rich-text
// wrapper's, and the Sheet's dismissal — and which of them wins depends on facts no other tier can
// see. jsdom has no ProseMirror key pipeline, so it cannot know that the view prevents the default
// of every Enter and Escape whether or not anything handled them; and it has no Base UI dismissal
// layer, so it cannot know that declining to act still costs you the whole panel. Only a real
// browser can say whether pressing Escape on an open typeahead destroys a half-written comment.
test('the @ typeahead is keyboard-operable and Escape dismisses only the popup', async ({
  page,
  newContext,
}) => {
  test.slow()
  const { issueTitle, teammate } = await twoClients(page, newContext)

  const panel = await openIssueDetail(page, issueTitle)
  const composer = panel.getByRole('textbox', { name: 'Add a comment' })
  await composer.click()
  await page.keyboard.type(`${DRAFT_PREFIX} `)

  // 12.1 — the popup opens, inside the editor, with a resolvable active option.
  await page.keyboard.type('@')
  const listbox = page.getByRole('listbox', { name: 'Mention a teammate' })
  await expect(listbox).toBeVisible({ timeout: 20_000 })
  await expect(listbox).toHaveCount(1)
  await expect(composer).toHaveAttribute('aria-expanded', 'true')
  // Exactly one teammate, because the author is not offered their own name.
  const options = listbox.getByRole('option')
  await expect(options).toHaveCount(1)
  await expect(options.first()).toHaveText(new RegExp(teammate.name))
  expect(await activeDescendantIsInsideEditor(page, 'Add a comment')).toBe(true)

  // Arrow then Enter, with focus never leaving the editor — the reason this is a bespoke listbox
  // rather than the command palette, whose input would take the caret away.
  await page.keyboard.press('ArrowDown')
  expect(await activeDescendantIsInsideEditor(page, 'Add a comment')).toBe(true)
  await page.keyboard.press('Enter')
  await expect(listbox).toBeHidden({ timeout: 10_000 })
  await expect(composer).toContainText(`@${teammate.name}`)
  await expect(composer).toHaveAttribute('aria-expanded', 'false')

  // 12.2 — THE NON-NEGOTIABLE ASSERTION. Escape dismisses the popup and NOTHING else: the draft
  // survives whole and the Sheet holding it stays open. Measured failing before the fix, at the
  // route nobody predicted — the wrapper stood down and Base UI's dialog dismissal, which reads
  // neither the prevented flag nor the event's origin, closed the panel anyway.
  await page.keyboard.type(' and also @')
  await expect(listbox).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Escape')
  await expect(listbox).toBeHidden({ timeout: 10_000 })
  await expect(composer).toContainText(DRAFT_PREFIX)
  await expect(composer).toContainText(`@${teammate.name}`)
  await expect(panel).toBeVisible()

  // Cmd/Ctrl+Enter is the same collision with a worse outcome: it must accept the highlighted
  // option, not post a half-written comment. A dismissed suggestion stays dismissed for its own
  // range, so this opens a NEW one rather than reviving the one Escape just closed.
  await page.keyboard.type(' @Ment')
  await expect(listbox).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(listbox).toBeHidden({ timeout: 10_000 })
  // Nothing was posted: the comment list is still empty and the draft is still in the composer.
  await expect(panel.getByText('No comments yet.')).toBeVisible()
  await expect(composer).toContainText(DRAFT_PREFIX)

  // THE CONTROL, and what makes every assertion above non-vacuous. The comment EDITOR — unlike
  // the composer — has a cancel of its own, so Escape there is genuinely destructive: it throws
  // the edit away. The pair is the whole contract in one surface: with the popup open Escape
  // dismisses only the popup, and with it closed the very same key cancels the edit.
  await panel.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(panel.getByText('No comments yet.')).toHaveCount(0, { timeout: 20_000 })
  await panel.getByRole('button', { name: 'Edit' }).first().click()
  const editor = panel.getByRole('textbox', { name: 'Edit comment' })
  await expect(editor).toBeVisible({ timeout: 20_000 })
  await editor.click()
  await page.keyboard.press('End')
  await page.keyboard.type(' @')
  await expect(listbox).toBeVisible({ timeout: 20_000 })

  await page.keyboard.press('Escape')
  await expect(listbox).toBeHidden({ timeout: 10_000 })
  // Still editing, and still holding the text — the edit was not cancelled.
  await expect(editor).toBeVisible()
  await expect(editor).toContainText(DRAFT_PREFIX)
  await expect(panel).toBeVisible()

  // The same key, with no popup open, does cancel — and takes nothing else with it.
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0, { timeout: 10_000 })
  await expect(panel).toBeVisible()
  await expect(panel.getByText(DRAFT_PREFIX)).toBeVisible()
})

// 12.3 — the mention crosses the wire as a notification, subscribes the person it named, and the
// subscription is reversible from the issue that created it. Auto-subscribe without a working exit
// is a mail trap, so "there is an unfollow" and "the unfollow works" are one assertion here.
test('a mention reaches the teammate’s inbox and its subscription is reversible', async ({
  page,
  newContext,
}) => {
  test.slow()
  const { teamName, issueTitle, teammate } = await twoClients(page, newContext)
  const bee = teammate.page

  // The baseline matters: without it, "1 unread" could be a badge that was always wrong.
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 0 unread', { timeout: 20_000 })

  const panel = await openIssueDetail(page, issueTitle)
  const composer = panel.getByRole('textbox', { name: 'Add a comment' })
  await composer.click()
  await page.keyboard.type('over to @')
  const listbox = page.getByRole('listbox', { name: 'Mention a teammate' })
  await expect(listbox).toBeVisible({ timeout: 20_000 })
  await page.keyboard.press('Enter')
  await expect(composer).toContainText(`@${teammate.name}`)
  await panel.getByRole('button', { name: 'Comment', exact: true }).click()

  // No reload and no interaction in the teammate's browser.
  await expect(bee.locator(BADGE)).toHaveAccessibleName('Inbox, 1 unread', { timeout: 30_000 })
  await bee.locator(BADGE).focus()
  await bee.keyboard.press('Enter')
  await expect(bee.getByRole('heading', { name: 'Inbox' })).toBeVisible({ timeout: 20_000 })

  // ONE row, not two: the mention and the ambient "commented" notification collapse rather than
  // telling the same person about the same comment twice.
  const row = bee.locator(NOTIFICATION_ROW)
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(`${ADMIN.name} mentioned you`)
  await expect(row).toContainText(issueTitle)

  // Being mentioned subscribed them. The control that proves it is theirs and not the author's:
  // the author never followed this issue, so their own copy of the same surface says Follow.
  await bee.keyboard.press('Enter')
  const beePanel = bee.getByRole('dialog', { name: 'Issue detail' })
  await expect(beePanel).toBeVisible({ timeout: 20_000 })
  const follow = beePanel.getByRole('button', { name: /^Follow(ing)?$/u })
  await expect(follow).toHaveAccessibleName('Following', { timeout: 20_000 })
  await expect(follow).toHaveAttribute('aria-pressed', 'true')

  // Reversible, by keyboard alone, from the thing that created it.
  await follow.focus()
  await bee.keyboard.press('Enter')
  await expect(follow).toHaveAccessibleName('Follow', { timeout: 20_000 })
  await expect(follow).toHaveAttribute('aria-pressed', 'false')

  // And it stays off across a reload — a durable row, not component state. The URL already names
  // the issue, so this reloads straight back onto the surface being asserted.
  await bee.reload()
  await expect(beePanel).toBeVisible({ timeout: 30_000 })
  await expect(beePanel.getByRole('button', { name: /^Follow(ing)?$/u })).toHaveAccessibleName(
    'Follow',
    { timeout: 20_000 },
  )

  // NO WATCHER LIST, for anybody. The author is a workspace admin and holds the widest read in
  // this workspace, and the control on their copy of the issue reports THEIR OWN subscription —
  // which they never made — rather than anyone else's. It is also the control that makes
  // "Following" above a fact about the mention and not about the surface.
  await openTeamIssues(page, teamName)
  const authorPanel = await openIssueDetail(page, issueTitle)
  await expect(authorPanel.getByRole('button', { name: /^Follow(ing)?$/u })).toHaveAccessibleName(
    'Follow',
  )
})
