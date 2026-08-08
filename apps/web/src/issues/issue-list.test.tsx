import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The daylight list's rendering contract. The phrase dictionary has its own unit suite in
// @yapm/schema; what this file proves is what only a rendered page can: that each row says the
// right thing in the right slot, that quiet rows say nothing, that the mark lands on exactly the
// sourced facts, that the fold states the REAL remainder, that every re-registered control kept
// its capability, and that the keyboard model survived.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  navigate: vi.fn(),
  openCreate: vi.fn(),
  openStatus: vi.fn(),
  mutate: vi.fn((_mutation: unknown) => ({
    client: Promise.resolve({ type: 'ok' }),
    server: Promise.resolve({ type: 'ok' }),
  })),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    return [harness.rows[name] ?? [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: harness.mutate }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => harness.navigate,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    memberId: 'member-1',
    role: 'member',
    isMember: true,
    canWrite: true,
    canManage: false,
  }),
}))

vi.mock('@/issues/command', () => ({
  CommandProvider: ({ children }: { children: React.ReactNode }) => children,
  useCommand: () => ({
    setContextIssues: vi.fn(),
    openCreate: harness.openCreate,
    openStatus: harness.openStatus,
    openAssign: vi.fn(),
    openLabel: vi.fn(),
    openProject: vi.fn(),
  }),
}))

import { IssueList } from './issue-list'

const HOUR = 60 * 60 * 1000
const NOW = Date.now()
const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering', members: [{ userId: 'user-1' }] }

interface PrFixture {
  state: 'draft' | 'open' | 'approved' | 'merged' | 'closed'
  openedAt: number
  repo?: string
  mergeCommitSha?: string
  ciChecks?: { conclusion: string }[]
  reviews?: { state: string; submittedAt: number }[]
}

function issue(
  overrides: Partial<{
    id: string
    number: number
    title: string
    status: string
    priority: string
    updatedAt: number
    pr: PrFixture | null
    labels: { id: string; name: string; color: string }[]
    assigneeId: string | null
    cycleId: string | null
    projectId: string | null
  }> & { id: string },
): unknown {
  const { pr, ...rest } = overrides
  return {
    number: 1,
    title: 'A title',
    status: 'in_progress',
    priority: 'medium',
    assigneeId: null,
    rank: null,
    cycleId: null,
    projectId: null,
    updatedAt: NOW - HOUR,
    createdAt: NOW - HOUR,
    labels: [],
    assignee: null,
    issueLinks: pr == null ? [] : [{ pullRequest: pr }],
    ...rest,
  }
}

function mount() {
  return render(<IssueList teamId="team-1" />)
}

function rows(): HTMLElement[] {
  return screen.getAllByTestId('issue-row')
}

function rowFor(title: string): HTMLElement {
  const found = rows().find((row) => within(row).queryByText(title) !== null)
  if (found === undefined) throw new Error(`no row for ${title}`)
  return found
}

function phraseOf(title: string): HTMLElement | null {
  return rowFor(title).querySelector<HTMLElement>('[data-slot="rest-phrase"]')
}

beforeEach(() => {
  harness.rows = { 'teams.all': [TEAM] }
  harness.navigate.mockClear()
  harness.mutate.mockClear()
  harness.openCreate.mockClear()
  harness.openStatus.mockClear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})

// ---------------------------------------------------------------------------
// The mock's four cases, plus the quiet rows it leaves genuinely blank.
// ---------------------------------------------------------------------------

const MOCK_CASES = [
  issue({
    id: 'i-115',
    number: 115,
    title: 'Address autocomplete on shipping step',
    status: 'todo',
    pr: { state: 'open', openedAt: NOW - 16 * HOUR, ciChecks: [{ conclusion: 'failure' }] },
  }),
  issue({
    id: 'i-116',
    number: 116,
    title: 'Apple Pay in the payment sheet',
    status: 'in_progress',
    pr: { state: 'merged', openedAt: NOW - 26 * HOUR, repo: 'acme/pay', mergeCommitSha: 'abc' },
  }),
  issue({
    id: 'i-119',
    number: 119,
    title: 'Persist cart across sessions',
    status: 'done',
    pr: { state: 'merged', openedAt: NOW - 4 * HOUR, repo: 'acme/cart', mergeCommitSha: 'def' },
  }),
  issue({
    id: 'i-113',
    number: 113,
    title: 'Refund flow for partial orders',
    status: 'in_progress',
    pr: { state: 'open', openedAt: NOW - 16 * HOUR, ciChecks: [{ conclusion: 'success' }] },
  }),
  issue({ id: 'i-1', number: 1, title: 'Focus lost after closing the palette', pr: null }),
]

test('each row states the dictionary phrase its facts support', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  expect(phraseOf('Address autocomplete on shipping step')).toHaveTextContent('Checks failing')
  expect(phraseOf('Apple Pay in the payment sheet')).toHaveTextContent(
    'Done in git, not on the board',
  )
  expect(phraseOf('Persist cart across sessions')).toHaveTextContent('Built — not live yet')
  expect(phraseOf('Refund flow for partial orders')).toHaveTextContent('In review — waiting 16h')
})

test('a quiet row renders no phrase at all', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  expect(phraseOf('Focus lost after closing the palette')).toBeNull()
  // The slot is still reserved, so a populating signal cannot move a neighbour's columns.
  const slot = rowFor('Focus lost after closing the palette').querySelector(
    '[data-slot="issue-row-phrase"]',
  )
  expect(slot).not.toBeNull()
  expect(slot?.textContent).toBe('')
})

test('the GitHub mark suffixes exactly the check and deploy phrases', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  // The provider is named in the selector: a mark rendered for some other source would be the
  // wrong claim about where the fact came from, and a bare `provenance-mark` check could not see it.
  const marked = (title: string) =>
    phraseOf(title)?.querySelector('[data-slot="provenance-mark"][data-provider="github"]') != null

  expect(marked('Address autocomplete on shipping step')).toBe(true)
  expect(marked('Persist cart across sessions')).toBe(true)
  // Divergence and review age are yapm's own derivations.
  expect(marked('Apple Pay in the payment sheet')).toBe(false)
  expect(marked('Refund flow for partial orders')).toBe(false)

  // The mark never replaces the row's status arc.
  expect(
    within(rowFor('Address autocomplete on shipping step')).getByRole('img', { name: 'Todo' }),
  ).toBeInTheDocument()
})

test('the divergent row shows its phrase and its // break together', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  const row = rowFor('Apple Pay in the payment sheet')
  expect(within(row).getByText('Done in git, not on the board')).toBeInTheDocument()
  expect(row.querySelector('[data-slot="reality-track-break"]')).not.toBeNull()
})

// ---------------------------------------------------------------------------
// The fold.
// ---------------------------------------------------------------------------

function manyIssues(count: number): unknown[] {
  return Array.from({ length: count }, (_, index) =>
    issue({ id: `i-${index}`, number: index + 1, title: `Row ${index}`, pr: null }),
  )
}

test('the fold states the real remainder and the masthead keeps the full count', () => {
  const total = 63
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': manyIssues(total) }
  mount()

  // Derived from the page, never from a hard-coded budget: the fold's number plus the rows the
  // page actually rendered must equal the count the masthead states.
  const rendered = rows().length
  const stated = Number(screen.getByTestId('masthead-count').textContent)
  const fold = screen.getByTestId('issue-fold')
  const hidden = Number(/\d+/.exec(fold.textContent ?? '')?.[0])

  expect(stated).toBe(total)
  expect(rendered + hidden).toBe(stated)
  expect(rendered).toBeLessThan(stated)
})

test('a short result draws no fold', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': manyIssues(3) }
  mount()
  expect(screen.queryByTestId('issue-fold')).toBeNull()
})

test('the fold opens from the keyboard and focus lands on the first revealed row', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': manyIssues(63) }
  mount()

  const before = rows().length
  const fold = screen.getByTestId('issue-fold')
  fold.focus()
  expect(fold).toHaveFocus()
  fireEvent.click(fold)

  expect(rows().length).toBeGreaterThan(before)
  expect(rows()[before]).toHaveFocus()
  expect(screen.queryByTestId('issue-fold')).toBeNull()
})

test('moving down from the last rendered row reaches the fold', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': manyIssues(63) }
  mount()

  const rendered = rows()
  const last = rendered[rendered.length - 1]
  if (last === undefined) throw new Error('no rows rendered')
  last.focus()
  fireEvent.keyDown(last, { key: 'j' })

  expect(screen.getByTestId('issue-fold')).toHaveFocus()
})

// ---------------------------------------------------------------------------
// The re-registered bar keeps every capability.
// ---------------------------------------------------------------------------

const LABEL = { id: 'label-1', name: 'bug', color: '#cc5a40' }
const CYCLE = { id: 'cycle-1', teamId: 'team-1', name: 'Checkout push', number: 7 }
const PROJECT = { id: 'project-1', name: 'Checkout' }

// Alpha carries a value on every axis and Beta carries none of them, so a toggle on ANY axis has
// exactly one right answer — an axis wired to the wrong predicate leaves both rows or neither.
const FILTER_FIXTURE = [
  issue({
    id: 'i-a',
    number: 1,
    title: 'Alpha row',
    status: 'todo',
    priority: 'urgent',
    assigneeId: 'user-1',
    cycleId: CYCLE.id,
    projectId: PROJECT.id,
    pr: { state: 'open', openedAt: NOW - 3 * HOUR, ciChecks: [{ conclusion: 'failure' }] },
  }),
  issue({
    id: 'i-b',
    number: 2,
    title: 'Beta row',
    status: 'in_progress',
    priority: 'low',
    labels: [LABEL],
  }),
]

function mountFiltering() {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': FILTER_FIXTURE,
    'labels.byTeam': [LABEL],
    'cycles.byTeam': [CYCLE],
    'projects.all': [PROJECT],
    'users.all': [{ id: 'user-1', name: 'Ada', email: 'ada@example.com' }],
  }
  return mount()
}

function survivors(): string[] {
  return ['Alpha row', 'Beta row'].filter((title) =>
    rows().some((row) => within(row).queryByText(title) !== null),
  )
}

// All seven axes, each proven by the row it leaves standing rather than by the menu opening — an
// axis wired to the wrong predicate leaves both rows or neither.
// Status and Priority options carry their own drawn mark, whose `role="img"` label joins the
// option's accessible name ahead of the text ("TodoTodo") — hence the trailing anchor on those two
// rather than a whole-string match.
test.each([
  ['Status', /Todo$/, 'Alpha row'],
  ['Priority', /Urgent$/, 'Alpha row'],
  ['Assignee', /^Ada$/, 'Alpha row'],
  ['Delivery', /^Failing CI$/, 'Alpha row'],
  ['Label', /^bug$/, 'Beta row'],
  ['Cycle', /^Checkout push · Cycle 7$/, 'Alpha row'],
  ['Project', /^Checkout$/, 'Alpha row'],
] as const)(
  'the %s axis is named and narrows to the row its predicate matches',
  (axis, option, survivor) => {
    mountFiltering()

    const trigger = screen.getByRole('button', { name: `Filter by ${axis}` })
    expect(trigger).toBeInTheDocument()
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: option }))

    expect(rows()).toHaveLength(1)
    expect(survivors()).toEqual([survivor])
  },
)

test('the three delivery predicates are all offered', () => {
  mountFiltering()
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Delivery' }))
  for (const label of ['Blocked on review', 'Failing CI', 'Merged, not deployed']) {
    expect(screen.getByRole('menuitem', { name: label })).toBeInTheDocument()
  }
})

test('search still filters', () => {
  mountFiltering()
  fireEvent.change(screen.getByLabelText('Search issues'), { target: { value: 'Beta' } })
  expect(rows()).toHaveLength(1)
  expect(screen.getByText('Beta row')).toBeInTheDocument()
})

test('every grouping is offered and grouping regroups', () => {
  mountFiltering()
  const groupBy = screen.getByLabelText('Group by') as HTMLSelectElement
  expect([...groupBy.options].map((option) => option.value).sort()).toEqual(
    ['assignee', 'cycle', 'label', 'none', 'priority', 'project', 'status'].sort(),
  )

  fireEvent.change(groupBy, { target: { value: 'priority' } })
  expect(screen.getByRole('region', { name: 'Urgent' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Low' })).toBeInTheDocument()
})

test('every sort key and both directions survive the menu', () => {
  mountFiltering()
  fireEvent.click(screen.getByRole('button', { name: 'Sort by' }))
  for (const key of ['Priority', 'Status', 'Assignee', 'Last updated', 'Created', 'Number']) {
    expect(screen.getByRole('menuitem', { name: new RegExp(`^${key}$`) })).toBeInTheDocument()
  }
  expect(screen.getByRole('menuitem', { name: 'Sort ascending' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Sort descending' })).toBeInTheDocument()

  // Reversing the direction reverses the rendered order. Sorting is within a group, so the two
  // rows have to share one.
  fireEvent.keyDown(document.body, { key: 'Escape' })
  fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'none' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sort by' }))
  const first = () => rows()[0]?.textContent ?? ''
  const before = first()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sort ascending' }))
  expect(first()).not.toBe(before)
  fireEvent.click(screen.getByRole('menuitem', { name: 'Sort descending' }))
  expect(first()).toBe(before)
})

interface SavedViewMutation {
  mutator: { mutatorName: string }
  args: { name: string; grouping: unknown; filter: unknown; sort: unknown }
}

function saveViewAs(name: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Save current view' }))
  fireEvent.change(screen.getByLabelText('View name'), { target: { value: name } })
  const submit = screen
    .getAllByRole('button', { name: 'Save view' })
    .find((button) => button.getAttribute('type') === 'submit')
  if (submit === undefined) throw new Error('no submit button')
  fireEvent.click(submit)
  expect(harness.mutate).toHaveBeenCalled()
}

test('a view saves through the mutator and a saved view re-applies', () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': FILTER_FIXTURE,
    'savedViews.byTeam': [
      {
        id: 'view-1',
        name: 'Urgent only',
        filter: { priority: ['urgent'] },
        grouping: 'status',
        sort: { key: 'priority', direction: 'desc' },
      },
    ],
  }
  mount()

  fireEvent.change(screen.getByLabelText('Saved view'), { target: { value: 'view-1' } })
  expect(rows()).toHaveLength(1)
  expect(screen.getByText('Alpha row')).toBeInTheDocument()

  saveViewAs('Mine')

  const call = harness.mutate.mock.calls[0]?.[0] as SavedViewMutation | undefined
  expect(call?.mutator.mutatorName).toBe('savedView.create')
  expect(call?.args.name).toBe('Mine')
  // The applied view's filter and sort are what gets re-saved, not the defaults.
  expect(call?.args.filter).toEqual({ priority: ['urgent'] })
  expect(call?.args.sort).toEqual({ key: 'priority', direction: 'desc' })
})

test('saving while grouped by cycle downgrades the grouping and keeps the rest', () => {
  mountFiltering()

  fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'cycle' } })
  expect(screen.getByRole('region', { name: 'Checkout push' })).toBeInTheDocument()

  saveViewAs('By cycle')

  const call = harness.mutate.mock.calls[0]?.[0] as SavedViewMutation | undefined
  // `cycle` is not in the persistable grouping enum, so it falls back to the default rather than
  // being stored as a value the schema cannot express — and the on-screen grouping is untouched.
  expect(call?.args.grouping).toBe('status')
  expect(screen.getByLabelText('Group by')).toHaveValue('cycle')
})

// ---------------------------------------------------------------------------
// The keyboard model, and the word diet.
// ---------------------------------------------------------------------------

test('the keyboard model survives: move, select, open', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  const first = rows()[0]
  if (first === undefined) throw new Error('no rows')
  first.focus()
  fireEvent.keyDown(first, { key: 'j' })
  expect(rows()[1]).toHaveFocus()

  fireEvent.keyDown(rows()[1] as HTMLElement, { key: 'k' })
  expect(rows()[0]).toHaveFocus()

  fireEvent.keyDown(rows()[0] as HTMLElement, { key: 'x' })
  expect(rows()[0]).toHaveAttribute('data-selected')

  fireEvent.keyDown(rows()[0] as HTMLElement, { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalled()
})

test('c creates and s opens the status palette', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()
  const first = rows()[0]
  if (first === undefined) throw new Error('no rows')
  first.focus()
  fireEvent.keyDown(first, { key: 'c' })
  expect(harness.openCreate).toHaveBeenCalled()
  fireEvent.keyDown(first, { key: 's' })
  expect(harness.openStatus).toHaveBeenCalled()
})

test('Space toggles selection on the focused row', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()
  const first = rows()[0]
  if (first === undefined) throw new Error('no rows')
  fireEvent.keyDown(first, { key: ' ' })
  expect(rows()[0]).toHaveAttribute('data-selected')
})

test('the surface binds no ⌘K listener of its own — the frame owns it', () => {
  const added: string[] = []
  const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string) => {
    added.push(type)
  }) as typeof window.addEventListener)
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()
  spy.mockRestore()
  expect(added).not.toContain('keydown')
})

test('the page states no sentence — empty, loading and missing-team are labels', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [] }
  const { unmount } = mount()
  const empty = screen.getByRole('status')
  expect(empty).toHaveTextContent('No matches')
  expect(empty.textContent ?? '').not.toMatch(/\.$/)
  unmount()

  harness.rows = { 'teams.all': [] }
  mount()
  expect(screen.getByRole('status')).toHaveTextContent('Team not found')
})

test('group headers carry the mark, the label and the filtered count', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  const group = screen.getByRole('region', { name: 'Todo' })
  const header = group.firstElementChild as HTMLElement
  expect(within(header).getByText('Todo', { selector: 'span' })).toBeInTheDocument()
  expect(within(header).getByText('1')).toBeInTheDocument()
  expect(within(header).getByRole('img', { name: 'Todo' })).toBeInTheDocument()
})
