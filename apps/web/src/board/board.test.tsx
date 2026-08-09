import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// THE FALSIFIABLE CHECK for the Board lens. On main every card is handed `buildRealityShape(null)`
// at the call site, so no card can draw a `//` break and no phrase slot exists at all: the first
// test here cannot pass there. The rest is what only a rendered board can prove — that the six
// columns share the measure, that an empty column is reserved rather than captioned, that band 2
// is the list's own filter bar, and that a live move is drawn in three still states.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  canWrite: true,
  navigate: vi.fn(),
  openCreate: vi.fn(),
  openPalette: vi.fn(),
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
    role: harness.canWrite ? 'member' : 'viewer',
    isMember: true,
    canWrite: harness.canWrite,
    canManage: false,
  }),
}))

// The ambient issues palette, stubbed down to the ONE thing the board's ⌘K contract depends on: it
// registers an opener that never declines. Registration order is what decides which surface answers
// ⌘K, so the stub has to register exactly as the real provider does or the ordering test below
// would be measuring the stub instead of the board.
vi.mock('@/issues/command', async () => {
  const { useCommandSource } = await import('@/frame/command-registry')
  const { useMemo } = await import('react')
  return {
    CommandProvider: ({ children }: { children: React.ReactNode }) => {
      useCommandSource(
        'issues',
        useMemo(
          () => ({
            open: () => {
              harness.openPalette()
              return true
            },
          }),
          [],
        ),
      )
      return children
    },
    useCommand: () => ({
      setContextIssues: vi.fn(),
      openCreate: harness.openCreate,
      openStatus: vi.fn(),
      openAssign: vi.fn(),
      openLabel: vi.fn(),
      openProject: vi.fn(),
    }),
  }
})

import { CommandRegistryProvider } from '@/frame/command-registry'
import { Board } from './board'

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
    rank: string | null
    updatedAt: number
    pr: PrFixture | null
    labels: { id: string; name: string; color: string }[]
    assigneeId: string | null
  }> & { id: string },
): unknown {
  const { pr, ...rest } = overrides
  return {
    number: 1,
    title: 'A title',
    status: 'todo',
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
  return render(
    <CommandRegistryProvider>
      <Board teamId="team-1" />
    </CommandRegistryProvider>,
  )
}

function cards(): HTMLElement[] {
  return screen.getAllByTestId('board-card')
}

function cardFor(title: string): HTMLElement {
  const found = cards().find((card) => within(card).queryByText(title) !== null)
  if (found === undefined) throw new Error(`no card for ${title}`)
  return found
}

function column(label: string): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${label}, `) })
}

beforeEach(() => {
  harness.rows = { 'teams.all': [TEAM] }
  harness.canWrite = true
  harness.navigate.mockClear()
  harness.mutate.mockClear()
  harness.openCreate.mockClear()
  harness.openPalette.mockClear()
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }))
  Element.prototype.scrollIntoView = vi.fn()
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
// The card's delivery register.
// ---------------------------------------------------------------------------

const DIVERGED = issue({
  id: 'i-diverged',
  number: 116,
  title: 'Apple Pay in the payment sheet',
  status: 'in_progress',
  pr: { state: 'merged', openedAt: NOW - 26 * HOUR, repo: 'acme/pay', mergeCommitSha: 'abc' },
})

const QUIET = issue({
  id: 'i-quiet',
  number: 1,
  title: 'Focus lost after closing the palette',
  status: 'in_progress',
  pr: null,
})

function trackSlot(card: HTMLElement): HTMLElement {
  const slot = card.querySelector<HTMLElement>('[data-slot="board-card-track"]')
  if (slot === null) throw new Error('no track slot')
  return slot
}

test('a card whose PR merged ahead of its status draws the // break and says so', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [DIVERGED, QUIET] }
  mount()

  const card = cardFor('Apple Pay in the payment sheet')
  expect(within(card).getByText('Done in git, not on the board')).toBeInTheDocument()
  expect(card.querySelector('[data-slot="reality-track-break"]')).not.toBeNull()
})

test('a quiet card draws no reality ink, announces nothing, and states no phrase', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [DIVERGED, QUIET] }
  mount()

  const quiet = cardFor('Focus lost after closing the palette')
  expect(trackSlot(quiet).querySelector('[role="img"]')).toBeNull()
  expect(trackSlot(quiet).querySelector('[data-quiet="true"]')).not.toBeNull()
  expect(quiet.querySelector('[data-slot="board-card-phrase"]')).toBeNull()

  // The measure is reserved either way, so a fact arriving later shifts nothing on the card.
  const diverged = cardFor('Apple Pay in the payment sheet')
  expect(trackSlot(quiet).style.width).toBe(trackSlot(diverged).style.width)
  expect(trackSlot(quiet).style.width).toBe('86px')
})

// ---------------------------------------------------------------------------
// The six columns, and the one an empty column draws.
// ---------------------------------------------------------------------------

const COLUMN_LABELS = ['Backlog', 'Todo', 'In Progress', 'In Review', 'Done', 'Canceled']

test('the six columns are equal fractions and the board never scrolls sideways', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [QUIET] }
  mount()

  const board = screen.getByTestId('board')
  expect(board.className).not.toMatch(/overflow-x/)

  const columns = COLUMN_LABELS.map((label) => column(label))
  expect(columns).toHaveLength(6)
  for (const section of columns) {
    expect(section.className).toContain('flex-1')
    expect(section.className).toContain('min-w-0')
    expect(section.className).not.toMatch(/(?:^|\s)w-/)
  }
})

test('an empty column draws one reserved slot and no words', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [QUIET] }
  mount()

  const canceled = column('Canceled')
  expect(within(canceled).queryByText('No issues')).toBeNull()
  expect(canceled.querySelectorAll('[data-slot="board-rest-slot"]')).toHaveLength(1)
  // The count is still stated where assistive technology reads it.
  expect(canceled).toHaveAccessibleName('Canceled, 0 issues')
  expect(column('In Progress')).toHaveAccessibleName('In Progress, 1 issues')
})

// ---------------------------------------------------------------------------
// The degenerate states, which are where a reserved measure turns into a hole. (The triage panel
// reserved its full measure over an issue with no description, read as a large empty box, and
// passed every test it had.) These are the four shapes a real board takes at its extremes.
// ---------------------------------------------------------------------------

test('a board with nothing on it is six drawn columns, not a blank page', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [] }
  mount()

  expect(screen.queryAllByTestId('board-card')).toHaveLength(0)
  expect(document.querySelectorAll('[data-slot="board-rest-slot"]')).toHaveLength(6)
  expect(screen.getByTestId('masthead-count')).toHaveTextContent('0')
  for (const label of COLUMN_LABELS) {
    const section = column(label)
    expect(section).toHaveAccessibleName(`${label}, 0 issues`)
    // The header still states which column this is and that it holds nothing — the reserved slot
    // below it is a measure, never the only thing drawn.
    const header = section.querySelector('header')
    expect(header?.textContent).toContain(label)
    expect(header?.textContent).toContain('0')
  }
  expect(screen.queryByText('No issues')).toBeNull()
})

test('a board with exactly one card reserves the five columns it is not in', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [QUIET] }
  mount()

  expect(cards()).toHaveLength(1)
  expect(document.querySelectorAll('[data-slot="board-rest-slot"]')).toHaveLength(5)
  const host = column('In Progress')
  expect(host.querySelectorAll('[data-slot="board-rest-slot"]')).toHaveLength(0)
  expect(within(host).getByText('Focus lost after closing the palette')).toBeInTheDocument()
})

test('a column of forty cards states its true total, draws them all, and scrolls rather than folding', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    issue({ id: `i-${i}`, number: 200 + i, title: `Card ${i}`, status: 'todo' }),
  )
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': many }
  mount()

  const todo = column('Todo')
  expect(todo).toHaveAccessibleName('Todo, 40 issues')
  expect(within(todo).getAllByTestId('board-card')).toHaveLength(40)
  // No fold: a folded remainder hides drop targets, so the column scrolls to reach the fortieth.
  expect(within(todo).getByText('Card 39')).toBeInTheDocument()
  expect(todo.querySelector('.overflow-y-auto')).not.toBeNull()
  expect(within(todo).queryByText(/more$/)).toBeNull()
})

// ---------------------------------------------------------------------------
// Band 2 — the list's own filter bar, with the board's one difference.
// ---------------------------------------------------------------------------

const FILTER_FIXTURE = [
  issue({ id: 'i-a', number: 10, title: 'Alpha card', status: 'todo', priority: 'urgent' }),
  issue({ id: 'i-b', number: 11, title: 'Bravo card', status: 'in_review', priority: 'low' }),
]

test('band 2 states the filtered count and offers the list’s axes and actions', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  expect(screen.getByTestId('masthead-count')).toHaveTextContent('2')
  for (const axis of ['Status', 'Priority', 'Assignee', 'Delivery']) {
    expect(screen.getByRole('button', { name: `Filter by ${axis}` })).toBeInTheDocument()
  }
  expect(screen.getByLabelText('Search issues')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Save current view' })).toBeInTheDocument()
  expect(screen.getByTestId('new-issue')).toBeInTheDocument()
})

test('the board states its order rather than offering a grouping or a sort', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  expect(screen.getByText('Manual')).toBeInTheDocument()
  expect(screen.queryByLabelText('Group by')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Sort by' })).toBeNull()
})

test('a filter narrows the columns and the count together', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  expect(cards()).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Filter by Priority' }))
  // The option carries its own drawn mark, whose `role="img"` label joins the accessible name
  // ahead of the text — hence the trailing anchor rather than a whole-string match.
  fireEvent.click(screen.getByRole('menuitem', { name: /Urgent$/ }))

  expect(cards()).toHaveLength(1)
  expect(screen.getByText('Alpha card')).toBeInTheDocument()
  expect(screen.getByTestId('masthead-count')).toHaveTextContent('1')
  expect(column('In Review')).toHaveAccessibleName('In Review, 0 issues')
})

test('New issue reaches the shared composer', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()
  fireEvent.click(screen.getByTestId('new-issue'))
  expect(harness.openCreate).toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// The move, drawn — asserted with motion reduced, so no claim here rests on animation.
// ---------------------------------------------------------------------------

function pickUp(title: string): void {
  const card = cardFor(title)
  card.focus()
  fireEvent.keyDown(card, { key: ' ', code: 'Space' })
}

test('a picked-up card becomes a hole that keeps its own measure, and the carried card states the keys', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  pickUp('Alpha card')

  // The SOURCE card is the hole: same element, content hidden rather than removed, no fill.
  const source = cards().find((card) => card.dataset.cardId === 'i-a')
  expect(source?.dataset.dragging).toBe('true')
  expect(source?.className).toContain('border-dashed')
  expect(source?.firstElementChild?.className).toContain('invisible')

  // The card in flight wears the elevation and states the contract that actually works.
  const flying = document.querySelector<HTMLElement>('[data-slot="board-card"][data-in-flight]')
  expect(flying).toBeDefined()
  expect(flying?.className).toContain('shadow-elevated')
  expect(flying?.querySelector('[data-slot="board-card-footer"]')?.textContent).toContain(
    'space drop',
  )
  expect(flying?.querySelector('[data-slot="board-card-footer"]')?.textContent).toContain(
    'esc cancel',
  )
})

test('carrying a card into another column draws exactly one landing slot there', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  pickUp('Alpha card')
  fireEvent.keyDown(cardFor('Alpha card'), { key: 'ArrowRight', code: 'ArrowRight' })

  // ONE landing site, and never in the card's own column: within a column the sortable strategy's
  // own gap is already the slot, and a second one drawn beside it would show two places to land.
  const slots = document.querySelectorAll('[data-slot="board-drop-slot"]')
  expect(slots).toHaveLength(1)
  const host = slots[0]?.closest('section')?.getAttribute('aria-label') ?? ''
  expect(host).not.toMatch(/^Todo,/)
  // Which column an arrow key reaches is geometry, and jsdom has none — the claim is that a
  // FOREIGN column draws it, not which one.
  expect(host).toMatch(/, \d+ issues$/)
})

test('a viewer is offered no pick-up and no hole, and the card still opens', () => {
  harness.canWrite = false
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  pickUp('Alpha card')
  expect(cards().some((card) => card.dataset.dragging === 'true')).toBe(false)
  expect(document.querySelector('[data-slot="board-card"][data-in-flight]')).toBeNull()
  expect(screen.queryByTestId('board-drop-slot')).toBeNull()

  const card = cardFor('Alpha card')
  expect(card).not.toHaveAttribute('aria-disabled')
  fireEvent.keyDown(card, { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalled()
})

// ---------------------------------------------------------------------------
// The shortcuts the shipped board already had.
// ---------------------------------------------------------------------------

test('o opens the focused card and m opens the move palette', async () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  cardFor('Alpha card').focus()
  fireEvent.keyDown(window, { key: 'o' })
  expect(harness.navigate).toHaveBeenCalled()

  fireEvent.keyDown(window, { key: 'm' })
  expect(await screen.findByRole('dialog', { name: 'Move issue' })).toBeInTheDocument()
})

test('⌘K moves the focused card, and declines to the ambient palette with none focused', async () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  cardFor('Alpha card').focus()
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  expect(await screen.findByRole('dialog', { name: 'Move issue' })).toBeInTheDocument()
  expect(harness.openPalette).not.toHaveBeenCalled()

  fireEvent.keyDown(document.body, { key: 'Escape' })
  ;(document.activeElement as HTMLElement | null)?.blur()
  document.body.focus()
  fireEvent.keyDown(window, { key: 'k', metaKey: true })
  expect(harness.openPalette).toHaveBeenCalled()
})

test('the page states no sentence — the missing-team state stays a label', () => {
  harness.rows = { 'teams.all': [] }
  mount()
  const status = screen.getByRole('status')
  expect(status).toHaveTextContent('Team not found')
  expect(status.textContent ?? '').not.toMatch(/\.$/)
})
