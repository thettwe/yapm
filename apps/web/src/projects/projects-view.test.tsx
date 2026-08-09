import { render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// What only a rendered index can prove: that the Projects surface is a status-grouped PROGRESS
// READING rather than a rail of buttons, that the overdue comparison is honest about which
// projects it excludes, and that a project with nothing to say draws no ink in the slots it
// reserves.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  incomplete: new Set<string>(),
  canWrite: true,
  navigate: vi.fn(),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [
      harness.rows[name] ?? [],
      { type: harness.incomplete.has(name) ? 'unknown' : 'complete' },
    ]
  },
  useZero: () => ({ mutate: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => harness.navigate,
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    memberId: 'member-1',
    role: harness.canWrite ? 'member' : 'viewer',
    isMember: true,
    canWrite: harness.canWrite,
    canManage: false,
  }),
}))

import { ProjectsView } from './projects-view'

const DAY = 86_400_000
const NOW = Date.now()
const YESTERDAY = NOW - DAY

const TEAM = { id: 'team-eng', key: 'ENG', name: 'Engineering', workspaceId: 'ws-1' }

function issue(over: { id: string; status: string } & Record<string, unknown>) {
  return {
    title: 'An issue',
    priority: 'medium',
    assigneeId: null,
    cycleId: null,
    teamId: TEAM.id,
    createdAt: NOW,
    updatedAt: NOW,
    cycle: null,
    ...over,
  }
}

function project(over: { id: string; name: string } & Record<string, unknown>) {
  return {
    status: 'active',
    leadId: null,
    targetDate: null,
    createdAt: NOW - 30 * DAY,
    issues: [],
    ...over,
  }
}

function seed(projects: readonly unknown[]) {
  harness.rows = {
    'teams.all': [TEAM],
    'users.all': [{ id: 'user-1', name: 'Dana Asare' }],
    'workspace.current': { id: 'ws-1', name: 'Acme' },
    'projects.all': projects,
  }
}

beforeEach(() => {
  harness.incomplete.clear()
  harness.canWrite = true
  harness.navigate.mockReset()
})

test('an active project past its target states the open count and a completed one does not', () => {
  seed([
    project({
      id: 'p-late',
      name: 'Checkout rebuild',
      status: 'active',
      targetDate: YESTERDAY,
      issues: [issue({ id: 'i1', status: 'todo' }), issue({ id: 'i2', status: 'in_progress' })],
    }),
    project({
      id: 'p-done',
      name: 'Onboarding revamp',
      status: 'completed',
      targetDate: YESTERDAY,
      issues: [issue({ id: 'i3', status: 'done' })],
    }),
  ])
  render(<ProjectsView teamId={TEAM.id} />)

  const late = screen.getByText('Checkout rebuild').closest('[data-testid="project-row"]')
  const shipped = screen.getByText('Onboarding revamp').closest('[data-testid="project-row"]')
  expect(late).not.toBeNull()
  expect(shipped).not.toBeNull()

  // (a) the overdue reading, as words rather than as a colour.
  expect(within(late as HTMLElement).getByText('Past target — 2 open')).toBeTruthy()
  // (b) the comparison excludes a completed project however old its date.
  expect(within(shipped as HTMLElement).queryByText(/Past target/)).toBeNull()

  // (c) status groups with their counts, and no header over a status nothing is in.
  const headers = screen.getAllByTestId('project-group-header')
  expect(headers.map((header) => header.dataset.status)).toEqual(['active', 'completed'])
  expect(headers[0]?.textContent).toContain('Active')
  expect(headers[0]?.textContent).toContain('1')
  expect(headers[1]?.textContent).toContain('Completed')
  expect(headers.some((header) => header.textContent?.includes('Cancelled'))).toBe(false)
})

test('a project with no issues reserves its slots and draws no ink in them', () => {
  seed([
    project({ id: 'p-empty', name: 'Notifications overhaul', status: 'planned', issues: [] }),
    project({
      id: 'p-six',
      name: 'Search relevance',
      status: 'planned',
      issues: Array.from({ length: 6 }, (_, index) => issue({ id: `s${index}`, status: 'todo' })),
    }),
  ])
  render(<ProjectsView teamId={TEAM.id} />)

  const empty = screen.getByText('Notifications overhaul').closest('[data-testid="project-row"]')
  const six = screen.getByText('Search relevance').closest('[data-testid="project-row"]')

  // Six real issues, none done, is NOT the same nothing as no issues at all.
  expect(within(six as HTMLElement).getByText('0/6')).toBeTruthy()
  expect(within(six as HTMLElement).getByText('ENG')).toBeTruthy()
  // The project nobody has broken down draws neither a count nor a team split — and no `0`.
  expect(within(empty as HTMLElement).queryByText('ENG')).toBeNull()
  expect((empty as HTMLElement).textContent).not.toMatch(/\d/)
})

test('no percent is rendered anywhere on the index', () => {
  seed([
    project({
      id: 'p-1',
      name: 'Payments v2',
      targetDate: NOW + 5 * DAY,
      issues: [issue({ id: 'a', status: 'done' }), issue({ id: 'b', status: 'todo' })],
    }),
  ])
  const { container } = render(<ProjectsView teamId={TEAM.id} />)
  expect(container.textContent).not.toMatch(/\d%/)
})

test('the empty workspace and the unfinished sync are different labels', () => {
  seed([])
  const settled = render(<ProjectsView teamId={TEAM.id} />)
  expect(settled.getByText('No projects')).toBeTruthy()
  settled.unmount()

  harness.incomplete.add('projects.all')
  const syncing = render(<ProjectsView teamId={TEAM.id} />)
  expect(syncing.queryByText('No projects')).toBeNull()
  expect(syncing.getByText('Loading…')).toBeTruthy()
})

test('a viewer reads the index and is offered no create control', () => {
  harness.canWrite = false
  seed([project({ id: 'p-1', name: 'Billing migration', status: 'planned' })])
  render(<ProjectsView teamId={TEAM.id} />)
  expect(screen.getByText('Billing migration')).toBeTruthy()
  expect(screen.queryByTestId('new-project')).toBeNull()
})
