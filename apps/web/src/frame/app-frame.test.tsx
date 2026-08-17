import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { RECOVERY_IDLE, SyncRecoveryContext, type SyncRecoveryValue } from '@/zero/recovery'

// THE FALSIFIABLE CHECK for the app frame. It renders the REAL `/teams/$teamId/issues` route — one
// of the ten that hand-rolled a sticky header of their own before this change — and asserts the
// three things the frame exists to make true: one deck, one statusline, and ONE attention number
// wherever the frame reports it.
//
// The work surface itself is stubbed. What is under test is the chrome the route sits in, not the
// list inside it (`issues/*.test.tsx` owns that).

interface Tagged {
  tag: 'teams' | 'cycles' | 'issues' | 'triage' | 'deployments' | 'workspace' | 'notifications'
}

const zero = vi.hoisted(() => ({
  teams: [] as unknown[],
  cycles: [] as unknown[],
  issues: [] as unknown[],
  triage: [] as unknown[],
  deployments: [] as unknown[],
  workspace: { id: 'workspace-1', name: 'Acme' } as unknown,
  notifications: [] as unknown[],
}))

vi.mock('@yapm/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yapm/schema')>()
  return {
    ...actual,
    queries: {
      workspace: { current: () => ({ tag: 'workspace' }) },
      teams: { all: () => ({ tag: 'teams' }) },
      cycles: { byTeam: () => ({ tag: 'cycles' }) },
      issues: { byTeam: () => ({ tag: 'issues' }) },
      triage: { inbox: () => ({ tag: 'triage' }) },
      deployments: { byTeam: () => ({ tag: 'deployments' }) },
      notifications: { mine: () => ({ tag: 'notifications' }) },
      members: { all: () => ({ tag: 'teams' }) },
    },
  }
})

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: Tagged | undefined) => {
    if (query === undefined) return [undefined, { type: 'unknown' }]
    return [zero[query.tag], { type: 'complete' }]
  },
  useZero: () => ({
    mutate: vi.fn(() => ({ client: Promise.resolve(), server: Promise.resolve() })),
  }),
}))

vi.mock('@/auth/client', () => ({
  signOut: vi.fn(),
  useSession: () => ({ data: { user: { name: 'Ada Lovelace', email: 'ada@example.test' } } }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({
    status: 'authenticated',
    userID: 'user-viewer',
    role: 'member',
    pmAudienceTeamIds: [],
    unavailable: false,
  }),
  useSyncControl: () => ({ retry: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/zero/connection', () => ({
  useConnectionSummary: () => ({
    state: 'connected',
    recovery: 'idle',
    label: 'Synced',
    writable: true,
    retryOffered: false,
  }),
}))

// The work surface, stubbed: this file is about the chrome around it.
vi.mock('@/triage/triage-view', () => ({
  TriageView: () => <div data-testid="triage-view" />,
}))
vi.mock('@/issues/issue-list', () => ({
  IssueList: () => <div data-testid="issue-list" />,
}))
vi.mock('@/issues/issue-detail', () => ({
  IssueDetail: () => null,
  IssueDetailPanel: () => null,
}))
// Band 2 belongs to the LENS, not to the route — the Board's masthead states the filtered count,
// so only the surface holding the filter can draw it. The stub therefore draws the real `Masthead`
// with the lens the route hands it, which is the whole of what this file asserts about that band.
vi.mock('@/board/board', async () => {
  const { Masthead } = await import('@/frame/masthead')
  return {
    Board: ({ lens }: { lens?: React.ReactNode }) => (
      <div data-testid="board">
        <Masthead title="Issues" lens={lens} />
      </div>
    ),
  }
})

import { routeTree } from '@/routeTree.gen'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.now()

const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering' }

// One exception in each of the four disjoint classes: done-in-git-not-on-the-board, checks failing,
// review waiting over a day, new in triage. Four, and it must read four everywhere.
function fourExceptions() {
  zero.teams = [TEAM]
  zero.cycles = [
    {
      id: 'cycle-2',
      number: 2,
      name: 'Cycle 2',
      status: 'active',
      startDate: NOW - 8 * DAY,
      endDate: NOW + 5 * DAY,
    },
  ]
  zero.issues = [
    {
      id: 'i-behind',
      number: 116,
      title: 'Saved cards behind a flag',
      status: 'in_progress',
      priority: 'medium',
      assigneeId: null,
      cycleId: 'cycle-2',
      createdAt: NOW - 10 * DAY,
      updatedAt: NOW - HOUR,
      issueLinks: [
        {
          pullRequest: {
            state: 'merged',
            openedAt: NOW - 3 * DAY,
            mergedAt: NOW - DAY,
            repo: 'acme/shop',
            mergeCommitSha: 'sha-behind',
          },
        },
      ],
    },
    {
      id: 'i-failing',
      number: 117,
      title: 'Checkout retries',
      status: 'in_progress',
      priority: 'medium',
      assigneeId: null,
      cycleId: 'cycle-2',
      createdAt: NOW - 9 * DAY,
      updatedAt: NOW - 2 * HOUR,
      issueLinks: [
        {
          pullRequest: {
            state: 'open',
            openedAt: NOW - 4 * HOUR,
            ciChecks: [{ conclusion: 'failure', updatedAt: NOW - 41 * 60 * 1000 }],
          },
        },
      ],
    },
    {
      id: 'i-waiting',
      number: 118,
      title: 'Address book',
      status: 'in_review',
      priority: 'medium',
      assigneeId: null,
      cycleId: 'cycle-2',
      createdAt: NOW - 9 * DAY,
      updatedAt: NOW - 3 * HOUR,
      issueLinks: [{ pullRequest: { state: 'open', openedAt: NOW - 31 * HOUR } }],
    },
  ]
  zero.triage = [{ id: 'triage-1', createdAt: NOW - HOUR }]
  zero.deployments = []
}

function renderAt(path: string, recovery?: SyncRecoveryValue) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const app = <RouterProvider router={router} />
  if (recovery === undefined) return render(app)
  return render(<SyncRecoveryContext.Provider value={recovery}>{app}</SyncRecoveryContext.Provider>)
}

function stubBrowserGlobals(): void {
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom ships neither; `cmdk` observes its list and Base UI measures its popup.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  // Owned rather than inherited: whether jsdom's `localStorage` survives depends on the Node the
  // runner is on (≥25 shadows it with an undefined-returning global), and the frame WRITES the
  // anchor on every team route — so on a runner that has it, one test's anchor would decide the
  // next test's stops. A fresh empty store per test instead.
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
}

// A route's first render in this process pays a cost its later ones do not. `autoCodeSplitting` is
// on in test mode too, so every route's `component` is a dynamic import: `RouterProvider` paints
// NOTHING until vite-node has transformed and evaluated the chunk behind it — the frame, the deck,
// the statusline, the palette and the UI library under them. The first is ~180ms against ~10ms for
// every later render in the same file; on a CI runner an order of magnitude slower it is seconds,
// and it used to be charged to the first assertion's `findBy` budget, which is how this file went
// red on CI while passing everywhere else. Every route the file visits is loaded here instead, so
// no assertion below is racing a module load — with the chunks warm each of them resolves on the
// first tick, which is the property this hook exists to buy.
beforeAll(async () => {
  stubBrowserGlobals()
  zero.teams = [TEAM]
  for (const path of ['/teams/team-1/issues', '/teams/team-1/board', '/inbox']) {
    renderAt(path)
    await screen.findByTestId('deck', undefined, { timeout: 20_000 })
    cleanup()
  }
})

beforeEach(() => {
  zero.teams = []
  zero.cycles = []
  zero.issues = []
  zero.triage = []
  zero.deployments = []
  zero.notifications = []
  stubBrowserGlobals()
})

test('every authenticated route renders one deck, one statusline, and one attention number', async () => {
  fourExceptions()
  renderAt('/teams/team-1/issues')

  // (a) The frame's two bands, once each — on a route that hand-rolled its own header before.
  expect(await screen.findByTestId('statusline')).toBeInTheDocument()
  expect(screen.getAllByTestId('statusline')).toHaveLength(1)
  expect(screen.getAllByTestId('deck')).toHaveLength(1)

  // (b) The deck badge and the statusline segment are the SAME number, from one derivation.
  const counts = screen.getAllByTestId('attention-count')
  expect(counts.length).toBeGreaterThanOrEqual(2)
  for (const count of counts) expect(count).toHaveTextContent('4')

  // (c) One current destination, and it is the one the route is.
  const nav = screen.getByRole('navigation', { name: 'Destinations' })
  expect(within(nav).getByRole('link', { name: 'Issues' })).toHaveAttribute('aria-current', 'page')
  const currents = within(nav)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page')
  expect(currents).toHaveLength(1)
})

// The four bar destinations, in the northstar's order. Below the deck's comfortable width the last
// two fold into `more▾` by CSS alone — jsdom applies no stylesheet, so what this asserts is the set
// the BAR offers, which is the thing a new route would quietly change. The other four destinations
// live in the menu's permanent list, and the test below opens it.
test('the deck’s bar carries four destinations and the transient, and nothing else', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/issues')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['Home', 'Issues', 'Cycles', 'Delivery'])
  // `more▾` is a transient, so a button rather than a link, and never current.
  const more = within(nav).getByRole('button')
  expect(more).toHaveTextContent('more')
  expect(more).not.toHaveAttribute('aria-current')
})

// The permanent list, at the test's default width. Triage is in it because nothing fills its inbox
// in the ordinary course of work — and it is in the PERMANENT group rather than the folding `Team`
// one so that `g t` is advertised at every width, which is the thing this test is really guarding.
test('the menu’s permanent list offers four destinations, each with its key', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/issues')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  fireEvent.click(within(nav).getByRole('button', { name: /more/i }))

  const permanent = await screen.findByRole('group', { name: 'More' })
  expect(
    within(permanent)
      .getAllByRole('menuitem')
      .map((item) => item.textContent),
  ).toEqual(['Triageg t', 'Retrosg r', 'Projectsg p', 'Roadmapg m'])
})

// Nothing asserted this for any menu destination before this change: a page reached from the menu
// marks the ITEM inside it, and the transient that opened it stays unmarked.
test('a menu destination is marked current, and the transient that holds it is not', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/triage')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  const more = within(nav).getByRole('button', { name: /more/i })
  expect(more).not.toHaveAttribute('aria-current')

  fireEvent.click(more)

  const permanent = await screen.findByRole('group', { name: 'More' })
  expect(within(permanent).getByRole('menuitem', { name: /triage/i })).toHaveAttribute(
    'aria-current',
    'page',
  )
  const currents = [
    ...within(nav).getAllByRole('link'),
    ...within(permanent).getAllByRole('menuitem'),
  ].filter((element) => element.getAttribute('aria-current') === 'page')
  expect(currents).toHaveLength(1)
})

// Design §D4, and the one part of "Two mornings read the same" that needs no browser: the same
// team, rendered over two data shapes. The badge's "zero is absence" rule stops at the badge — a
// count is a claim about a quantity and a destination is an offer of a place — so a morning with
// nothing waiting must offer what a morning with work waiting offers, in the same order. The badge
// is asserted in the same breath deliberately: it is what proves the two renders genuinely differ,
// without which the comparison below would hold for a reason that has nothing to do with D4.
async function destinationsOffered(): Promise<{ bar: (string | null)[]; menu: (string | null)[] }> {
  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  const bar = within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent)
  fireEvent.click(within(nav).getByRole('button', { name: /more/i }))
  const permanent = await screen.findByRole('group', { name: 'More' })
  const menu = within(permanent)
    .getAllByRole('menuitem')
    .map((item) => item.textContent)
  return { bar, menu }
}

test('a morning with nothing waiting offers the destinations a busy one does, in the same order', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/issues')
  expect(await screen.findByTestId('deck')).toBeInTheDocument()
  expect(screen.queryByTestId('attention-badge')).toBeNull()
  const quiet = await destinationsOffered()

  cleanup()
  fourExceptions()
  renderAt('/teams/team-1/issues')
  expect(await screen.findByTestId('attention-badge')).toBeInTheDocument()
  const busy = await destinationsOffered()

  expect(quiet).toEqual(busy)
  expect(quiet.menu).toContain('Triageg t')
})

// The right cluster's three doorways — the ones the nine hand-rolled headers silently dropped, so
// that search, digests and the inbox were invisible on exactly the surfaces being overhauled.
test('the deck’s right cluster carries search, the attention badge and the inbox on every page', async () => {
  fourExceptions()
  renderAt('/teams/team-1/issues')

  const deck = await screen.findByTestId('deck')
  // Search is a real link, so it is in the tab order and reachable with no pointer and no palette.
  expect(within(deck).getByTestId('search-entry')).toHaveAttribute('href', '/search')
  expect(within(deck).getByTestId('inbox-badge')).toBeInTheDocument()
  // The badge says what its number counts, rather than leaving a bare digit to a screen reader.
  expect(within(deck).getByTestId('attention-badge')).toHaveAccessibleName(
    '4 issues need attention',
  )
})

// Board is a LENS on Issues, not a seventh stop. The bar may not claim two current pages, so the
// route keeps Issues current and the toggle carries which lens is on.
test('on Board the Issues stop stays current and the lens says which one is on', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/board')

  expect(await screen.findByTestId('board')).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Destinations' })
  expect(within(nav).getByRole('link', { name: 'Issues' })).toHaveAttribute('aria-current', 'page')
  expect(
    within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page'),
  ).toHaveLength(1)

  const masthead = screen.getByTestId('masthead')
  expect(within(masthead).getByRole('link', { name: 'Board' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(within(masthead).getByRole('link', { name: 'List' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
})

// A remembered team the caller has since lost access to would otherwise leave every destination
// pointing at a 404. The anchor is re-validated against the synced list on every read, not trusted once.
test('a stale remembered team is dropped and the stops fall back to one that exists', async () => {
  zero.teams = [TEAM]
  vi.stubGlobal('localStorage', {
    getItem: () => 'team-gone',
    setItem: () => {},
  })

  renderAt('/inbox')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  expect(within(nav).getByRole('link', { name: 'Issues' })).toHaveAttribute(
    'href',
    '/teams/team-1/issues',
  )
  vi.unstubAllGlobals()
})

test('at zero the badge and the attention segment are absent, not zeroed', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/issues')

  expect(await screen.findByTestId('statusline')).toBeInTheDocument()
  expect(screen.queryByTestId('attention-badge')).toBeNull()
  expect(screen.queryByTestId('statusline-attention')).toBeNull()
  expect(screen.queryAllByTestId('attention-count')).toHaveLength(0)
})

// Design §D3 — the deck MAY point at a team; the statusline may only report one.
test('off-team the stops still point somewhere useful and the statusline claims nothing', async () => {
  fourExceptions()
  renderAt('/inbox')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  expect(within(nav).getByRole('link', { name: 'Issues' })).toHaveAttribute(
    'href',
    '/teams/team-1/issues',
  )
  expect(
    within(nav)
      .getAllByRole('link')
      .filter((link) => link.getAttribute('aria-current') === 'page'),
  ).toHaveLength(0)

  expect(screen.queryByTestId('statusline-cycle')).toBeNull()
  expect(screen.queryByTestId('statusline-shipped')).toBeNull()
  expect(screen.queryByTestId('statusline-deploys')).toBeNull()
  expect(screen.queryByTestId('statusline-attention')).toBeNull()
  expect(screen.queryByTestId('attention-badge')).toBeNull()
  // Saying nothing is not saying nothing at all: the workspace and the sync state are the two
  // facts band 3 still has off-team, and §D3 has it state both.
  expect(screen.getByTestId('statusline-workspace')).toHaveTextContent('Acme')
  expect(screen.getByTestId('connection-status')).toBeInTheDocument()
})

// On a team the deck's switcher names the workspace, and band 3 reports the team's day instead —
// the workspace name would be the one fact in the line that is not about the team.
test('with a team in context the statusline reports the team, not the workspace', async () => {
  fourExceptions()
  renderAt('/teams/team-1/issues')

  expect(await screen.findByTestId('statusline-cycle')).toBeInTheDocument()
  expect(screen.queryByTestId('statusline-workspace')).toBeNull()
})

// The one segment that used to read "1 need attention" — band 3 counts in English or it is not
// labels, it is a template.
test('the attention segment agrees with its own number at one', async () => {
  zero.teams = [TEAM]
  zero.triage = [{ id: 'triage-1', createdAt: NOW - HOUR }]
  renderAt('/teams/team-1/issues')

  expect(await screen.findByTestId('statusline-attention')).toHaveTextContent('1 needs attention')
})

// The always-present group is what makes ⌘K honest on a page that registers nothing of its own.
// Appearance is in it because §D8 folded the theme controls into the account menu: a setting with
// exactly one door is a setting the keyboard cannot reach.
test('the frame’s own palette carries appearance alongside the destinations', async () => {
  zero.teams = [TEAM]
  renderAt('/inbox')
  await screen.findByTestId('deck')

  await act(async () => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })

  const palette = await screen.findByTestId('frame-palette')
  expect(within(palette).getByText('Appearance')).toBeInTheDocument()
  expect(within(palette).getByText('Search everything')).toBeInTheDocument()
  expect(within(palette).getByText('Go to inbox')).toBeInTheDocument()
  // The retry is conditional on the offer, not always-present: with sync idle it is not a command.
  expect(within(palette).queryByText('Retry sync now')).toBeNull()
})

// §DI-20 — band 3 is the LAST thing in the document, so the retry control that used to sit in the
// header now costs a keyboard-only reader every Tab stop on the page. The palette is the route to it
// whose length does not depend on the page's, and it is the whole mitigation, so it gets an
// assertion: the command appears exactly while the offer stands, and selecting it retries.
test('while sync offers a retry the palette carries it, and selecting it retries', async () => {
  zero.teams = [TEAM]
  const retryNow = vi.fn()
  renderAt('/inbox', {
    ...RECOVERY_IDLE,
    phase: 'waiting',
    attempt: 4,
    delayMs: 16_000,
    retryOffered: true,
    retryNow,
  })
  await screen.findByTestId('deck')

  await act(async () => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })

  const palette = await screen.findByTestId('frame-palette')
  await act(async () => {
    fireEvent.click(within(palette).getByText('Retry sync now'))
  })
  expect(retryNow).toHaveBeenCalledTimes(1)
})

// A workspace with no teams drops the destinations rather than offering doors onto nothing.
test('a workspace with no teams drops the stops entirely', async () => {
  renderAt('/inbox')

  expect(await screen.findByTestId('deck')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Destinations' })).toBeNull()
})

// The `g`-prefix go-to grammar the deck advertises in `more▾`. Keyboard-first is not negotiable,
// and the guard against firing while somebody is typing is the half that is easy to lose.
test('the g-prefix shortcuts reach a destination, and never while a field holds the keyboard', async () => {
  zero.teams = [TEAM]
  renderAt('/inbox')
  await screen.findByTestId('deck')

  await act(async () => {
    fireEvent.keyDown(window, { key: 'g' })
    fireEvent.keyDown(window, { key: 'i' })
  })
  expect(await screen.findByTestId('issue-list')).toBeInTheDocument()

  // Typing "g" then "i" into a field is two letters of a word, not a jump.
  const field = document.createElement('input')
  document.body.append(field)
  field.focus()
  await act(async () => {
    fireEvent.keyDown(field, { key: 'g' })
    fireEvent.keyDown(field, { key: 'h' })
  })
  expect(screen.getByTestId('issue-list')).toBeInTheDocument()
  field.remove()
})

// `more▾` is a transient, never a destination: it opens, it is escapable, and it hands focus back.
test('the more menu opens, lists what folded away, and Escape returns focus to its trigger', async () => {
  zero.teams = [TEAM]
  renderAt('/teams/team-1/issues')

  const nav = await screen.findByRole('navigation', { name: 'Destinations' })
  const trigger = within(nav).getByRole('button')
  fireEvent.click(trigger)

  expect(await screen.findByRole('menuitem', { name: /^Retros/u })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /^Projects/u })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: /^Roadmap/u })).toBeInTheDocument()
  // Decisions is drawn in the mock's open menu and folds away here: no entity backs it, and a
  // disabled row is chrome promising what the product cannot keep.
  expect(screen.queryByRole('menuitem', { name: /^Decisions/u })).toBeNull()

  fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
  await waitFor(() => expect(trigger).toHaveFocus())
})
