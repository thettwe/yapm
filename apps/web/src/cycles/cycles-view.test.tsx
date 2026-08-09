import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// What only a rendered Cycles can prove: that the page is a REGISTER — one row per cycle, newest
// first — and not the active cycle's plan; that the work which survived a cycle boundary is stated
// where no other surface states it; that every fact on the page is available without colour; and
// that the bands fold rather than drawing zeros over cycles that hold nothing.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  canWrite: true,
  navigate: vi.fn(),
  mutate: vi.fn((_mutation: unknown) => ({
    client: Promise.resolve({ type: 'ok' }),
    server: Promise.resolve({ type: 'ok' }),
  })),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [name in harness.rows ? harness.rows[name] : [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: harness.mutate }),
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

import { CyclesView } from './cycles-view'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 7, 7, 9, 0, 0)
const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering' }

const CYCLE_1 = {
  id: 'cycle-1',
  teamId: TEAM.id,
  number: 1,
  name: 'Groundwork',
  status: 'completed',
  startDate: NOW - 42 * DAY,
  endDate: NOW - 29 * DAY,
}
const CYCLE_2 = {
  id: 'cycle-2',
  teamId: TEAM.id,
  number: 2,
  name: 'Checkout',
  status: 'completed',
  startDate: NOW - 28 * DAY,
  endDate: NOW - 15 * DAY,
}
const CYCLE_3 = {
  id: 'cycle-3',
  teamId: TEAM.id,
  number: 3,
  name: 'Payments',
  status: 'active',
  startDate: NOW - 8 * DAY,
  endDate: NOW + 5 * DAY,
}

let nextIssue = 0
function issue(overrides: Record<string, unknown> & { status: string }) {
  nextIssue += 1
  return {
    id: `issue-${nextIssue}`,
    number: 100 + nextIssue,
    title: `Issue ${nextIssue}`,
    cycleId: null,
    cycleAssignedAt: null,
    carryoverCount: 0,
    rolledOverFromCycleId: null,
    issueLinks: [],
    ...overrides,
  }
}

// Three cycles, one traveller carried once out of Checkout, and a cycle report on Checkout alone.
function seedRegister(overrides: Record<string, unknown> = {}) {
  nextIssue = 0
  harness.canWrite = true
  harness.rows = {
    'teams.all': [TEAM],
    'cycles.byTeam': [CYCLE_1, CYCLE_2, CYCLE_3],
    'issues.byTeam': [
      issue({ status: 'done', cycleId: CYCLE_1.id, cycleAssignedAt: CYCLE_1.startDate }),
      issue({ status: 'done', cycleId: CYCLE_2.id, cycleAssignedAt: CYCLE_2.startDate }),
      issue({
        status: 'in_progress',
        title: 'Apple Pay button missing on iPad',
        cycleId: CYCLE_3.id,
        cycleAssignedAt: CYCLE_3.startDate,
        carryoverCount: 1,
        rolledOverFromCycleId: CYCLE_2.id,
      }),
      issue({ status: 'todo', cycleId: CYCLE_3.id, cycleAssignedAt: CYCLE_3.startDate }),
    ],
    'retros.byTeam': [
      { id: 'retro-2', cycleId: CYCLE_2.id, title: 'Checkout retro', closedAt: NOW - 14 * DAY },
    ],
    'digests.byTeam': [
      { cycleId: CYCLE_2.id, status: 'ready', content: { headline: 'Checkout shipped.' } },
    ],
    'deployments.byTeam': [],
    'digests.byCycle': undefined,
    'pmDigestReview.byCycle': undefined,
    ...overrides,
  }
}

beforeEach(() => {
  harness.mutate.mockClear()
  harness.navigate.mockClear()
  seedRegister()
})

function registerRows(): HTMLElement[] {
  return screen.getAllByTestId('register-row')
}

function rowFor(cycleId: string): HTMLElement {
  const row = registerRows().find((candidate) => candidate.dataset.cycleId === cycleId)
  if (row === undefined) throw new Error(`no register row for ${cycleId}`)
  return row
}

// THE FALSIFIABLE CHECK, part two. On `main` this page is a cycle rail beside one featured cycle's
// issue list; there is no register, no row per cycle and no carried-in band at all.
test('the register is one row per cycle, newest first, with no rail and no issue list', () => {
  render(<CyclesView teamId="team-1" />)

  const masthead = screen.getByTestId('masthead')
  expect(within(masthead).getByRole('heading', { name: 'Cycles' })).toBeInTheDocument()
  // Derived from the page, never a magic number: fixtures accumulate cycles across specs.
  const cycleCount = (harness.rows['cycles.byTeam'] as readonly unknown[]).length
  expect(within(masthead).getByTestId('masthead-count')).toHaveTextContent(String(cycleCount))

  expect(registerRows()).toHaveLength(cycleCount)
  expect(registerRows().map((row) => row.dataset.cycleId)).toEqual([
    CYCLE_3.id,
    CYCLE_2.id,
    CYCLE_1.id,
  ])
  expect(within(rowFor(CYCLE_3.id)).getByText('Payments')).toBeInTheDocument()

  // The featured cycle's issue list and its progress bar are gone: Issues already filters by cycle
  // and Home's hero already answers "how is this cycle going".
  expect(screen.queryAllByTestId('cycle-issue-row')).toHaveLength(0)
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
})

test('the current cycle is selected on arrival and selection moves with the reader', () => {
  render(<CyclesView teamId="team-1" />)

  expect(rowFor(CYCLE_3.id)).toHaveAttribute('aria-current', 'true')
  expect(rowFor(CYCLE_2.id)).not.toHaveAttribute('aria-current')

  fireEvent.click(rowFor(CYCLE_2.id))
  expect(rowFor(CYCLE_2.id)).toHaveAttribute('aria-current', 'true')
  expect(rowFor(CYCLE_3.id)).not.toHaveAttribute('aria-current')
})

// The rows are `<button>`s, so `Enter` and `Space` are the platform's own activation; what the page
// adds on top is arrow movement over the same order. e2e drives the real key presses.
test('arrow keys move between register rows without changing the selection', () => {
  render(<CyclesView teamId="team-1" />)

  const [first, second] = registerRows()
  expect(first?.tagName).toBe('BUTTON')
  first?.focus()

  fireEvent.keyDown(first as HTMLElement, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(second)
  expect(rowFor(CYCLE_3.id)).toHaveAttribute('aria-current', 'true')

  fireEvent.keyDown(second as HTMLElement, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(first)
})

test('selecting a row re-points the carried-in band and the report below it', () => {
  render(<CyclesView teamId="team-1" />)

  // The active cycle carried one issue in.
  const carried = screen.getByTestId('carried-in')
  expect(within(carried).getAllByTestId('carried-row')).toHaveLength(1)
  expect(within(carried).getByText('Apple Pay button missing on iPad')).toBeInTheDocument()
  // A running cycle with no digest row has no report band to draw.
  expect(screen.queryByTestId('cycle-digest')).not.toBeInTheDocument()

  fireEvent.click(rowFor(CYCLE_2.id))

  // Checkout carried nothing in, so the band is absent entirely — no header, no zero, no frame.
  expect(screen.queryByTestId('carried-in')).not.toBeInTheDocument()
  expect(screen.queryAllByTestId('carried-row')).toHaveLength(0)
  // …and a completed cycle always shows its report.
  expect(screen.getByTestId('cycle-digest')).toBeInTheDocument()
  expect(screen.getByText('THE LAST REPORT')).toBeInTheDocument()
})

test('the carried fact is text beside a drawing that announces nothing', () => {
  render(<CyclesView teamId="team-1" />)

  const row = screen.getAllByTestId('carried-row')[0] as HTMLElement
  expect(within(row).getByText('carried 1×')).toBeInTheDocument()
  expect(within(row).getByText('Carried 1 time; last left Checkout.')).toBeInTheDocument()
  // The chain is a private notation, so it may never be the only carrier of the fact.
  const chain = row.querySelector('svg[aria-hidden="true"]')
  expect(chain).not.toBeNull()

  fireEvent.click(row)
  expect(harness.navigate).toHaveBeenCalledTimes(1)
})

// Where the rows left DIFFERENT cycles the header can name none of them, so each row has to name
// its own — otherwise every row after the first draws a chain whose origin appears nowhere a
// sighted reader can see it.
test('each carried row names the cycle it left when the band header cannot name one for all', () => {
  seedRegister({
    'issues.byTeam': [
      issue({
        status: 'todo',
        title: 'Left Checkout',
        cycleId: CYCLE_3.id,
        carryoverCount: 1,
        rolledOverFromCycleId: CYCLE_2.id,
      }),
      issue({
        status: 'todo',
        title: 'Left Groundwork',
        cycleId: CYCLE_3.id,
        carryoverCount: 2,
        rolledOverFromCycleId: CYCLE_1.id,
      }),
    ],
  })
  render(<CyclesView teamId="team-1" />)

  const band = screen.getByTestId('carried-in')
  expect(within(band).queryByText(/^out of /)).not.toBeInTheDocument()

  const rows = within(band).getAllByTestId('carried-row')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent(/carried 2×\s*· out of Groundwork/)
  expect(rows[1]).toHaveTextContent(/carried 1×\s*· out of Checkout/)
})

test('a cycle that carried nothing in draws no band at all', () => {
  seedRegister({
    'issues.byTeam': [issue({ status: 'todo', cycleId: CYCLE_3.id })],
  })
  render(<CyclesView teamId="team-1" />)

  expect(screen.queryByTestId('carried-in')).not.toBeInTheDocument()
  expect(screen.queryByText('CARRIED IN')).not.toBeInTheDocument()
})

test('the ledger states its counts in words, and folds for a cycle holding no issues', () => {
  seedRegister({
    'cycles.byTeam': [
      CYCLE_3,
      { ...CYCLE_3, id: 'cycle-4', number: 4, name: 'Next up', status: 'upcoming' },
    ],
    'issues.byTeam': [
      issue({ status: 'done', cycleId: CYCLE_3.id, cycleAssignedAt: CYCLE_3.startDate }),
      issue({ status: 'todo', cycleId: CYCLE_3.id, cycleAssignedAt: CYCLE_3.startDate }),
      issue({ status: 'todo', cycleId: CYCLE_3.id, cycleAssignedAt: CYCLE_3.startDate + DAY }),
    ],
  })
  render(<CyclesView teamId="team-1" />)

  const ledger = within(rowFor(CYCLE_3.id)).getByTestId('register-ledger')
  expect(ledger).toHaveAttribute('role', 'img')
  expect(ledger).toHaveAccessibleName('1 landed of 2 committed, 1 added after the cycle started')
  expect(within(ledger).getByText('1/2')).toBeInTheDocument()

  // Nothing points at the upcoming cycle: the cell is absent, not an empty rail and not a zero.
  expect(within(rowFor('cycle-4')).queryByTestId('register-ledger')).not.toBeInTheDocument()
  expect(within(rowFor('cycle-4')).queryByText('0/0')).not.toBeInTheDocument()
})

test('an older completed cycle stops claiming a committed total', () => {
  render(<CyclesView teamId="team-1" />)

  const older = within(rowFor(CYCLE_1.id)).getByTestId('register-ledger')
  expect(older).toHaveAccessibleName('1 landed; the committed total is no longer reconstructible')
  expect(within(older).getByText('1 landed')).toBeInTheDocument()

  // The rule is stated once, through the derived-number affordance, never as prose at rest.
  const how = screen.getByRole('button', { name: 'How the ledger is derived' })
  fireEvent.click(how)
  expect(screen.getByText(/overwritten the next time the issue moves/)).toBeInTheDocument()
})

test('an artifact chip appears only where the artifact exists', () => {
  render(<CyclesView teamId="team-1" />)

  const checkout = within(rowFor(CYCLE_2.id))
  expect(checkout.getByText('Cycle report')).toBeInTheDocument()
  expect(checkout.getByText('Wrapped')).toBeInTheDocument()

  // No digest row and no closed retro: the slot draws no ink, and never a "not generated" label.
  for (const cycleId of [CYCLE_1.id, CYCLE_3.id]) {
    const row = within(rowFor(cycleId))
    expect(row.queryByText('Cycle report'), cycleId).not.toBeInTheDocument()
    expect(row.queryByText('Wrapped'), cycleId).not.toBeInTheDocument()
    expect(row.queryByText(/no digest|not generated/i), cycleId).not.toBeInTheDocument()
  }
})

test('a chip is refused for a digest that is not ready and for a retro still open', () => {
  seedRegister({
    'digests.byTeam': [{ cycleId: CYCLE_2.id, status: 'ready', content: null }],
    'retros.byTeam': [{ id: 'retro-2', cycleId: CYCLE_2.id, title: 'open', closedAt: null }],
  })
  render(<CyclesView teamId="team-1" />)

  expect(screen.queryByText('Cycle report')).not.toBeInTheDocument()
  expect(screen.queryByText('Wrapped')).not.toBeInTheDocument()
})

test('every cycle status is a shape with a word, so no row is read by colour alone', () => {
  const view = render(<CyclesView teamId="team-1" />)

  expect(within(rowFor(CYCLE_3.id)).getByLabelText('Active cycle')).toBeInTheDocument()
  expect(within(rowFor(CYCLE_2.id)).getByLabelText('Completed cycle')).toBeInTheDocument()
  view.unmount()

  seedRegister({
    'cycles.byTeam': [{ ...CYCLE_3, id: 'cycle-4', number: 4, status: 'upcoming' }],
  })
  render(<CyclesView teamId="team-1" />)
  expect(within(rowFor('cycle-4')).getByLabelText('Upcoming cycle')).toBeInTheDocument()
})

test('the page refuses the burndown once, and draws no chart in its place', () => {
  render(<CyclesView teamId="team-1" />)

  expect(screen.getAllByText(/nothing here burns down/)).toHaveLength(1)
  expect(
    screen.getByRole('button', { name: 'How the burndown refusal is derived' }),
  ).toBeInTheDocument()
})

test('a team with no cycles states it in a label and orphans no footnote', () => {
  seedRegister({ 'cycles.byTeam': [], 'issues.byTeam': [] })
  render(<CyclesView teamId="team-1" />)

  expect(screen.getByTestId('register-empty')).toHaveTextContent('No cycles yet')
  expect(screen.queryByText(/nothing here burns down/)).not.toBeInTheDocument()
  expect(screen.queryByTestId('carried-in')).not.toBeInTheDocument()
  expect(screen.queryByTestId('cycle-digest')).not.toBeInTheDocument()
})

test('a viewer reads every fact and is offered nothing to write', () => {
  const writer = render(<CyclesView teamId="team-1" />)
  expect(screen.getByTestId('complete-cycle')).toBeInTheDocument()
  expect(screen.getByTestId('new-cycle')).toBeInTheDocument()
  writer.unmount()

  harness.canWrite = false
  render(<CyclesView teamId="team-1" />)

  expect(screen.queryByTestId('complete-cycle')).not.toBeInTheDocument()
  expect(screen.queryByTestId('new-cycle')).not.toBeInTheDocument()

  // Every fact the register carries is still readable.
  const rowCount = (harness.rows['cycles.byTeam'] as readonly unknown[]).length
  expect(registerRows()).toHaveLength(rowCount)
  const checkout = rowFor(CYCLE_2.id)
  expect(within(checkout).getByTestId('register-ledger')).toBeInTheDocument()
  expect(within(checkout).getByText('Cycle report')).toBeInTheDocument()

  // …and the completed cycle's retro is a link, never the writer's "open a retrospective".
  fireEvent.click(checkout)
  expect(screen.queryByTestId('cycle-open-retro')).not.toBeInTheDocument()
  expect(screen.getByTestId('cycle-retro-link')).toBeInTheDocument()
})

test('the write controls act on the selected row and keep their names', () => {
  render(<CyclesView teamId="team-1" />)

  fireEvent.click(screen.getByTestId('complete-cycle'))
  const call = harness.mutate.mock.calls.at(-1)?.[0] as
    | { mutator: { mutatorName: string }; args: { id: string } }
    | undefined
  expect(call?.mutator.mutatorName).toBe('cycle.complete')
  expect(call?.args.id).toBe(CYCLE_3.id)

  // A completed cycle cannot be completed again, so the control is absent on that selection.
  fireEvent.click(rowFor(CYCLE_2.id))
  expect(screen.queryByTestId('complete-cycle')).not.toBeInTheDocument()
  expect(screen.getByTestId('new-cycle')).toHaveAccessibleName('New cycle')
})
