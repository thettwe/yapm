import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CARD_TRACK_WIDTH } from '@yapm/ui/components/board-card'
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

import { FOCUS_RESTORE_FRAMES } from '@/board/model'
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

// The focus restore runs on animation frames; a test that hands focus somewhere else has to let
// that run end first.
async function advanceFrames(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(undefined))
      })
    })
  }
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

// A card whose classification the track already draws: the register holds words for it and does not
// draw them here either, so the card's own name is the only place they can go.
const UNREVIEWED = issue({
  id: 'i-unreviewed',
  number: 113,
  title: 'Refund flow for partial orders',
  status: 'in_progress',
  pr: { state: 'open', openedAt: NOW - 16 * HOUR, ciChecks: [{ conclusion: 'success' }] },
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

  // The measure is reserved either way, so a fact arriving later shifts nothing on the card — and
  // it now includes the age column, which is the only channel the card has left for a review age
  // the register no longer states in words.
  const diverged = cardFor('Apple Pay in the payment sheet')
  expect(trackSlot(quiet).style.width).toBe(trackSlot(diverged).style.width)
  expect(trackSlot(quiet).style.width).toBe(`${CARD_TRACK_WIDTH}px`)
  expect(trackSlot(quiet).querySelector('[data-slot="reality-track-age"]')).not.toBeNull()
})

// A card and a row describing one issue cannot disagree about what is worth saying: both speak the
// news register, so neither draws the phrase — and here the card's OWN name has to carry the words,
// because an explicit name suppresses the track's `role="img"` label along with everything else.
test('a quiet card draws no phrase, keeps the words in its name, and still draws the review age', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [DIVERGED, UNREVIEWED] }
  mount()

  const card = cardFor('Refund flow for partial orders')
  expect(card.querySelector('[data-slot="board-card-phrase"]')).toBeNull()
  expect(within(card).queryByText('In review — waiting 16h')).toBeNull()
  expect(card.getAttribute('aria-label') ?? '').toContain('In review — waiting 16h')
  // The age the phrase used to carry is drawn instead of lost.
  expect(trackSlot(card).querySelector('[data-slot="reality-track-age"]')?.textContent).toBe('16h')
})

// The card is a role=button carrying an explicit aria-label, and an explicit name SUPPRESSES
// everything drawn inside it — the phrase and the track's own role=img label included. The
// divergence this lens exists to surface would then be drawn and never spoken.
test('the card speaks its delivery register, and says nothing extra when it has none', () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': [DIVERGED, QUIET] }
  mount()

  const name = cardFor('Apple Pay in the payment sheet').getAttribute('aria-label') ?? ''
  expect(name).toContain('Done in git, not on the board')
  expect(name).toContain('PR merged but this issue is not marked done')

  // A quiet card draws no phrase and no ink, so its name ends where the facts end.
  expect(cardFor('Focus lost after closing the palette')).toHaveAccessibleName(
    'ENG-1: Focus lost after closing the palette, In Progress, Medium',
  )
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
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Urgent$/ }))

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
  expect(flying).not.toBeNull()
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

// A move can take its own card out of the filtered set — the row is still there, this board just
// stops drawing it. Focus has nowhere to return to, and retrying the card's selector would spend
// the restore window and leave focus on <body>.
test('a move that leaves the filter hands focus to the destination column and says where the card went', async () => {
  const bravo = issue({ id: 'i-b', number: 11, title: 'Bravo card', status: 'in_review' })
  const rows = (...issues: unknown[]) => ({ 'teams.all': [TEAM], 'issues.byTeam': [...issues] })
  const alpha = (status: string) => issue({ id: 'i-a', number: 10, title: 'Alpha card', status })
  const charlie = (status: string) =>
    issue({ id: 'i-c', number: 12, title: 'Charlie card', status })

  harness.rows = rows(alpha('todo'), charlie('todo'), bravo)
  const view = mount()

  fireEvent.click(screen.getByRole('button', { name: 'Filter by Status' }))
  fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Todo$/ }))
  expect(cards()).toHaveLength(2)

  const region = screen.getByTestId('board-announcement')
  const SENTENCE = 'Moved to In Review, which the current filter hides.'

  // The sync layer pushing the optimistic row back: the stubbed `useQuery` has no subscription of
  // its own, so the re-render the real one would cause is asked for here.
  const settle = () =>
    view.rerender(
      <CommandRegistryProvider>
        <Board teamId="team-1" />
      </CommandRegistryProvider>,
    )

  async function moveToInReview(title: string, landed: readonly unknown[]): Promise<void> {
    harness.mutate.mockImplementation(() => {
      harness.rows = rows(...landed)
      return { client: Promise.resolve({ type: 'ok' }), server: Promise.resolve({ type: 'ok' }) }
    })
    cardFor(title).focus()
    fireEvent.keyDown(window, { key: 'm' })
    fireEvent.click(await screen.findByRole('option', { name: /Move to In Review/ }))
  }

  await moveToInReview('Alpha card', [alpha('in_review'), charlie('todo'), bravo])
  settle()

  expect(screen.queryAllByTestId('board-card')).toHaveLength(1)
  expect(cards()[0]?.dataset.cardId).toBe('i-c')
  expect(region).toHaveTextContent(SENTENCE)
  // Focus lands on the column the card went to, never on <body>.
  const inReview = screen.getByRole('region', { name: /^In Review, / })
  await waitFor(() => expect(document.activeElement).toBe(inReview))
  // The restore loop settles on the frame AFTER it sees focus stuck, so let it finish before the
  // next card is focused — otherwise it would steal focus back mid-test.
  await advanceFrames(3)

  // A SECOND move to the same hidden status. The sentence is byte-identical, so a region that is
  // merely re-assigned it mutates no DOM and is never spoken again: the region has to be emptied
  // first, and that empty frame is the proof the next write is a real change.
  await moveToInReview('Charlie card', [alpha('in_review'), charlie('in_review'), bravo])
  expect(region.textContent).toBe('')

  settle()

  expect(screen.queryAllByTestId('board-card')).toHaveLength(0)
  expect(region).toHaveTextContent(SENTENCE)
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('region', { name: /^In Review, / })),
  )
})

// ---------------------------------------------------------------------------
// The focus-restore loop's guard (RC3 family B): recover dropped focus, never take held focus.
// A server-ack rebase re-runs the restore effect mid-window, and an unguarded loop re-stole
// focus from wherever the reader had moved on to — so `m` opened the Move palette for the card
// the reader had already left.
// ---------------------------------------------------------------------------

const REFOCUS_ROWS = (alphaStatus: string) => ({
  'teams.all': [TEAM],
  'issues.byTeam': [
    issue({ id: 'i-a', number: 10, title: 'Alpha card', status: alphaStatus }),
    issue({ id: 'i-c', number: 12, title: 'Charlie card', status: 'todo' }),
  ],
})

// Move Alpha out of Todo through the `m` palette, leaving `pendingFocus` armed on it. The stubbed
// `useQuery` has no subscription of its own, so the server-ack rebase is the caller's `settle`.
async function moveAlphaToInReview(): Promise<void> {
  harness.mutate.mockImplementation(() => {
    harness.rows = REFOCUS_ROWS('in_review')
    return { client: Promise.resolve({ type: 'ok' }), server: Promise.resolve({ type: 'ok' }) }
  })
  cardFor('Alpha card').focus()
  fireEvent.keyDown(window, { key: 'm' })
  fireEvent.click(await screen.findByRole('option', { name: /Move to In Review/ }))
}

function settleRebase(view: ReturnType<typeof render>): void {
  view.rerender(
    <CommandRegistryProvider>
      <Board teamId="team-1" />
    </CommandRegistryProvider>,
  )
}

test('a move restores focus dropped to body onto the card in its new column', async () => {
  harness.rows = REFOCUS_ROWS('todo')
  const view = mount()

  await moveAlphaToInReview()
  settleRebase(view)

  // The remount dropped focus; nobody holds it, so the loop recovers it onto the moved card.
  await waitFor(() =>
    expect((document.activeElement as HTMLElement | null)?.dataset.cardId).toBe('i-a'),
  )
  expect(cardFor('Alpha card').closest('section')).toHaveAccessibleName(/^In Review, /)
  await advanceFrames(FOCUS_RESTORE_FRAMES + 1)
})

test('the restore never steals focus the reader already moved to another card', async () => {
  harness.rows = REFOCUS_ROWS('todo')
  const view = mount()

  await moveAlphaToInReview()
  settleRebase(view)
  // The reader has moved on before the restore window runs out: held focus is not a handoff.
  cardFor('Charlie card').focus()

  await advanceFrames(FOCUS_RESTORE_FRAMES + 1)
  expect((document.activeElement as HTMLElement | null)?.dataset.cardId).toBe('i-c')
})

test('the restore never steals focus out of an open dialog', async () => {
  harness.rows = REFOCUS_ROWS('todo')
  mount()

  await moveAlphaToInReview()
  // Synchronously — no frame may run in between, or the loop would settle against a card first:
  // the reader opens the Move palette for the OTHER card and is typing into it.
  cardFor('Charlie card').focus()
  fireEvent.keyDown(window, { key: 'm' })
  const dialogInput = screen.getByPlaceholderText('Move Charlie card to…')
  dialogInput.focus()

  await advanceFrames(FOCUS_RESTORE_FRAMES + 1)
  expect(document.activeElement).toBe(dialogInput)
  expect(screen.getByRole('dialog', { name: 'Move issue' })).toBeInTheDocument()
})

test('a viewer is offered no pick-up and no hole, and the card still opens', () => {
  harness.canWrite = false
  harness.rows = { 'teams.all': [TEAM], 'issues.byTeam': FILTER_FIXTURE }
  mount()

  pickUp('Alpha card')
  expect(cards().some((card) => card.dataset.dragging === 'true')).toBe(false)
  expect(document.querySelector('[data-slot="board-card"][data-in-flight]')).toBeNull()
  expect(document.querySelectorAll('[data-slot="board-drop-slot"]')).toHaveLength(0)

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
