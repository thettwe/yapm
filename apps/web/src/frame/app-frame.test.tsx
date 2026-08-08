import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

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
vi.mock('@/issues/issue-list', () => ({
  IssueList: () => <div data-testid="issue-list" />,
}))
vi.mock('@/issues/issue-detail', () => ({
  IssueDetail: () => null,
  IssueDetailPanel: () => null,
}))

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

function renderAt(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  zero.teams = []
  zero.cycles = []
  zero.issues = []
  zero.triage = []
  zero.deployments = []
  zero.notifications = []
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
  // The sync state is the one thing band 3 always knows.
  expect(screen.getByTestId('connection-status')).toBeInTheDocument()
})

// A workspace with no teams drops the six stops rather than offering doors onto nothing.
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
