import type { Page } from '@playwright/test'
import { expect, test } from './fixtures'
import { ADMIN, ensureAccount, goToMore, openWorkspaceOverview, stop, uniqueEmail } from './support'

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
  await openWorkspaceOverview(page)
  await expect(page.locator(STATUS)).toHaveAttribute('data-connection', 'connected', {
    timeout: 30_000,
  })
}

async function openTeam(page: Page): Promise<string> {
  const teamName = unique('Team')
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

async function createIssue(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New issue' }).click()
  const input = page.getByLabel('New issue title')
  await expect(input).toBeFocused()
  await input.fill(title)
  await page.keyboard.press('Enter')
  await expect(page.locator(ROW).filter({ hasText: title })).toBeVisible({ timeout: 20_000 })
}

async function openProjects(page: Page): Promise<void> {
  await goToMore(page, 'Projects')
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 20_000 })
}

async function createProject(page: Page, name: string, targetOffset?: number): Promise<void> {
  await page.getByTestId('new-project').click()
  await page.getByLabel('Project name').fill(name)
  if (targetOffset !== undefined) {
    await page.getByLabel('Target date').fill(isoDate(targetOffset))
  }
  await page.getByRole('button', { name: 'Create project' }).click()
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toBeVisible({
    timeout: 20_000,
  })
}

async function moveIssueToProject(page: Page, issueTitle: string, projectName: string) {
  await stop(page, 'Issues').click()
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
  await page.getByTestId('project-row').filter({ hasText: projectName }).click()
  await expect(page.locator(PROJECT_ISSUE_ROW).filter({ hasText: issueTitle })).toBeVisible({
    timeout: 20_000,
  })
  // The project's progress reading: done over total, drawn as a labelled state bar. The one
  // assigned issue is not done, so the page reads 0 of 1.
  await expect(page.getByTestId('project-done-count')).toHaveText('0')
  await expect(page.getByTestId('project-state-bar')).toBeVisible()
})

test('the roadmap places a dated project and is keyboard-navigable', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)

  await openProjects(page)
  // Two dated projects: the near one (14d) is the row we open; the far one (40d) guarantees at
  // least one roadmap row sorts below it, so ArrowDown always has somewhere to move. Projects are
  // workspace-level, so the roadmap also holds rows from earlier runs — hence we navigate by the
  // focused row's own roving index rather than assuming our two projects are adjacent.
  const nearName = unique('Roadmap near')
  const farName = unique('Roadmap far')
  await createProject(page, nearName, 14)
  await createProject(page, farName, 40)

  await goToMore(page, 'Roadmap')
  const nearRow = page.locator(ROADMAP_ROW).filter({ hasText: nearName })
  await expect(nearRow).toBeVisible({ timeout: 20_000 })

  // The refusal, stated on the built page: a project stores no start, so no bar is drawn.
  await expect(page.getByTestId('roadmap-refusal')).toContainText(
    'only a target is stored, so nothing here draws a bar',
  )

  // Roving focus moves between project rows. Focus the near row, then drive the roadmap's own
  // onKeyDown handler (not Playwright's row.focus()) with ArrowDown/'k' to move focus and confirm
  // the roving tabindex follows.
  await nearRow.focus()
  await expect(nearRow).toBeFocused()
  // Wait for the roving tabindex to commit onto the near row (its onFocus sets focusIndex) before
  // driving ArrowDown — otherwise the handler reads a stale focusIndex and moves the wrong row.
  await expect(nearRow).toHaveAttribute('tabindex', '0')
  const startIndex = Number(await nearRow.getAttribute('data-roadmap-index'))
  const nextRow = page.locator(`${ROADMAP_ROW}[data-roadmap-index="${startIndex + 1}"]`)

  await page.keyboard.press('ArrowDown')
  await expect(nextRow).toBeFocused()
  await expect(nextRow).toHaveAttribute('tabindex', '0')
  await expect(nearRow).toHaveAttribute('tabindex', '-1')

  // 'k' rolls roving focus back up to the near row, which is now the tabbable one.
  await page.keyboard.press('k')
  await expect(nearRow).toBeFocused()
  await expect(nearRow).toHaveAttribute('tabindex', '0')

  // Enter keyboard-opens the focused (near) project from the roadmap.
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: nearName })).toBeVisible({ timeout: 20_000 })
})

test('the projects view is correct across every preset in light and dark', async ({ page }) => {
  await enterApp(page)
  await openTeam(page)
  await openProjects(page)
  await createProject(page, unique('Theme project'), 10)
  await page.getByTestId('project-row').first().click()

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
      await expect(page.getByTestId('project-scope')).toBeVisible({ timeout: 20_000 })
    }
  }
})

test('a viewer reads the workspace-level projects but cannot create one', async ({
  page,
  newContext,
}) => {
  await enterApp(page)
  const teamName = await openTeam(page)

  await openProjects(page)
  const projectName = unique('Shared roadmap')
  await createProject(page, projectName, 14)

  // The admin mints a viewer invite from the workspace overview.
  await page.goto('/')
  await expect(page.locator('[data-testid="workspace-name"]')).toBeVisible({ timeout: 20_000 })
  await page.getByTestId('create-invite').click()
  await page.getByLabel('Role', { exact: true }).selectOption('viewer')
  await page.getByRole('button', { name: 'Create invite' }).click()
  const inviteLink = await page.getByTestId('invite-link').first().inputValue()

  const viewer = {
    email: uniqueEmail('projects-viewer'),
    password: 'viewer-password-1234',
    name: `Projects Viewer ${Date.now().toString(36)}`,
  }
  const context = await newContext()
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

  // The Projects link lives on the issue-views switch, so reach it via Issues (the team
  // overview only links to Issues and Board). The workspace-level project is then readable
  // by any member, including a viewer.
  await stop(vp, 'Issues').click()
  await goToMore(vp, 'Projects')
  await expect(vp.getByTestId('project-row').filter({ hasText: projectName })).toBeVisible({
    timeout: 20_000,
  })

  // But the writer-gated create control is absent for a viewer.
  await expect(vp.getByTestId('new-project')).toHaveCount(0)
})

test('a project created in one client converges to another without a reload', async ({
  newContext,
}) => {
  const editorCtx = await newContext()
  const watcherCtx = await newContext()
  const editor = await editorCtx.newPage()
  const watcher = await watcherCtx.newPage()

  await enterApp(editor)
  const teamName = await openTeam(editor)
  await openProjects(editor)

  // A second client (same admin) watches the same team's projects.
  await enterApp(watcher)
  await watcher.getByRole('link', { name: new RegExp(teamName) }).click()
  await stop(watcher, 'Issues').click()
  await goToMore(watcher, 'Projects')
  await expect(watcher.getByRole('button', { name: 'New project' })).toBeVisible({
    timeout: 20_000,
  })

  const projectName = unique('Converged')
  await createProject(editor, projectName, 30)

  // The new project reaches the watcher over sync without a reload.
  await expect(watcher.getByTestId('project-row').filter({ hasText: projectName })).toBeVisible({
    timeout: 20_000,
  })
})
