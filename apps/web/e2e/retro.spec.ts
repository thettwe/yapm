import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

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

async function openTeam(page: Page): Promise<void> {
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
