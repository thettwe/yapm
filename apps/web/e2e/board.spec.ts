import { expect, type Locator, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount, uniqueEmail } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const CARD = '[data-testid="board-card"]'
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

function column(page: Page, label: string): Locator {
  return page.getByRole('region', { name: new RegExp(`^${label},`) })
}

function card(scope: Page | Locator, title: string): Locator {
  return scope.locator(CARD).filter({ hasText: title })
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeamIssues(page: Page): Promise<string> {
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
  return teamName
}

// dnd-kit's PointerSensor has a 4px activation constraint and drives its collision detection
// from incremental pointer moves, so a single dragTo never starts a drag. Press, nudge past the
// threshold, glide over the target in steps, then release just above its top edge so the moved
// card settles before it.
async function pointerDrag(page: Page, source: Locator, target: Locator): Promise<void> {
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  if (!from || !to) throw new Error('drag source or target is not visible')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 8, { steps: 5 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 })
  await page.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 5 })
  await page.mouse.up()
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
}

// From the list, seed some issues then switch to the board via the List↔Board toggle.
async function openBoard(page: Page, titles: string[]): Promise<void> {
  for (const title of titles) await createIssue(page, title)
  await page.getByRole('link', { name: 'Board' }).click()
  await expect(page.locator(CARD).first()).toBeVisible({ timeout: 20_000 })
}

test('issues seeded in the list appear as cards in the board Todo column', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Board card')
  await openBoard(page, [title])

  await expect(card(column(page, 'Todo'), title)).toBeVisible({ timeout: 20_000 })
})

test('the command palette moves a focused card to another column and it persists', async ({
  page,
}) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Palette move')
  await openBoard(page, [title])

  const target = card(page, title)
  await target.first().focus()
  await page.keyboard.press('m')

  const palette = page.getByRole('dialog', { name: 'Move issue' })
  await expect(palette).toBeVisible()
  await palette.getByPlaceholder(/Move .* to/).fill('In Review')
  await palette.getByRole('option', { name: 'Move to In Review' }).click()

  await expect(card(column(page, 'In Review'), title)).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await expect(card(column(page, 'In Review'), title)).toBeVisible({ timeout: 20_000 })
})

test('a card can be picked up and moved across columns with the keyboard', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Keyboard move')
  await openBoard(page, [title])

  const target = card(page, title)
  await target.first().focus()
  // Space picks up; ArrowRight moves to the adjacent column; Space drops. dnd-kit measures
  // layout asynchronously between keyboard steps, so pace the keystrokes — firing them in one
  // burst races the pick-up measurement and the move no-ops.
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  await page.keyboard.press('Space')

  // The card leaves the Todo column and its status changes to the next column (In Progress).
  await expect(card(column(page, 'Todo'), title)).toHaveCount(0, { timeout: 20_000 })
  await expect(card(column(page, 'In Progress'), title)).toBeVisible({ timeout: 20_000 })

  await page.reload()
  await expect(card(column(page, 'In Progress'), title)).toBeVisible({ timeout: 20_000 })
})

test('Escape cancels a pick-up and writes no change', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Cancel card')
  await openBoard(page, [title])

  const target = card(page, title)
  await target.first().focus()
  // Pick up, nudge to the adjacent column, then cancel with Escape.
  await page.keyboard.press('Space')
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')

  // The card returns to Todo and never lands in In Progress.
  await expect(card(column(page, 'Todo'), title)).toBeVisible({ timeout: 20_000 })
  await expect(card(column(page, 'In Progress'), title)).toHaveCount(0)

  // No status/rank change persisted.
  await page.reload()
  await expect(card(column(page, 'Todo'), title)).toBeVisible({ timeout: 20_000 })
  await expect(card(column(page, 'In Progress'), title)).toHaveCount(0)
})

test('a focused board card opens its issue with the keyboard', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Open card')
  await openBoard(page, [title])

  await card(page, title).first().focus()
  // `o` opens the focused issue without a pointer (Enter/Space are reserved for pick-up/drop).
  await page.keyboard.press('o')
  await expect(page).toHaveURL(/[?&]open=/, { timeout: 20_000 })
})

test('dragging reorders two cards within a column and the order persists', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const first = unique('Alpha card')
  const second = unique('Bravo card')
  await openBoard(page, [first, second])

  const todo = column(page, 'Todo')
  await expect(card(todo, first)).toBeVisible({ timeout: 20_000 })
  await expect(card(todo, second)).toBeVisible({ timeout: 20_000 })

  // Drag the second card above the first.
  await pointerDrag(page, card(todo, second), card(todo, first))

  // The moved card settles; order is asserted by DOM position after a reload.
  await page.reload()
  const todoCards = column(page, 'Todo').locator(CARD)
  await expect(todoCards.first()).toContainText(second, { timeout: 20_000 })
})

test('dropping a card below its siblings lands it in place, not at the top', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  // Three cards, densely ranked from creation, so a drop lands position-faithfully rather than
  // minting a key that sorts the moved card to the top of the column.
  const a = unique('Alpha rank')
  const b = unique('Bravo rank')
  const c = unique('Charlie rank')
  await openBoard(page, [a, b, c])

  const todo = column(page, 'Todo')
  await expect(card(todo, a)).toBeVisible({ timeout: 20_000 })
  await expect(card(todo, c)).toBeVisible({ timeout: 20_000 })

  // Drag the first card (Alpha) down onto the last, so it settles lower in the column.
  await pointerDrag(page, card(todo, a), card(todo, c))

  await page.reload()
  const todoCards = column(page, 'Todo').locator(CARD)
  // Alpha landed lower in the column (before OR after Charlie), not back at the top: it is no
  // longer first, so Bravo — previously second — is now first. Under the old null-rank bug the
  // moved card minted a mid key that sorted it to the very top instead.
  await expect(todoCards.first()).toContainText(b, { timeout: 20_000 })
  await expect(todoCards.first()).not.toContainText(a)
})

test('the palette appends a moved card to the bottom of a multi-card column', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const first = unique('Review first')
  const second = unique('Review second')
  await openBoard(page, [first, second])

  // Move both cards to In Review via the palette; each appends to the bottom of that column.
  for (const title of [first, second]) {
    await card(page, title).first().focus()
    await page.keyboard.press('m')
    const palette = page.getByRole('dialog', { name: 'Move issue' })
    await expect(palette).toBeVisible()
    await palette.getByPlaceholder(/Move .* to/).fill('In Review')
    await palette.getByRole('option', { name: 'Move to In Review' }).click()
    await expect(card(column(page, 'In Review'), title)).toBeVisible({ timeout: 20_000 })
  }

  await page.reload()
  const reviewCards = column(page, 'In Review').locator(CARD)
  // The second card appended after the first stays last across a reload.
  await expect(reviewCards.first()).toContainText(first, { timeout: 20_000 })
  await expect(reviewCards.last()).toContainText(second)
})

test('the board renders in all three presets, light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeamIssues(page)

  const title = unique('Preset card')
  await openBoard(page, [title])

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

      await expect(column(page, 'Todo')).toBeVisible({ timeout: 20_000 })
      await expect(card(page, title).first()).toBeVisible()
    }
  }
})

test('a viewer sees the board but cannot move cards', async ({ page, browser }) => {
  await enterApp(page)
  const teamName = await openTeamIssues(page)

  const issueTitle = unique('Viewer board')
  await openBoard(page, [issueTitle])

  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const viewer = {
    email: uniqueEmail('board-viewer'),
    password: 'viewer-password-1234',
    name: `Board Viewer ${Date.now().toString(36)}`,
  }
  const context = await browser.newContext()
  try {
    const vp = await context.newPage()
    await vp.goto(inviteLink)
    await vp.getByRole('button', { name: 'Create one' }).click()
    await vp.getByLabel('Name').fill(viewer.name)
    await vp.getByLabel('Email').fill(viewer.email)
    await vp.getByLabel('Password', { exact: true }).fill(viewer.password)
    await vp.getByTestId('login-submit').click()
    await expect(vp.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
    await expect(vp.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
      timeout: 30_000,
    })

    const teamCard = vp.getByRole('listitem').filter({ hasText: teamName })
    await teamCard.getByRole('button', { name: 'Join this team' }).click()
    await vp.getByRole('link', { name: new RegExp(teamName) }).click()
    await vp.getByRole('link', { name: 'Board' }).click()

    // The viewer reads the card.
    await expect(card(vp, issueTitle).first()).toBeVisible({ timeout: 20_000 })

    // The move palette offers nothing to write: 'm' does not open a move dialog for a viewer.
    await card(vp, issueTitle).first().focus()
    await vp.keyboard.press('m')
    await expect(vp.getByRole('dialog', { name: 'Move issue' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
