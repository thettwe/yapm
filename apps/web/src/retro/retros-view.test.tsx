import { render, screen } from '@testing-library/react'
import {
  CYCLES_BY_TEAM_QUERY_NAME,
  RETROS_BY_TEAM_QUERY_NAME,
  TEAMS_ALL_QUERY_NAME,
} from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'

// The index the `more▾` menu lands on. Everything asserted here is a fact about the team's rows:
// the page names itself and counts, a row states only what a stored row supports, and the owed-cycle
// group exists only when it has rows.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  canWrite: true,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    const name = (request as { query: { queryName: string } }).query.queryName
    return [name in harness.rows ? harness.rows[name] : [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: () => ({ client: Promise.resolve({}), server: Promise.resolve({}) }) }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => () => Promise.resolve(),
  Link: ({ children, ...props }: { children?: unknown }) => <a {...props}>{children as never}</a>,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    canWrite: harness.canWrite,
    canManage: harness.canWrite,
    role: harness.canWrite ? 'admin' : 'viewer',
  }),
}))

import { RetrosView } from '@/retro/retros-view'

const DAY = 86_400_000
const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering' }

const RETRO = {
  id: 'retro-1',
  title: 'Cycle 1 retro',
  phase: 'vote',
  format: 'wentwell_didnt_action',
  cycleId: 'cycle-1',
  createdAt: 1,
}

function cycle(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cycle-1',
    number: 1,
    name: 'Cycle 1',
    status: 'completed',
    startDate: Date.UTC(2026, 6, 16),
    endDate: Date.UTC(2026, 6, 29),
    ...overrides,
  }
}

function index(options: { retros?: readonly unknown[]; cycles?: readonly unknown[] } = {}) {
  harness.rows = {
    [TEAMS_ALL_QUERY_NAME]: [TEAM],
    [RETROS_BY_TEAM_QUERY_NAME]: options.retros ?? [],
    [CYCLES_BY_TEAM_QUERY_NAME]: options.cycles ?? [],
  }
  return render(<RetrosView teamId="team-1" />)
}

beforeEach(() => {
  harness.rows = {}
  harness.canWrite = true
})

test('the masthead reads Retros with a mono count, and never the team name', () => {
  index({ retros: [RETRO], cycles: [cycle()] })
  expect(screen.getByRole('heading', { name: 'Retros' })).toBeInTheDocument()
  expect(screen.getByTestId('masthead-count').textContent).toBe('1')
  expect(screen.getByTestId('masthead').textContent).not.toContain('Engineering')
})

test('a row states its title, phase, format and cycle range and nothing per-person', () => {
  index({ retros: [RETRO], cycles: [cycle()] })
  const row = screen.getByTestId('retro-link')
  expect(row.textContent).toContain('Cycle 1 retro')
  expect(row.textContent).toContain('Vote')
  expect(row.textContent).toContain('Went well')
  // The range formatter is locale-aware; what the row must carry is both boundaries of the cycle.
  expect(row.textContent).toContain('16')
  expect(row.textContent).toContain('29')
  expect(row.textContent).not.toMatch(/participant|author|facilitat|\bmember/i)
})

test('a team that has never run one gets the quiet line, no create control, no empty heading', () => {
  index()
  expect(screen.getByTestId('retros-quiet').textContent).toContain(
    'A retro opens when a cycle closes.',
  )
  // No cycle exists, so there is no next close to state — and nothing is invented in its place.
  expect(screen.getByTestId('retros-quiet').textContent).toBe('A retro opens when a cycle closes.')
  expect(screen.queryByTestId('retro-open-for-cycle')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Cycles without a retrospective' })).toBeNull()
})

test('the next close is stated only where a running cycle exists to state it', () => {
  index({
    cycles: [
      cycle({
        id: 'cycle-2',
        number: 2,
        name: 'Cycle 2',
        status: 'active',
        startDate: Date.now() - 9 * DAY,
        endDate: Date.now() + 5 * DAY,
      }),
    ],
  })
  expect(screen.getByTestId('retros-quiet').textContent).toContain('cycle 2 closes in 5 days')
})

test('a completed cycle owed a retro is offered one', () => {
  index({ cycles: [cycle()] })
  expect(screen.getByTestId('retro-open-for-cycle')).toBeInTheDocument()
})

// A viewer reads the owed cycle — it is a team fact — and only the control that opens one is gone.
test('a viewer sees the owed cycle listed and no control to open a retro for it', () => {
  harness.canWrite = false
  index({ cycles: [cycle()] })
  const group = screen.getByRole('region', { name: 'Cycles without a retrospective' })
  expect(group.textContent).toContain('Cycle 1')
  expect(screen.queryByTestId('retro-open-for-cycle')).toBeNull()
})
