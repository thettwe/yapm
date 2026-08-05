import { fireEvent, render, screen, within } from '@testing-library/react'
import type { DeliveryWindowSize } from '@yapm/schema'
import { useState } from 'react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { SeedCycleRow, SeedIssueRow } from './rows'

// The view is a pure render over rows the caller already syncs, so the only thing worth mocking is
// which rows arrive. `queries` is replaced with tagged sentinels so the mocked `useQuery` can answer
// each of the three reads without depending on hook call order.

const zero = vi.hoisted(() => ({
  teams: [] as unknown[],
  cycles: [] as unknown[],
  issues: [] as unknown[],
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
    },
  }
})

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (query: { tag: 'teams' | 'cycles' | 'issues' }) => {
    zero.reads += 1
    return [zero[query.tag], { type: 'complete' }]
  },
}))

import { DeliveryView } from './delivery-view'

const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000

function cycle(number: number, status: SeedCycleRow['status'] = 'completed'): SeedCycleRow {
  return {
    id: `c${number}`,
    name: `Cycle ${number}`,
    number,
    status,
    startDate: START + number * 500 * HOUR,
  }
}

function issue(over: Partial<SeedIssueRow> & { id: string }): SeedIssueRow {
  return { status: 'done', cycleId: null, ...over }
}

beforeEach(() => {
  zero.reads = 0
  zero.teams = [{ id: 'team-1', name: 'Platform', key: 'ENG' }]
  zero.cycles = [1, 2, 3, 4, 5, 6].map((number) => cycle(number))
  zero.issues = [1, 2, 3, 4, 5, 6].map((number) =>
    issue({ id: `i${number}`, cycleId: `c${number}` }),
  )
})

function renderView(size: DeliveryWindowSize = 6) {
  const onSizeChange = vi.fn()
  render(<DeliveryView teamId="team-1" size={size} onSizeChange={onSizeChange} />)
  return { onSizeChange }
}

// The view is controlled, so a spy for `onSizeChange` would swallow the interaction: nothing
// re-renders, and a read count that cannot move proves nothing. This harness owns the window the
// way the route does, so changing it actually re-runs the component.
function Harness({ onSizeChange }: { onSizeChange: (size: DeliveryWindowSize) => void }) {
  const [size, setSize] = useState<DeliveryWindowSize>(6)
  return (
    <DeliveryView
      teamId="team-1"
      size={size}
      onSizeChange={(next) => {
        onSizeChange(next)
        setSize(next)
      }}
    />
  )
}

test('names the window it is reading and offers the three sizes from one control', () => {
  renderView()

  expect(screen.getByTestId('delivery-window-label')).toHaveTextContent('Last 6 completed cycles')

  // A native <select>, so changing the window needs no pointer.
  const select = screen.getByLabelText('Window')
  expect(select).toHaveValue('6')
  expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
    'Last 3 cycles',
    'Last 6 cycles',
    'Last 12 cycles',
  ])
})

// The only interactive control on the page. `Number(event.target.value)` is the whole of it, and a
// string leaking through would slice the window array by a string and clamp somewhere surprising.
test('reports the chosen window as a number, and reads nothing new to do it', () => {
  const onSizeChange = vi.fn()
  render(<Harness onSizeChange={onSizeChange} />)
  // What one render of this view costs in reads, measured rather than assumed.
  const perRender = zero.reads
  expect(perRender).toBeGreaterThan(0)

  fireEvent.change(screen.getByLabelText('Window'), { target: { value: '3' } })

  expect(onSizeChange).toHaveBeenCalledTimes(1)
  expect(onSizeChange).toHaveBeenCalledWith(3)
  expect(onSizeChange.mock.calls[0]?.[0]).toBeTypeOf('number')
  // The interaction really did re-render — without this the read comparison below could hold
  // because nothing happened at all.
  expect(screen.getByLabelText('Window')).toHaveValue('3')
  expect(screen.getByTestId('delivery-window-label')).toHaveTextContent('Last 3 completed cycles')
  // CLAUDE.md #9: the new window re-runs a pure function over rows already in memory, so the render
  // it causes costs exactly what the first render cost. A query that appeared when the window
  // changed — or one issued per window cycle — moves this and fails.
  expect(zero.reads).toBe(perRender * 2)
})

test('renders the Delivered and Flow sections from the shared tiles', () => {
  renderView()

  const sections = screen.getAllByTestId('delivery-section')
  expect(sections.map((section) => section.getAttribute('data-section'))).toEqual([
    'delivered',
    'flow',
  ])
  expect(
    within(sections[0] as HTMLElement).getAllByTestId('delivery-widget').length,
  ).toBeGreaterThan(0)
  // No connector fed anything in, so Flow is one quiet state rather than five zeros.
  expect(
    within(sections[1] as HTMLElement).getByTestId('delivery-empty-section'),
  ).toHaveTextContent('No delivery data yet')
})

test('renders one empty state for a team with no completed cycle, not a board of zeros', () => {
  zero.cycles = [cycle(1, 'active'), cycle(2, 'upcoming')]
  renderView()

  expect(screen.getByTestId('delivery-empty')).toHaveTextContent('No completed cycles yet')
  expect(screen.queryByTestId('delivery-widget')).toBeNull()
  expect(screen.queryByTestId('delivery-section')).toBeNull()
})

// The page shows one and a half DORA keys. Saying nothing about the other two and a half would let
// a DORA-adjacent heading imply four.
test('permanently names the DORA keys it does not carry', () => {
  renderView()

  const gaps = screen.getByTestId('delivery-gaps')
  expect(gaps).toHaveTextContent('Deployment frequency')
  expect(gaps).toHaveTextContent('Change failure rate')
  expect(gaps).toHaveTextContent('time to restore')
  expect(gaps).toHaveTextContent('open to merge only')
  // Not dismissible: there is no control that could hide it.
  expect(within(gaps).queryByRole('button')).toBeNull()
})

// CLAUDE.md #8, asserted at the surface rather than only at the model: nothing on this page offers
// a per-person reading, and no control mentions one.
test('exposes no per-person control or reading', () => {
  renderView()

  const controls = [...screen.getAllByRole('combobox'), ...screen.queryAllByRole('button')]
  for (const control of controls) {
    expect(control.textContent ?? '').not.toMatch(/person|member|assignee|author|reviewer|who/i)
  }
  expect(document.body.textContent ?? '').toContain('Never a per-person number')
})
