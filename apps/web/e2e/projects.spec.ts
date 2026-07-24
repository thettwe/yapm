import { expect, type Page, test } from '@playwright/test'
import { ADMIN, ensureAccount } from './support'

const STATUS = '[data-testid="connection-status"]'
const ROW = '[data-testid="issue-row"]'
const PROJECT_ISSUE_ROW = '[data-testid="project-issue-row"]'
const ROADMAP_ROW = '[data-testid="roadmap-row"]'
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
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return d.toISOString().slice(0, 10)
}

async function enterApp(page: Page): Promise<void> {
  await ensureAccount(page, ADMIN)
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<void> {
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
}

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
}

async function openProjects(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Projects' }).click()
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 20_000 })
}

async function createProject(page: Page, name: string, targetOffset?: number): Promise<void> {
  await page.getByTestId('new-project').click()
  await page.getByLabel('Project name').fill(name)
  if (targetOffset !== undefined) {
    await page.getByLabel('Target date').fill(isoDate(targetOffset))
  }
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByTestId('project-rail-item').filter({ hasText: name })).toBeVisible({
    timeout: 20_000,
  })
}

async function moveIssueToProject(page: Page, issueTitle: string, projectName: string) {
  await page.getByRole('link', { name: 'List' }).click()
  const row = page.locator(ROW).filter({ hasText: issueTitle })
  await expect(row).toBeVisible({ timeout: 20_000 })
  await row.focus()
  await page.keyboard.press('p')
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('option', { name: new RegExp(projectName) }).click()
}

test('create a project, assign an issue, and see it and its progress in the project view', async ({
  page,
}) => {
  await enterApp(page)
  await openTeam(page)

  const issueTitle = unique('Project work')
  await createIssue(page, issueTitle)

  await openProjects(page)
  const projectName = unique('Launch')
  await createProject(page, projectName, 14)

  await moveIssueToProject(page, issueTitle, projectName)

  await openProjects(page)
  await page.getByTestId('project-rail-item').filter({ hasText: projectName }).click()
  await expect(page.locator(PROJECT_ISSUE_ROW).filter({ hasText: issueTitle })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('progressbar', { name: 'Project progress' })).toBeVisible()
})

test('the roadmap places a dated project and is keyboard-navigable', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  await openProjects(page)
  const projectName = unique('Roadmap project')
  await createProject(page, projectName, 21)

  await page.getByRole('link', { name: 'Roadmap' }).click()
  const row = page.locator(ROADMAP_ROW).filter({ hasText: projectName })
  await expect(row).toBeVisible({ timeout: 20_000 })

  // Keyboard-open the project from the roadmap: focus the row and press Enter.
  await row.focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByTestId('project-rail-item').filter({ hasText: projectName }),
  ).toHaveAttribute('aria-current', 'true', { timeout: 20_000 })
})

test('the projects view is correct across every preset in light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await openProjects(page)
  await createProject(page, unique('Theme project'), 10)
  await page.getByTestId('project-rail-item').first().click()

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
      await expect(page.getByRole('progressbar', { name: 'Project progress' })).toBeVisible({
        timeout: 20_000,
      })
    }
  }
})
