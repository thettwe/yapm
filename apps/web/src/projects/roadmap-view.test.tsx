import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// What only a rendered roadmap can prove: that the grid is the team's REAL cycles and stops where
// they stop, that the two kinds of nothing read differently, that a passed target says so in words
// — and that the roving-focus keyboard model shipped before this change still works.

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

import { formatTargetDay } from './model'
import { RoadmapView } from './roadmap-view'

const DAY = 86_400_000
// A fixed instant so the axis, the cycle bands and the past-target comparison are all decidable.
const NOW = Date.UTC(2026, 7, 7)
const TEAM = { id: 'team-eng', key: 'ENG', name: 'Engineering', workspaceId: 'ws-1' }

const CYCLE_2 = {
  id: 'c2',
  name: 'Cycle 2',
  startDate: Date.UTC(2026, 6, 30),
  endDate: Date.UTC(2026, 7, 12),
}
const CYCLE_3 = {
  id: 'c3',
  name: 'Cycle 3',
  startDate: Date.UTC(2026, 7, 13),
  endDate: Date.UTC(2026, 7, 26),
}

function issue(over: { id: string; status: string } & Record<string, unknown>) {
  return {
    title: 'An issue',
    priority: 'medium',
    assigneeId: null,
    cycleId: null,
    teamId: TEAM.id,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW,
    cycle: null,
    ...over,
  }
}

function project(over: { id: string; name: string } & Record<string, unknown>) {
  return {
    status: 'planned',
    leadId: null,
    targetDate: null,
    createdAt: NOW - 40 * DAY,
    issues: [],
    ...over,
  }
}

function seed(projects: readonly unknown[], cycles: readonly unknown[] = [CYCLE_2, CYCLE_3]) {
  harness.rows = {
    'teams.all': [TEAM],
    'users.all': [{ id: 'user-1', name: 'Dana Asare' }],
    'cycles.byTeam': cycles,
    'projects.all': projects,
  }
}

const FIXTURE = [
  project({
    id: 'p-late',
    name: 'Checkout rebuild',
    status: 'active',
    targetDate: Date.UTC(2026, 7, 1),
    issues: [
      issue({ id: 'i1', status: 'done', cycleId: CYCLE_2.id, cycle: CYCLE_2 }),
      issue({ id: 'i2', status: 'todo', cycleId: CYCLE_2.id, cycle: CYCLE_2 }),
    ],
  }),
  project({
    id: 'p-done',
    name: 'Onboarding revamp',
    status: 'completed',
    targetDate: Date.UTC(2026, 7, 5),
    issues: [issue({ id: 'i3', status: 'done', cycleId: CYCLE_2.id, cycle: CYCLE_2 })],
  }),
  project({
    id: 'p-empty',
    name: 'Notifications overhaul',
    targetDate: Date.UTC(2026, 7, 20),
    issues: [],
  }),
  project({
    id: 'p-search',
    name: 'Search relevance',
    targetDate: Date.UTC(2026, 8, 9),
    issues: Array.from({ length: 6 }, (_, index) => issue({ id: `s${index}`, status: 'todo' })),
  }),
  project({
    id: 'p-undated',
    name: 'Data retention',
    issues: [issue({ id: 'u1', status: 'todo', cycleId: CYCLE_3.id, cycle: CYCLE_3 })],
  }),
]

beforeEach(() => {
  harness.incomplete.clear()
  harness.canWrite = true
  harness.navigate.mockReset()
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  vi.restoreAllMocks()
})

function row(name: string): HTMLElement {
  const found = screen.getByText(name).closest('[data-testid="roadmap-row"]')
  if (found === null) throw new Error(`no roadmap row for ${name}`)
  return found as HTMLElement
}

test('the axis is the stored cycles and stops where they stop', () => {
  seed(FIXTURE)
  render(<RoadmapView teamId={TEAM.id} />)

  // A band per stored cycle, each named, drawn from its own start and end dates.
  expect(screen.getByText('Cycle 2')).toBeTruthy()
  expect(screen.getByText('Cycle 3')).toBeTruthy()
  // Where the facts stop, the grid stops — and says so rather than ruling empty columns.
  expect(screen.getByText(`no cycles past ${formatTargetDay(CYCLE_3.endDate)}`)).toBeTruthy()
  // Whose cycles they are, because cycles are team-scoped and projects are not.
  expect(screen.getByText('Engineering')).toBeTruthy()
})

test('a passed target says so in words, and a completed project never does', () => {
  seed(FIXTURE)
  render(<RoadmapView teamId={TEAM.id} />)

  expect(within(row('Checkout rebuild')).getByText('Target passed')).toBeTruthy()
  expect(within(row('Onboarding revamp')).queryByText('Target passed')).toBeNull()
})

test('no issues and no schedule are different kinds of nothing', () => {
  seed(FIXTURE)
  render(<RoadmapView teamId={TEAM.id} />)

  expect(within(row('Notifications overhaul')).getByText('No issues yet')).toBeTruthy()
  expect(within(row('Search relevance')).getByText('Nothing scheduled')).toBeTruthy()
  expect(within(row('Search relevance')).getByText('0/6')).toBeTruthy()
  // A project with nothing to count draws no meter and no zero.
  expect(within(row('Notifications overhaul')).queryByText('0/0')).toBeNull()
})

// A cycle that ran long before the drawn window opens. Its issues are scheduled — they simply sit
// off the left edge of the axis.
const CYCLE_OLD = {
  id: 'c0',
  name: 'Cycle 0',
  startDate: Date.UTC(2026, 0, 5),
  endDate: Date.UTC(2026, 0, 18),
}

// A note beside a row is NEWS about the project — nobody broke it down, nobody scheduled it. That
// the axis does not reach the cycles its work sits in is a reading of the drawing, it fired on
// every such row, and a note every row carries distinguishes none of them.
test('work scheduled off the axis draws no note, and the row’s name says so instead', () => {
  seed(
    [
      project({
        id: 'p-off',
        name: 'Checkout rebuild',
        targetDate: Date.UTC(2026, 7, 20),
        issues: [
          issue({ id: 'o1', status: 'done', cycleId: CYCLE_OLD.id, cycle: CYCLE_OLD }),
          issue({ id: 'o2', status: 'todo', cycleId: CYCLE_OLD.id, cycle: CYCLE_OLD }),
        ],
      }),
    ],
    [CYCLE_OLD, CYCLE_2, CYCLE_3],
  )
  render(<RoadmapView teamId={TEAM.id} />)

  const off = row('Checkout rebuild')
  expect(within(off).queryByText('Scheduled outside this window')).toBeNull()
  expect(within(off).queryByText('Nothing scheduled')).toBeNull()
  expect(within(off).queryByText('No issues yet')).toBeNull()
  // The meter still counts the work, so the absence of a note is not the absence of the project.
  expect(within(off).getByText('1/2')).toBeTruthy()

  // The drawing is `aria-hidden`, so this label is the only other channel — and it used to deny a
  // schedule the project has, to exactly the reader who could not see the axis.
  const label = off.getAttribute('aria-label') ?? ''
  expect(label).toContain('scheduled beyond the drawn window')
  expect(label).not.toContain('no issues scheduled in a cycle')
})

test('the row speaks with one voice: the drawing’s facts ride the button’s own name', () => {
  seed([
    project({ id: 'p-blank', name: 'Data retention', issues: [] }),
    project({
      id: 'p-drawn',
      name: 'Checkout rebuild',
      targetDate: Date.UTC(2026, 7, 20),
      issues: [issue({ id: 'x', status: 'todo', cycleId: CYCLE_2.id, cycle: CYCLE_2 })],
    }),
  ])
  render(<RoadmapView teamId={TEAM.id} />)

  // The row is a <button>, and role=button gives its children presentational — a nested
  // `role="img"` on the drawing would be stripped and its label never announced. So the SVG is
  // hidden and carries no name of its own.
  for (const name of ['Data retention', 'Checkout rebuild']) {
    const drawing = within(row(name)).getByTestId('roadmap-row-drawing')
    expect(drawing.getAttribute('role')).toBeNull()
    expect(drawing.getAttribute('aria-label')).toBeNull()
    expect(drawing.getAttribute('aria-hidden')).toBe('true')
  }

  const drawn = row('Checkout rebuild').getAttribute('aria-label') ?? ''
  expect(drawn).toContain(`target ${formatTargetDay(Date.UTC(2026, 7, 20))}`)
  expect(drawn).toContain('ahead of today')
  expect(drawn).toContain('0 of 1 issues done')
  expect(drawn).toContain('1 in Cycle 2')

  // A row with no issues at all says exactly that and claims no schedule either way.
  const blank = row('Data retention').getAttribute('aria-label') ?? ''
  expect(blank).toContain('no target date')
  expect(blank).toContain('no issues yet')
  expect(blank).not.toContain('scheduled')
})

test('undated projects sit under one group header and keep their marks', () => {
  seed(FIXTURE)
  render(<RoadmapView teamId={TEAM.id} />)

  const headers = screen.getAllByTestId('roadmap-undated-header')
  expect(headers).toHaveLength(1)
  expect(headers[0]?.textContent).toContain('No target date')
  // An undated row still draws its issue marks, and still says where they sit.
  expect(row('Data retention').getAttribute('aria-label')).toContain('1 in Cycle 3')
})

test('the page states the bar it refuses to draw', () => {
  seed(FIXTURE)
  const { container } = render(<RoadmapView teamId={TEAM.id} />)
  expect(container.textContent).toContain(
    "a project's start — only a target is stored, so nothing here draws a bar",
  )
  // No percent anywhere: over a project nobody has broken down, a percent reads 0%.
  expect(container.textContent).not.toMatch(/\d%/)
})

test('the empty roadmap and the unfinished sync are different labels', () => {
  seed([])
  const settled = render(<RoadmapView teamId={TEAM.id} />)
  expect(settled.getByText('No projects')).toBeTruthy()
  expect(settled.queryByText(/Create a project/)).toBeNull()
  settled.unmount()

  harness.incomplete.add('projects.all')
  const syncing = render(<RoadmapView teamId={TEAM.id} />)
  expect(syncing.queryByText('No projects')).toBeNull()
  expect(syncing.getByText('Loading…')).toBeTruthy()
})

test('the roving-focus keyboard model still moves, opens and survives a shrinking set', () => {
  seed(FIXTURE)
  const view = render(<RoadmapView teamId={TEAM.id} />)

  const rows = screen.getAllByTestId('roadmap-row')
  // Target order, undated last: Aug 1, Aug 5, Aug 20, Sep 9, then the undated one.
  expect(rows.map((element) => element.textContent?.slice(0, 3))).toHaveLength(5)

  rows[0]?.focus()
  fireEvent.keyDown(rows[0] as HTMLElement, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(rows[1])
  expect(rows[1]?.getAttribute('tabindex')).toBe('0')
  expect(rows[0]?.getAttribute('tabindex')).toBe('-1')

  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'j' })
  expect(document.activeElement).toBe(rows[2])

  fireEvent.keyDown(rows[2] as HTMLElement, { key: 'k' })
  expect(document.activeElement).toBe(rows[1])

  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ search: { open: 'p-done' } }),
  )

  // The ordered set shrinks under the roving index; focus must not fall to <body>.
  fireEvent.keyDown(rows[1] as HTMLElement, { key: 'ArrowDown' })
  fireEvent.keyDown(rows[2] as HTMLElement, { key: 'ArrowDown' })
  seed([FIXTURE[0]])
  view.rerender(<RoadmapView teamId={TEAM.id} />)
  const remaining = screen.getAllByTestId('roadmap-row')
  expect(remaining).toHaveLength(1)
  expect(remaining[0]?.getAttribute('tabindex')).toBe('0')
})
