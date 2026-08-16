import { fireEvent, render, screen, within } from '@testing-library/react'
import {
  DEFAULT_ISSUE_STATUS_FILTER,
  ISSUE_STATUSES,
  type IssueStatus,
  TERMINAL_ISSUE_STATUSES,
} from '@yapm/schema'
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
import { STATUS_LABEL } from './model'

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

// What the row's track ANNOUNCES. The row carries other `role="img"` marks — the status arc, the
// priority tick — so the track is addressed by its own slot rather than by role alone.
function trackNameOf(title: string): string | null {
  return rowFor(title)
    .querySelector<HTMLElement>('[data-slot="reality-track"][role="img"]')
    ?.getAttribute('aria-label') as string | null
}

function statusOption(status: IssueStatus): HTMLElement {
  // The option's drawn mark carries a `role="img"` label that joins its accessible name ahead of
  // the text ("TodoTodo"), so the anchor is trailing rather than a whole-string match.
  return screen.getByRole('menuitemcheckbox', { name: new RegExp(`${STATUS_LABEL[status]}$`) })
}

// The list opens on the live statuses now (design §D5), so a test whose fixture holds terminal work
// states the lens it is reading through. Clearing is the axis's own interaction — toggle each
// seeded value off and the axis falls back to admitting every status — never a back door around it.
function clearStatusAxis(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Status' }))
  for (const status of DEFAULT_ISSUE_STATUS_FILTER.status ?? []) {
    fireEvent.click(statusOption(status))
  }
  fireEvent.keyDown(document.body, { key: 'Escape' })
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

// The row's register speaks only when its reality is NEWS: an exception keeps its words, and a
// classification the track beside it already draws keeps none.
test('an exception row states the dictionary phrase its facts support', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()
  // `Persist cart across sessions` is Done, and the only `merged_not_deployed` phrase fixture in
  // the file — so the phrase dictionary is exercised across every case with the axis cleared.
  clearStatusAxis()

  expect(phraseOf('Address autocomplete on shipping step')).toHaveTextContent('Checks failing')
  expect(phraseOf('Apple Pay in the payment sheet')).toHaveTextContent(
    'Done in git, not on the board',
  )
})

// BOTH HALVES IN ONE TEST, because either alone is the failure mode: a row that stopped drawing its
// phrase and did not hand the words to its track has lost them, and a row that draws the phrase and
// announces it too says it twice.
test('the words a quiet row stopped drawing are spoken by its track instead', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()
  clearStatusAxis()

  expect(within(rowFor('Persist cart across sessions')).queryByText('Built — not live yet')).toBe(
    null,
  )
  expect(phraseOf('Persist cart across sessions')).toBeNull()
  expect(trackNameOf('Persist cart across sessions')?.startsWith('Built — not live yet')).toBe(true)

  expect(
    within(rowFor('Refund flow for partial orders')).queryByText('In review — waiting 16h'),
  ).toBe(null)
  expect(trackNameOf('Refund flow for partial orders')?.startsWith('In review — waiting 16h')).toBe(
    true,
  )
  // The facts the track draws still follow the words it now leads with.
  expect(trackNameOf('Refund flow for partial orders')).toContain('PR open')
})

// The other half of the same rule. The exception rows draw their words, so nobody hears them twice.
test('a row that draws its phrase is not also heard saying it', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()
  clearStatusAxis()

  const diverged = trackNameOf('Apple Pay in the payment sheet') ?? ''
  expect(diverged).not.toContain('Done in git, not on the board')
  // The break's own sentence is a different statement about a different aspect and stays.
  expect(diverged).toContain('PR merged but this issue is not marked done')
  expect(trackNameOf('Address autocomplete on shipping step')).not.toContain('Checks failing')
})

// The surface form of the precondition: quieting two rows is only honest if their drawings still
// tell them apart. Before the change station stopped drawing an approved PR as landed, these two
// drew an identical track — and quieting both would have erased the difference, not the repetition.
test('an approved row and a merged-not-deployed row are both quiet and draw different tracks', () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [
      issue({
        id: 'i-137',
        number: 137,
        title: 'Coupon stacking on the cart',
        status: 'in_review',
        pr: { state: 'approved', openedAt: NOW - 3 * HOUR, ciChecks: [{ conclusion: 'success' }] },
      }),
      ...MOCK_CASES,
    ],
  }
  mount()
  clearStatusAxis()

  expect(phraseOf('Coupon stacking on the cart')).toBeNull()
  expect(phraseOf('Persist cart across sessions')).toBeNull()

  // The drawn stations themselves, not a summary of them: two rows saying nothing must not draw
  // the same thing.
  const drawingOf = (title: string) =>
    rowFor(title).querySelector('[data-slot="reality-track"] > span')?.innerHTML ?? ''

  expect(drawingOf('Coupon stacking on the cart')).not.toBe('')
  expect(drawingOf('Coupon stacking on the cart')).not.toBe(
    drawingOf('Persist cart across sessions'),
  )
  // And each still says, to a reader who cannot see either, which one it is.
  expect(trackNameOf('Coupon stacking on the cart')?.startsWith('Approved')).toBe(true)
  expect(trackNameOf('Persist cart across sessions')?.startsWith('Built — not live yet')).toBe(true)
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
  // The deploy phrase belongs to a Done row, so the archive is asked for rather than assumed.
  clearStatusAxis()

  // The provider is named in the selector: a mark rendered for some other source would be the
  // wrong claim about where the fact came from, and a bare `provenance-mark` check could not see it.
  const marked = (title: string) =>
    phraseOf(title)?.querySelector('[data-slot="provenance-mark"][data-provider="github"]') != null

  expect(marked('Address autocomplete on shipping step')).toBe(true)
  // A mark follows the text it sourced. This row's deploy phrase is quiet, so there is no text for
  // one to follow — and a mark standing alone would be a provenance claim about nothing drawn.
  expect(marked('Persist cart across sessions')).toBe(false)
  // Divergence and review age are yapm's own derivations. The second is quiet as well.
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
// The default lens: live work on the first screen, stated on the surface that narrows it.
// ---------------------------------------------------------------------------

test('the list opens on live work, not on the archive', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  expect(screen.queryByText('Persist cart across sessions')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Done' })).toBeNull()
  // Everything else is still there: the lens excludes the terminal statuses, not the work.
  expect(rows()).toHaveLength(MOCK_CASES.length - 1)
  expect(Number(screen.getByTestId('masthead-count').textContent)).toBe(MOCK_CASES.length - 1)
})

test('the Status axis states how many statuses it admits, and names them', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  const trigger = screen.getByRole('button', { name: 'Filter by Status' })
  // The count is read off the derivation, so a status added to the product moves both together.
  expect(trigger).toHaveTextContent(String(DEFAULT_ISSUE_STATUS_FILTER.status?.length))

  fireEvent.click(trigger)
  for (const status of DEFAULT_ISSUE_STATUS_FILTER.status ?? []) {
    expect(statusOption(status)).toBeInTheDocument()
  }
  // The terminal statuses are offered, not withheld: the absence of Done is a stated filter with
  // its own control, never a rule behind the bar.
  for (const status of TERMINAL_ISSUE_STATUSES) {
    expect(statusOption(status)).toBeInTheDocument()
  }
})

// The count beside the trigger and the tick beside each option are both drawn marks, and a drawn
// mark is not a state a screen reader can read. The seeded lens is the reason 3 of 57 issues
// render, so that reason has to be in the a11y tree as well as on the glass.
test('the seeded Status axis states its selection to assistive technology', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  const trigger = screen.getByRole('button', { name: 'Filter by Status' })
  expect(trigger).toHaveAccessibleDescription(
    `${DEFAULT_ISSUE_STATUS_FILTER.status?.length} of ${ISSUE_STATUSES.length} selected`,
  )

  fireEvent.click(trigger)
  for (const status of DEFAULT_ISSUE_STATUS_FILTER.status ?? []) {
    expect(statusOption(status)).toHaveAttribute('aria-checked', 'true')
  }
  // The terminal statuses are offered and stated as unticked, not silently missing.
  for (const status of TERMINAL_ISSUE_STATUSES) {
    expect(statusOption(status)).toHaveAttribute('aria-checked', 'false')
  }
})

test('an axis with nothing selected says so rather than counting to zero', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()

  expect(screen.getByRole('button', { name: 'Filter by Priority' })).toHaveAccessibleDescription(
    'No filter applied',
  )
})

test('clearing the Status axis returns the archive', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': MOCK_CASES }
  mount()
  clearStatusAxis()

  expect(screen.getByText('Persist cart across sessions')).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Done' })).toBeInTheDocument()
  expect(Number(screen.getByTestId('masthead-count').textContent)).toBe(MOCK_CASES.length)
  expect(screen.getByRole('button', { name: 'Filter by Status' })).not.toHaveTextContent(/\d/)
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

const BOTH_LABELS = [
  { id: 'l-1', name: 'bug', color: '#cc5a40' },
  { id: 'l-2', name: 'ux', color: '#3f7fbf' },
]

function mountGroupedByLabel(count: number) {
  harness.rows = {
    'teams.all': [TEAM],
    'labels.byTeam': BOTH_LABELS,
    'issues.byTeam': Array.from({ length: count }, (_, index) =>
      issue({
        id: `i-${index}`,
        number: index + 1,
        title: `Row ${index}`,
        labels: BOTH_LABELS,
        pr: null,
      }),
    ),
  }
  mount()
  fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'label' } })
}

// The header's own count, read off the page rather than assumed.
function groupCount(name: string): number {
  const header = screen.getByRole('region', { name }).firstElementChild as HTMLElement
  return Number(within(header).getByText(/^\d+$/).textContent)
}

test('with no fold drawn, every group draws every slot its header counts', () => {
  mountGroupedByLabel(30)

  // Under label grouping an issue holds a slot in every label group it carries: 30 issues become
  // 60 slots over a 50-ISSUE page. Nothing is hidden, so a fold here would be counting slots and
  // claiming issues — and every one of the 60 slots must be on screen, because the page is cut in
  // issues and a repeated issue's later slots come with it.
  expect(screen.queryByTestId('issue-fold')).toBeNull()
  expect(rows()).toHaveLength(60)
  for (let index = 0; index < 30; index += 1) {
    expect(screen.getAllByText(`Row ${index}`)).toHaveLength(2)
  }
  // The invariant the truncation broke: a header states how much matches, and with nothing folded
  // away that is also how much it draws.
  for (const name of ['bug', 'ux']) {
    const group = screen.getByRole('region', { name })
    expect(within(group).getAllByTestId('issue-row'), name).toHaveLength(groupCount(name))
  }
})

test('when a repeating grouping does overflow, the fold states the issues still to come', () => {
  mountGroupedByLabel(60)

  const fold = screen.getByTestId('issue-fold')
  const hidden = Number(/\d+/.exec(fold.textContent ?? '')?.[0])
  const stated = Number(screen.getByTestId('masthead-count').textContent)
  const shown = new Set(rows().map((row) => row.getAttribute('data-issue-id')))

  // The masthead counts issues, not slots, so it states 60 rather than 120.
  expect(stated).toBe(60)
  expect(shown.size + hidden).toBe(stated)
  // Every issue the page admitted brought both of its slots with it.
  expect(rows()).toHaveLength(shown.size * 2)
})

test.each([['Enter'], [' ']] as const)(
  'the fold opens from the keyboard (%s) and focus lands on the first revealed row',
  (key) => {
    harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': manyIssues(63) }
    mount()

    const before = rows().length
    const fold = screen.getByTestId('issue-fold')
    fold.focus()
    expect(fold).toHaveFocus()

    // The fold is a real `<button>`, so the browser is what turns Enter and Space on it into a
    // click. jsdom does not synthesize that click, so the keyboard path is asserted in the two
    // halves the browser actually performs: the list's own key handler must NOT swallow the
    // keystroke (`fireEvent` returns false for a prevented default — the row model reading Enter
    // as "open the focused issue" would fail here), and the click it leaves the browser free to
    // dispatch must open the fold.
    expect(fireEvent.keyDown(fold, { key })).toBe(true)
    expect(rows().length).toBe(before)
    fireEvent.click(fold)

    expect(rows().length).toBeGreaterThan(before)
    expect(rows()[before]).toHaveFocus()
    expect(screen.queryByTestId('issue-fold')).toBeNull()
  },
)

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
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: option }))

    expect(rows()).toHaveLength(1)
    expect(survivors()).toEqual([survivor])
  },
)

// The seventh axis, which the sweep above cannot carry because its premise moved. The Status menu
// opens with four values already ticked (design §D5), so clicking `Todo` removes Todo rather than
// narrowing to it — the same toggle set, read against a seeded default instead of an empty one.
// The property under test is unchanged: this axis, and no other, decides which row survives.
test('the Status axis is named, and its seeded values decide which row survives', () => {
  mountFiltering()

  expect(screen.getByRole('button', { name: 'Filter by Status' })).toBeInTheDocument()
  // Both rows are live work, so the seeded lens admits both and the axis has something to decide.
  expect(survivors()).toEqual(['Alpha row', 'Beta row'])

  fireEvent.click(screen.getByRole('button', { name: 'Filter by Status' }))
  fireEvent.click(statusOption('in_progress'))

  expect(rows()).toHaveLength(1)
  expect(survivors()).toEqual(['Alpha row'])
})

test('the three delivery predicates are all offered', () => {
  mountFiltering()
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Delivery' }))
  for (const label of ['Blocked on review', 'Failing CI', 'Merged, not deployed']) {
    expect(screen.getByRole('menuitemcheckbox', { name: label })).toBeInTheDocument()
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
