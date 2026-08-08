import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { buildRetroSeed, type DeliveryWindowSize } from '@yapm/schema'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'

// The page is a pure render over `buildDeliveryPage` (the model has its own unit suite in
// @yapm/schema), so what this file proves is the RENDERING contract: the sections appear in the
// mock's order, every derived number carries a `how ·` that opens and folds, the one peek behaves
// like a peek, the honesty statement is one line plus `more ·`, and nothing on the page offers a
// per-person reading.
//
// Nothing here re-states a number the model computed. Every count asserted below is read off the
// page or off the fixture handed in.

interface Tagged {
  tag: 'teams' | 'cycles' | 'issues' | 'deployments' | 'retros'
}

const zero = vi.hoisted(() => ({
  teams: [] as unknown[],
  cycles: [] as unknown[],
  issues: [] as unknown[],
  deployments: [] as unknown[],
  retros: [] as unknown[],
  // Every read this view makes, counted — the load-bearing claim about changing the window is that
  // it issues none.
  reads: 0,
}))

vi.mock('@yapm/schema', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@yapm/schema')>()
  return {
    ...actual,
    queries: {
      teams: { all: () => ({ tag: 'teams' }) },
      cycles: { byTeam: () => ({ tag: 'cycles' }) },
      issues: { byTeam: () => ({ tag: 'issues' }) },
      deployments: { byTeam: () => ({ tag: 'deployments' }) },
      retros: { byTeam: () => ({ tag: 'retros' }) },
    },
  }
})

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: Tagged) => {
    zero.reads += 1
    return [zero[query.tag], { type: 'complete' }]
  },
}))

import { DeliveryView } from './delivery-view'
import { MetricSection } from './metric-tiles'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.now()

const TEAM = { id: 'team-1', key: 'ENG', name: 'Platform' }

const ACTIVE = {
  id: 'c-active',
  number: 13,
  name: 'Cycle 13',
  status: 'active',
  startDate: NOW - 8 * DAY,
  endDate: NOW + 5 * DAY,
}

// Twelve completed cycles, so a 6-cycle window always has a full preceding window behind it and
// every delta is real rather than absent.
function completedCycles() {
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1
    const start = NOW - (8 + (13 - number) * 14) * DAY
    return {
      id: `c${number}`,
      number,
      name: `Cycle ${number}`,
      status: 'completed',
      startDate: start,
      endDate: start + 13 * DAY,
    }
  })
}

function pr(over: Record<string, unknown> & { id: string; openedAt: number }) {
  return {
    state: 'merged',
    repo: 'acme/shop',
    mergeCommitSha: `sha-${over.id}`,
    ciChecks: [{ conclusion: 'success' }],
    reviews: [{ state: 'approved', submittedAt: over.openedAt + 3 * HOUR, author: 'octocat' }],
    ...over,
  }
}

// Two shipped changes per completed cycle, one carried item, one added mid-cycle, one issue with no
// linked change at all, and one change carrying a failing check — enough for all twelve metric
// definitions to have something behind them.
function issues() {
  const rows: Record<string, unknown>[] = []
  for (const cycle of completedCycles()) {
    for (const slot of [0, 1]) {
      const opened = cycle.startDate + (slot + 1) * DAY
      rows.push({
        id: `${cycle.id}-i${slot}`,
        number: rows.length + 1,
        title: `Shipped ${cycle.id}-${slot}`,
        status: 'done',
        cycleId: cycle.id,
        assigneeId: 'user-1',
        creatorId: 'user-2',
        issueLinks: [
          {
            pullRequest: pr({
              id: `${cycle.id}-pr${slot}`,
              openedAt: opened,
              mergedAt: opened + (slot === 0 ? 8 : 30) * HOUR,
              ...(slot === 1 ? { ciChecks: [{ conclusion: 'failure' }] } : {}),
            }),
          },
        ],
      })
    }
    rows.push({
      id: `${cycle.id}-late`,
      number: rows.length + 1,
      title: `Arrived late in ${cycle.id}`,
      status: 'done',
      cycleId: cycle.id,
      cycleAssignedAt: cycle.startDate + 4 * DAY,
    })
    rows.push({
      id: `${cycle.id}-unlinked`,
      number: rows.length + 1,
      title: `No change linked in ${cycle.id}`,
      status: 'todo',
      cycleId: cycle.id,
    })
  }
  // The rollover: carried out of cycle 11 and into cycle 12, so the flow band has a ribbon to draw.
  rows.push({
    id: 'carried',
    number: rows.length + 1,
    title: 'Carried into the next cycle',
    status: 'done',
    cycleId: 'c12',
    rolledOverFromCycleId: 'c11',
    carryoverCount: 1,
  })
  // The divergence the one peek is about: merged in git, still in progress on the board, and no
  // deployment carries its merge commit.
  rows.push({
    id: 'i-behind',
    number: 116,
    title: 'Apple Pay in the payment sheet',
    status: 'in_progress',
    cycleId: ACTIVE.id,
    assigneeId: 'user-1',
    issueLinks: [
      {
        pullRequest: pr({
          id: 'pr-behind',
          openedAt: NOW - 6 * DAY,
          mergedAt: NOW - 4 * DAY,
          mergeCommitSha: 'sha-behind',
        }),
      },
    ],
  })
  return rows
}

function deployments() {
  return [1, 3, 4, 4, 6].map((day, index) => ({
    id: `d${index + 1}`,
    repo: 'acme/shop',
    sha: `deployed-${index + 1}`,
    ref: index === 2 ? 'checkout-v2' : null,
    environment: 'production',
    deployedAt: ACTIVE.startDate + day * DAY,
    updatedAt: ACTIVE.startDate + day * DAY,
  }))
}

beforeEach(() => {
  zero.reads = 0
  zero.teams = [TEAM]
  zero.cycles = [...completedCycles(), ACTIVE]
  zero.issues = issues()
  zero.deployments = deployments()
  zero.retros = [
    {
      id: 'r1',
      cycleId: ACTIVE.id,
      title: 'Cycle 12 retrospective',
      closedAt: ACTIVE.startDate + 2 * DAY,
    },
  ]
})

const DOORWAY_TARGETS = ['/teams/$teamId/issues/$issueKey'] as const

async function mount(initial: DeliveryWindowSize = 6, onSizeChange = vi.fn()) {
  const rootRoute = createRootRoute()
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/teams/$teamId/delivery',
    component: function Page() {
      const { teamId } = page.useParams()
      const [size, setSize] = useState<DeliveryWindowSize>(initial)
      return (
        <DeliveryView
          teamId={teamId}
          size={size}
          onSizeChange={(next) => {
            onSizeChange(next)
            setSize(next)
          }}
        />
      )
    },
  })
  const stubs = DOORWAY_TARGETS.map((path) =>
    createRoute({ getParentRoute: () => rootRoute, path, component: () => <div /> }),
  )
  const router = createRouter({
    routeTree: rootRoute.addChildren([page, ...stubs]),
    history: createMemoryHistory({ initialEntries: ['/teams/team-1/delivery'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByTestId('masthead')
  return { onSizeChange, router }
}

test('renders the mock order: the timeline, the four readings, the three drawn sections and the honesty line', async () => {
  await mount()

  expect(screen.getByTestId('delivery-timeline')).toBeInTheDocument()

  const readings = screen.getAllByTestId('delivery-stat')
  expect(readings.map((tile) => tile.getAttribute('data-metric'))).toEqual([
    'shipped',
    'pr_cycle_time',
    'ci_failing_rate',
    'issues_without_pr',
  ])

  const sections = screen.getAllByTestId('delivery-drawn-section')
  expect(sections.map((section) => section.getAttribute('data-section'))).toEqual([
    'open-to-merged',
    'cycle-flow',
    'review-rhythm',
  ])
  // Every section leads with a sentence stating what the data says — the one place on a work
  // surface where a full sentence is allowed.
  for (const section of sections) {
    const sentence = within(section as HTMLElement).getByTestId('delivery-standfirst-sentence')
    expect(sentence.textContent ?? '').toMatch(/\.$/)
  }

  expect(screen.getByTestId('delivery-honesty')).toBeInTheDocument()
})

test('the standfirst names the cycle in progress, the window and the binding rule — once', async () => {
  await mount()

  const standfirst = screen.getByTestId('delivery-standfirst')
  expect(standfirst).toHaveTextContent('Cycle 13')
  expect(standfirst).toHaveTextContent('last 6 completed cycles')
  expect(standfirst).toHaveTextContent('team-level only — never a per-person number')
  // `ia.html`: the rule appears exactly ONCE in the entire product, and this is the page.
  expect(screen.getAllByText(/never a per-person number/)).toHaveLength(1)
})

test('every derived number carries a how · that opens, and Escape folds it and returns focus', async () => {
  await mount()

  const readings = screen.getAllByTestId('delivery-stat')
  for (const reading of readings) {
    expect(
      within(reading as HTMLElement).getByRole('button', { name: /^How .* is derived$/ }),
    ).toBeInTheDocument()
  }

  const trigger = within(readings[0] as HTMLElement).getByRole('button', {
    name: /^How .* is derived$/,
  })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(trigger)
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Escape' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(document.activeElement).toBe(trigger)
})

// The only interactive control on the page. `Number(event.target.value)` is the whole of it, and a
// string leaking through would slice the window array by a string and clamp somewhere surprising.
test('reports the chosen window as a number, and reads nothing new to do it', async () => {
  const { onSizeChange } = await mount()
  const select = screen.getByLabelText('Window')
  expect(select).toHaveValue('6')
  expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
    'Last 3 cycles',
    'Last 6 cycles',
    'Last 12 cycles',
  ])

  // Read costs are measured against each other rather than against a literal: what matters is that
  // the cost of a window does not GROW with the window.
  const baseline = zero.reads
  fireEvent.change(select, { target: { value: '3' } })
  const narrow = zero.reads - baseline

  expect(onSizeChange).toHaveBeenCalledTimes(1)
  expect(onSizeChange).toHaveBeenCalledWith(3)
  expect(onSizeChange.mock.calls[0]?.[0]).toBeTypeOf('number')
  expect(screen.getByLabelText('Window')).toHaveValue('3')
  expect(screen.getByTestId('delivery-window-label')).toHaveTextContent('last 3 completed cycles')

  fireEvent.change(screen.getByLabelText('Window'), { target: { value: '12' } })
  const wide = zero.reads - baseline - narrow

  expect(screen.getByTestId('delivery-window-label')).toHaveTextContent('last 12 completed cycles')
  // CLAUDE.md #9: the new window re-runs a pure function over rows already in memory. A query
  // issued per window cycle would make the twelve cost four times the three, and a query that only
  // appeared once the window changed would make `narrow` exceed the steady cost.
  expect(narrow).toBeGreaterThan(0)
  expect(wide).toBe(narrow)
})

test('the honesty statement is one line plus more ·, names the three absences, and cannot be dismissed', async () => {
  await mount()

  const honesty = screen.getByTestId('delivery-honesty')
  expect(honesty).toHaveTextContent('change failure rate')
  expect(honesty).toHaveTextContent('time to restore')
  expect(honesty).toHaveTextContent('deployment frequency as a rate')
  // The mock's line would now be a NEW lie: merged → live IS derived, from the merge commit against
  // a deployment's.
  expect(honesty.textContent ?? '').not.toMatch(/merged.to.live isn't measured/i)

  // One control, and it is a disclosure rather than a dismissal.
  const controls = within(honesty).getAllByRole('button')
  expect(controls).toHaveLength(1)
  const more = controls[0] as HTMLElement
  expect(more).toHaveTextContent('more ·')
  expect(screen.queryByTestId('delivery-honesty-more')).toBeNull()

  fireEvent.click(more)
  const panel = screen.getByTestId('delivery-honesty-more')
  // The coverage limit nobody had stated before this change.
  expect(panel).toHaveTextContent(/linked to no issue is invisible/i)

  more.focus()
  fireEvent.keyDown(more, { key: 'Escape' })
  expect(screen.queryByTestId('delivery-honesty-more')).toBeNull()
  expect(document.activeElement).toBe(more)
})

test('the shipped NotShownYet panel and its prose are gone', async () => {
  await mount()

  expect(screen.queryByTestId('delivery-gaps')).toBeNull()
  expect(screen.queryByText(/What this doesn't show yet/i)).toBeNull()
  expect(screen.queryByText(/The cycle in progress is excluded/i)).toBeNull()
})

test('the one peek opens on focus alone, carries the phrase and the reality drawing, and Escape closes it without navigating', async () => {
  const { router } = await mount()

  const chip = screen.getByTestId('delivery-peek-chip')
  expect(chip).toHaveAttribute('aria-expanded', 'false')
  expect(chip).toHaveTextContent('ENG-116')

  chip.focus()
  await waitFor(() => expect(screen.getByTestId('delivery-peek')).toBeInTheDocument())
  const peek = screen.getByTestId('delivery-peek')
  expect(peek).toHaveAttribute('role', 'dialog')
  // The dictionary's own words, and the shared drawing — no sentence written by this page.
  expect(peek).toHaveTextContent('Apple Pay in the payment sheet')
  expect(within(peek).getByRole('img', { name: /PR merged/ })).toBeInTheDocument()
  expect(within(peek).getByText('⏎')).toBeInTheDocument()
  // At most one peek is ever open (`ia.html`), and this page draws exactly the one.
  expect(screen.getAllByRole('dialog')).toHaveLength(1)

  fireEvent.keyDown(chip, { key: 'Escape' })
  expect(screen.queryByTestId('delivery-peek')).toBeNull()
  expect(document.activeElement).toBe(chip)
  expect(router.state.location.pathname).toBe('/teams/team-1/delivery')
})

test('renders one empty state for a team with no completed cycle, not a board of zeros', async () => {
  zero.cycles = [ACTIVE]
  await mount()

  expect(screen.getByTestId('delivery-empty')).toHaveTextContent('No completed cycles yet')
  expect(screen.getByTestId('delivery-window-label')).toHaveTextContent('No completed cycles yet')
  expect(screen.queryByTestId('delivery-stat')).toBeNull()
  expect(screen.queryByTestId('delivery-drawn-section')).toBeNull()
  expect(screen.queryByTestId('delivery-timeline')).toBeNull()
})

// Design §D11: a section with no data renders NOTHING — not a heading, not an axis, not a zero.
test('a window with no merged change draws neither a distribution nor a rhythm', async () => {
  zero.issues = (issues() as Record<string, unknown>[]).map((issue) => ({
    ...issue,
    issueLinks: [],
  }))
  await mount()

  const sections = screen.getAllByTestId('delivery-drawn-section')
  expect(sections.map((section) => section.getAttribute('data-section'))).toEqual(['cycle-flow'])
  expect(screen.queryByText(/open to merged/i)).toBeNull()
  // Said ONCE, not once per absent drawing.
  const absence = screen.getAllByTestId('delivery-flow-absence')
  expect(absence).toHaveLength(1)
  expect(absence[0]).toHaveTextContent(/Connect GitHub/)
})

test('a team with no cycle in progress draws no timeline', async () => {
  zero.cycles = completedCycles()
  await mount()

  expect(screen.queryByTestId('delivery-timeline')).toBeNull()
  expect(screen.queryByTestId('delivery-peek-chip')).toBeNull()
  expect(screen.getAllByTestId('delivery-stat').length).toBeGreaterThan(0)
})

// CLAUDE.md #8, asserted at the surface rather than only at the model: nothing on this page offers
// a per-person reading, and no control mentions one. `review.author` is a real provider login on
// the rows handed in above, and it may never reach the page.
test('exposes no per-person control or reading', async () => {
  await mount()

  const controls = [...screen.getAllByRole('combobox'), ...screen.queryAllByRole('button')]
  for (const control of controls) {
    expect(control.textContent ?? '').not.toMatch(/person|member|assignee|author|reviewer|who/i)
  }
  expect(document.body.textContent ?? '').not.toContain('octocat')
  expect(document.body.innerHTML).not.toContain('octocat')
})

// Design §D8's tripwire: `metric-tiles.tsx` was left untouched so the retro's panel keeps its
// markup, its classes, its formatters and its `retro-seed-*` selectors. This mounts that consumer
// directly, because the Delivery page no longer renders it and a shared component with one
// remaining caller is exactly the one that quietly breaks.
test('the retro panel still renders the shared tiles unchanged', () => {
  const cycle = completedCycles()[11] as { id: string; name: string; startDate: number }
  const seed = buildRetroSeed({
    cycle: {
      id: cycle.id,
      name: cycle.name,
      startDate: cycle.startDate,
      issues: [
        {
          id: 'a',
          status: 'done',
          cycleId: cycle.id,
          rolledOverFromCycleId: null,
          carryoverCount: 0,
          cycleAssignedAt: null,
          pullRequests: [],
        },
        {
          id: 'b',
          status: 'todo',
          cycleId: cycle.id,
          rolledOverFromCycleId: null,
          carryoverCount: 0,
          cycleAssignedAt: null,
          pullRequests: [],
        },
      ],
    },
  })

  render(
    <>
      {seed.sections.map((section) => (
        <MetricSection
          key={section.key}
          section={section}
          sectionTestId="retro-seed-section"
          emptyTestId="retro-seed-empty"
          testId="retro-seed-widget"
          sparklineTestId="retro-seed-sparkline"
          noTrendTestId="retro-seed-no-trend"
        />
      ))}
    </>,
  )

  const sections = screen.getAllByTestId('retro-seed-section')
  expect(sections.map((section) => section.getAttribute('data-section'))).toEqual([
    'delivered',
    'flow',
  ])
  const tiles = screen.getAllByTestId('retro-seed-widget')
  expect(tiles.length).toBeGreaterThan(0)
  // The retro's tile is still the bordered card with its caption sentence — a different object from
  // the Delivery page's stat reading, which is the whole point of D8.
  expect((tiles[0] as HTMLElement).className).toContain('rounded-card')
  expect((tiles[0] as HTMLElement).tagName).toBe('ARTICLE')
  expect(screen.getByTestId('retro-seed-empty')).toHaveTextContent('No delivery data yet')
})
