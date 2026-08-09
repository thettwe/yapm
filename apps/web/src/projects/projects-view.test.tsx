import { fireEvent, render, screen, within } from '@testing-library/react'
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

test('a past target over a project with no readable issues draws no zero', () => {
  seed([
    project({
      id: 'p-blank-late',
      name: 'Data retention',
      status: 'active',
      targetDate: YESTERDAY,
      issues: [],
    }),
  ])
  render(<ProjectsView teamId={TEAM.id} />)

  const late = screen.getByText('Data retention').closest('[data-testid="project-row"]')
  // The date has gone by and the row says so — but `0 open` would assert "nothing open" over work
  // the reader may simply not be able to see, and the rest of the row draws no zero either.
  expect(within(late as HTMLElement).getByText('Past target')).toBeTruthy()
  expect(within(late as HTMLElement).queryByText(/Past target — /)).toBeNull()
  expect(within(late as HTMLElement).queryByText(/\b0\b/)).toBeNull()
})

test('the row’s `how ·` opens its derivation instead of navigating away', () => {
  seed([
    project({
      id: 'p-late',
      name: 'Checkout rebuild',
      status: 'active',
      targetDate: YESTERDAY,
      issues: [issue({ id: 'i1', status: 'todo' })],
    }),
  ])
  render(<ProjectsView teamId={TEAM.id} />)

  const late = screen.getByText('Checkout rebuild').closest('[data-testid="project-row"]')
  const trigger = within(late as HTMLElement).getByRole('button', {
    name: /How past target is derived/,
  })

  // The row is the open target and it CARRIES the disclosure. If the row swallowed the trigger the
  // panel could never be read at all.
  fireEvent.keyDown(trigger, { key: ' ' })
  expect(harness.navigate).not.toHaveBeenCalled()

  fireEvent.click(trigger)
  expect(harness.navigate).not.toHaveBeenCalled()
  expect((late as HTMLElement).querySelector('[data-slot="how-panel"]')).not.toBeNull()
})

test('the roving-focus keyboard model moves across groups, opens and survives a shrinking set', () => {
  const fixture = [
    project({ id: 'p-a', name: 'Alpha', status: 'active', targetDate: NOW + DAY }),
    project({ id: 'p-b', name: 'Bravo', status: 'active', targetDate: NOW + 2 * DAY }),
    project({ id: 'p-c', name: 'Charlie', status: 'completed', targetDate: NOW + 3 * DAY }),
  ]
  seed(fixture)
  const view = render(<ProjectsView teamId={TEAM.id} />)

  const rows = screen.getAllByTestId('project-row')
  expect(rows).toHaveLength(3)

  rows[0]?.focus()
  fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(rows[1])
  expect(rows[1]?.getAttribute('tabindex')).toBe('0')
  expect(rows[0]?.getAttribute('tabindex')).toBe('-1')

  // Down again crosses the Active → Completed group boundary: the roving index is over the ordered
  // rows, not over one group's rows.
  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'j' })
  expect(document.activeElement).toBe(rows[2])

  fireEvent.keyDown(rows[2] as HTMLElement, { key: 'k' })
  expect(document.activeElement).toBe(rows[1])

  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ search: { open: 'p-b' } }),
  )

  // The ordered set shrinks under the roving index; the tab stop must stay on a MOUNTED row so
  // Tab returns the reader to the list rather than to <body>.
  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'ArrowDown' })
  seed([fixture[0]])
  view.rerender(<ProjectsView teamId={TEAM.id} />)
  const remaining = screen.getAllByTestId('project-row')
  expect(remaining).toHaveLength(1)
  expect(remaining[0]?.getAttribute('tabindex')).toBe('0')
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
