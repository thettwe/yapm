import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The page is a pure render over `buildTeamHome` (the model has its own unit suite in
// @yapm/schema), so what this file proves is the rendering contract: the eight reads arrive, the
// bands appear in the mock's order, the ONE attention number is identical at every DOM occurrence,
// every doorway is a real link with an accessible name, and the quiet fixture folds bands instead
// of apologising for them.

interface Tagged {
  tag:
    | 'teams'
    | 'cycles'
    | 'issues'
    | 'triage'
    | 'deployments'
    | 'retros'
    | 'notifications'
    | 'digest'
}

const zero = vi.hoisted(() => ({
  teams: [] as unknown[],
  cycles: [] as unknown[],
  issues: [] as unknown[],
  triage: [] as unknown[],
  deployments: [] as unknown[],
  retros: [] as unknown[],
  notifications: [] as unknown[],
  digest: undefined as unknown,
}))

vi.mock('@yapm/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yapm/schema')>()
  return {
    ...actual,
    queries: {
      teams: { all: () => ({ tag: 'teams' }) },
      cycles: { byTeam: () => ({ tag: 'cycles' }) },
      issues: { byTeam: () => ({ tag: 'issues' }) },
      triage: { inbox: () => ({ tag: 'triage' }) },
      deployments: { byTeam: () => ({ tag: 'deployments' }) },
      retros: { byTeam: () => ({ tag: 'retros' }) },
      notifications: { mine: () => ({ tag: 'notifications' }) },
      digests: { byCycle: () => ({ tag: 'digest' }) },
    },
  }
})

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: Tagged | undefined) => {
    if (query === undefined) return [undefined, { type: 'unknown' }]
    return [zero[query.tag], { type: 'complete' }]
  },
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({
    status: 'authenticated',
    userID: VIEWER,
    role: 'member',
    pmAudienceTeamIds: [],
    unavailable: false,
  }),
}))

import { TeamHome } from './team-home'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const VIEWER = 'user-viewer'
const NOW = Date.now()

const team = { id: 'team-1', key: 'ENG', name: 'Engineering' }
const activeCycle = {
  id: 'cycle-2',
  number: 2,
  name: 'Cycle 2',
  status: 'active',
  startDate: NOW - 8 * DAY,
  endDate: NOW + 5 * DAY,
}

function issue(
  over: Record<string, unknown> & { id: string; number: number; title: string; status: string },
) {
  return {
    priority: 'medium',
    assigneeId: null,
    cycleId: activeCycle.id,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - HOUR,
    ...over,
  }
}

// The falsifiable morning: 1 status_behind_merge + 1 checks-failing + 2 waiting > 24h + 3 triage
// rows = attention 7, with the failing issue ALSO carrying an open PR past a day so it matches two
// classes and must be counted once.
function fullMorning() {
  zero.teams = [team]
  zero.cycles = [activeCycle]
  zero.issues = [
    issue({
      id: 'i-behind',
      number: 116,
      title: 'Saved cards behind a flag',
      status: 'in_progress',
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
    }),
    issue({
      id: 'i-failing',
      number: 115,
      title: 'Retry failed webhook deliveries',
      status: 'in_progress',
      issueLinks: [
        {
          pullRequest: {
            state: 'open',
            openedAt: NOW - 30 * HOUR,
            ciChecks: [
              { conclusion: 'success', updatedAt: NOW - 2 * HOUR },
              { conclusion: 'failure', updatedAt: NOW - 41 * 60 * 1000 },
            ],
          },
        },
      ],
    }),
    issue({
      id: 'i-wait-a',
      number: 121,
      title: 'Split shipping addresses',
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [{ pullRequest: { state: 'open', openedAt: NOW - 31 * HOUR } }],
    }),
    issue({
      id: 'i-wait-b',
      number: 122,
      title: 'Order status page for guests',
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [{ pullRequest: { state: 'open', openedAt: NOW - 26 * HOUR } }],
    }),
    issue({
      id: 'i-mine-approved',
      number: 117,
      title: 'Rate-limit the coupon endpoint',
      status: 'in_review',
      assigneeId: VIEWER,
      updatedAt: NOW - HOUR,
      issueLinks: [
        {
          pullRequest: {
            state: 'open',
            openedAt: NOW - 2 * DAY,
            ciChecks: [{ conclusion: 'success', updatedAt: NOW - 10 * HOUR }],
            reviews: [{ state: 'approved', submittedAt: NOW - 9 * HOUR }],
          },
        },
      ],
    }),
    issue({
      id: 'i-mine-progress',
      number: 113,
      title: 'Promo banner scheduling',
      status: 'in_progress',
      assigneeId: VIEWER,
      updatedAt: NOW - 2 * HOUR,
    }),
    issue({
      id: 'i-mine-waiting',
      number: 118,
      title: 'Empty cart state',
      status: 'in_review',
      assigneeId: VIEWER,
      updatedAt: NOW - 3 * HOUR,
      issueLinks: [{ pullRequest: { state: 'open', openedAt: NOW - 16 * HOUR } }],
    }),
    issue({
      id: 'i-runway-urgent',
      number: 120,
      title: 'Migrate legacy coupon codes',
      status: 'todo',
      priority: 'urgent',
    }),
    issue({ id: 'i-runway-planned', number: 124, title: 'Refund receipt email', status: 'todo' }),
    issue({
      id: 'i-live',
      number: 112,
      title: 'Order history search',
      status: 'done',
      issueLinks: [
        {
          pullRequest: {
            state: 'merged',
            openedAt: NOW - 3 * DAY,
            mergedAt: NOW - 2 * DAY,
            repo: 'acme/shop',
            mergeCommitSha: 'sha-live',
          },
        },
      ],
    }),
    issue({
      id: 'i-built',
      number: 110,
      title: 'Gift wrap option at checkout',
      status: 'done',
      issueLinks: [
        {
          pullRequest: {
            state: 'merged',
            openedAt: NOW - 3 * DAY,
            mergedAt: NOW - 2 * DAY,
            repo: 'acme/shop',
            mergeCommitSha: 'sha-unshipped',
          },
        },
      ],
    }),
  ]
  zero.triage = [
    { id: 'triage-1', createdAt: NOW - HOUR },
    { id: 'triage-2', createdAt: NOW - 2 * HOUR },
    { id: 'triage-3', createdAt: NOW - 3 * HOUR },
  ]
  zero.deployments = [
    { repo: 'acme/shop', sha: 'sha-live', environment: 'production', deployedAt: NOW - 10 * HOUR },
    { repo: 'acme/shop', sha: 'sha-older', environment: 'production', deployedAt: NOW - 8 * DAY },
  ]
  zero.retros = [
    { id: 'retro-open', title: 'Mid-cycle retro', phase: 'brainstorm', closedAt: null },
    {
      id: 'retro-closed',
      cycleId: activeCycle.id,
      title: 'Cycle 1 retro',
      phase: 'closed',
      closedAt: NOW - DAY,
    },
  ]
  zero.notifications = [
    {
      kind: 'mention',
      teamId: team.id,
      subjectKey: 'ENG-142',
      subjectTitle: 'Checkout flow',
      readAt: null,
      createdAt: NOW - 2 * HOUR,
    },
  ]
  zero.digest = undefined
}

function quietMorning() {
  zero.teams = [team]
  zero.cycles = [activeCycle]
  zero.issues = []
  zero.triage = []
  zero.deployments = []
  zero.retros = []
  zero.notifications = []
  zero.digest = undefined
}

// Every doorway target the page links to, registered as a stub so hrefs resolve exactly the way
// the real route tree resolves them.
const DOORWAY_TARGETS = [
  '/teams/$teamId/members',
  '/teams/$teamId/issues',
  '/teams/$teamId/issues/$issueKey',
  '/teams/$teamId/board',
  '/teams/$teamId/triage',
  '/teams/$teamId/delivery',
  '/teams/$teamId/retros',
  '/teams/$teamId/retros/$retroId',
  '/teams/$teamId/roadmap',
  '/teams/$teamId/cycles',
  '/inbox',
] as const

async function mount() {
  const rootRoute = createRootRoute()
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/teams/$teamId',
    component: function Home() {
      const { teamId } = homeRoute.useParams()
      return <TeamHome teamId={teamId} />
    },
  })
  const stubs = DOORWAY_TARGETS.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <div /> }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([homeRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/teams/team-1'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { level: 1 })
}

beforeEach(() => {
  quietMorning()
})

test('the full morning renders every band in the mock order with the hero spread', async () => {
  fullMorning()
  await mount()

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cycle 2')
  expect(screen.getByText(/Day 9 of 14 · ends \w+/)).toBeInTheDocument()
  expect(screen.getByText('2 shipped')).toBeInTheDocument()

  const bands = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
  expect(bands).toEqual([
    'NEEDS ATTENTION',
    'SINCE YESTERDAY',
    'YOURS',
    'READY FOR YOU',
    'SHIP CADENCE',
    'SHIPPED THIS CYCLE',
  ])

  // The vitals column: scope against the plan and the open retro under NEXT, with no invented time.
  expect(screen.getByText('SCOPE · AGAINST ITS PLAN')).toBeInTheDocument()
  const next = screen.getByRole('link', { name: /Mid-cycle retro/ })
  expect(next).toHaveAttribute('href', '/teams/team-1/retros/retro-open')
  expect(next.textContent).not.toMatch(/\d:\d\d/)
  expect(screen.getByText('5 days left in the cycle')).toBeInTheDocument()
})

test('the one attention number is identical at every DOM occurrence', async () => {
  fullMorning()
  await mount()

  const occurrences = screen.getAllByTestId('attention-count')
  expect(occurrences.length).toBeGreaterThanOrEqual(2)
  for (const occurrence of occurrences) {
    expect(occurrence).toHaveTextContent(/^7$/)
  }
  expect(screen.getByText('need attention', { exact: false })).toBeInTheDocument()
})

test('every attention class row is a doorway with its evidence', async () => {
  fullMorning()
  await mount()

  const divergence = screen.getByRole('link', { name: /done in git, not on the board/ })
  expect(divergence).toHaveAttribute('href', '/teams/team-1/issues/ENG-116')
  expect(divergence).toHaveTextContent('ENG-116')

  const waiting = screen.getByRole('link', { name: /waiting on review over a day/ })
  expect(waiting).toHaveAttribute('href', '/teams/team-1/board')
  expect(waiting).toHaveTextContent('31h · 26h')

  const failing = screen.getByRole('link', { name: /Checks failing on/ })
  expect(failing).toHaveAttribute('href', '/teams/team-1/issues/ENG-115')
  expect(failing).toHaveTextContent('red 41m')

  const triage = screen.getByRole('link', { name: /new in triage/ })
  expect(triage).toHaveAttribute('href', '/teams/team-1/triage')
})

test('YOURS carries the bifact rows, the collapsed waiting line and a folded lens definition', async () => {
  fullMorning()
  await mount()

  const approved = screen.getByRole('link', { name: /Rate-limit the coupon endpoint/ })
  expect(approved).toHaveAttribute('href', '/teams/team-1/issues/ENG-117')
  expect(approved).toHaveTextContent('Approved — merge when ready')
  expect(approved).toHaveTextContent('checks green · approved 9h')

  expect(screen.getByText('1 of yours is waiting on others')).toBeInTheDocument()
  expect(screen.getByText(/review 16h/)).toBeInTheDocument()
  // Two of the team's PRs still await review, so the reciprocal line must NOT render.
  expect(screen.queryByText(/No reviews owed/)).toBeNull()
  // The lens definition is a derivation: absent from the DOM at rest, one keystroke away. The
  // guarantee it states is structural and holds whether the panel is open or shut.
  expect(screen.queryByText(/your work only — never compared/)).toBeNull()
  expect(screen.queryByText(/^yours =/)).toBeNull()

  // Reached and activated from the keyboard alone. The trigger is a native <button>, so Enter and
  // Space raise the click this fires — jsdom does not synthesize that translation, and asserting a
  // bare `keyDown(' ')` here would assert jsdom's gap rather than the control's behaviour. The
  // native half is proven once, on the component:
  // `packages/ui/src/components/how.test.tsx` — "the trigger is a real button, so Enter and Space
  // open it natively".
  const trigger = screen.getByRole('button', { name: 'How yours is derived' })
  trigger.focus()
  fireEvent.click(trigger)
  const panel = screen.getByRole('dialog')
  expect(panel.textContent).toContain('assigned to you')
  expect(panel.textContent).toContain('your work only — never compared')

  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(screen.queryByText(/your work only — never compared/)).toBeNull()
  expect(document.activeElement).toBe(trigger)
})

test('the YOURS header slot holds the doorway or the lens affordance, never both', async () => {
  // One slot, two candidates: the Runway doorway renders only while YOURS is empty, and the lens
  // affordance only while it has rows. Asserted rather than reasoned about.
  fullMorning()
  zero.issues = (zero.issues as { id: string }[]).filter(
    (row) => !row.id.startsWith('i-mine'),
  ) as unknown[]
  await mount()

  const runway = screen.getByRole('link', { name: /Runway/ })
  expect(runway).toHaveAttribute('href', '#ready-for-you')
  expect(screen.queryByRole('button', { name: 'How yours is derived' })).toBeNull()
})

test('SINCE YESTERDAY cards carry provenance lines and doorways', async () => {
  fullMorning()
  await mount()

  expect(screen.getByText('OVERNIGHT')).toBeInTheDocument()
  expect(screen.getByText('1 release went live · production')).toBeInTheDocument()
  const overnight = screen.getByRole('link', { name: /Order history search.*release/s })
  expect(overnight).toHaveAttribute('href', '/teams/team-1/delivery?window=6')

  expect(screen.getByText('YOUR REVIEW')).toBeInTheDocument()
  expect(screen.getByText(/ENG-117 · 9h ago · on your issues/)).toBeInTheDocument()

  expect(screen.getByText('INBOX')).toBeInTheDocument()
  expect(screen.getByText('1 unread in the last day')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /ENG-142/ })).toHaveAttribute('href', '/inbox')
})

test('the runway lists only clear starts with predicate phrases, urgent first', async () => {
  fullMorning()
  await mount()

  const urgent = screen.getByRole('link', { name: /Migrate legacy coupon codes/ })
  expect(urgent).toHaveTextContent('Urgent — nothing blocks a start')
  const planned = screen.getByRole('link', { name: /Refund receipt email/ })
  expect(planned).toHaveTextContent('Committed at planning')
  expect(urgent.compareDocumentPosition(planned) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

test('the Live badge appears only with a matching deployment', async () => {
  fullMorning()
  await mount()

  const shipped = screen.getByRole('heading', { name: 'SHIPPED THIS CYCLE' }).parentElement
    ?.parentElement
  expect(shipped).not.toBeNull()
  const rows = within(shipped as HTMLElement)
  expect(rows.getByText('Order history search').parentElement).toHaveTextContent(/Live/)
  expect(rows.getByText('Gift wrap option at checkout').parentElement).toHaveTextContent(
    'Built — not live',
  )
  expect(rows.getAllByText('Live')).toHaveLength(1)
})

test('a quiet morning folds attention, since-yesterday and ready away and warms YOURS', async () => {
  await mount()

  expect(screen.queryByText('NEEDS ATTENTION')).toBeNull()
  expect(screen.queryByText('SINCE YESTERDAY')).toBeNull()
  expect(screen.queryByText('READY FOR YOU')).toBeNull()
  expect(screen.queryByText('SHIP CADENCE')).toBeNull()
  expect(screen.queryByText('SHIPPED THIS CYCLE')).toBeNull()
  expect(screen.queryByTestId('attention-count')).toBeNull()

  expect(screen.getByText(/Nothing held, nothing owed/)).toBeInTheDocument()
  // Empty YOURS and no READY band: the slot holds neither the doorway nor the lens affordance.
  expect(screen.queryByRole('button', { name: 'How yours is derived' })).toBeNull()

  // The composition record is read, not printed — and on a fully folded day it must still name the
  // folding, and name nothing the render did not do.
  expect(screen.queryByText(/composed =/)).toBeNull()
  expect(screen.queryByText(/empty bands fold away/)).toBeNull()

  // Native activation, as above: the click is what Enter and Space raise on a real <button>, and
  // `how.test.tsx` owns the proof that this trigger is one.
  const foot = screen.getByRole('button', { name: 'How this page is derived' })
  foot.focus()
  fireEvent.click(foot)
  const panel = screen.getByRole('dialog')
  expect(panel.textContent).toContain('empty bands fold away')
  expect(panel.textContent).not.toContain('attention first')

  fireEvent.keyDown(panel, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(foot)
})

test('the empty-YOURS warmth line drops the "nothing owed" claim while a review is owed', async () => {
  // Empty YOURS, but a teammate's open unapproved PR means reviews ARE owed team-wide — the
  // warmth line must not claim otherwise.
  zero.issues = [
    issue({
      id: 'i-other-open',
      number: 130,
      title: 'Inventory sync retries',
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [{ pullRequest: { state: 'open', openedAt: NOW - 2 * HOUR } }],
    }),
  ]
  await mount()

  expect(screen.getByText(/Nothing held\./)).toBeInTheDocument()
  expect(screen.queryByText(/nothing owed/)).toBeNull()
})

test('with no active cycle the hero degrades to the team name and a Cycles doorway', async () => {
  zero.cycles = []
  await mount()

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Engineering')
  expect(screen.getByText(/No cycle is running/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Cycles' })).toHaveAttribute(
    'href',
    '/teams/team-1/cycles',
  )
})

test('the onward footer keeps the e2e contract and every doorway has an accessible name', async () => {
  fullMorning()
  await mount()

  expect(screen.getByRole('link', { name: 'Issues' })).toHaveAttribute(
    'href',
    '/teams/team-1/issues',
  )
  expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/teams/team-1/board')
  expect(screen.getByRole('link', { name: 'Members' })).toHaveAttribute(
    'href',
    '/teams/team-1/members',
  )
  expect(screen.getByRole('link', { name: 'Retro' })).toHaveAttribute(
    'href',
    '/teams/team-1/retros',
  )
  expect(screen.getByRole('link', { name: 'Roadmap' })).toHaveAttribute(
    'href',
    '/teams/team-1/roadmap',
  )

  for (const link of screen.getAllByRole('link')) {
    expect(link).toHaveAttribute('href')
    expect((link.getAttribute('href') ?? '').length).toBeGreaterThan(0)
    expect(
      (link.textContent ?? '').trim().length,
      'every doorway carries an accessible name',
    ).toBeGreaterThan(0)
  }
})
