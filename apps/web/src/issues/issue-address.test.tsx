import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

// Deep-link resolution, driven directly. The wart this replaced parsed digits out of the segment
// and LINEAR-SCANNED the team's whole backlog for them, which answered `OPS-116` with this team's
// 116 and paid for every issue in the team to render one. What is asserted here is the resolver's
// three states: an address that resolves, one that never can, and one that cannot be decided YET —
// because collapsing the third into the second is how a correct deep link flashes "does not exist"
// on a cold client.

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, unknown>,
  // Query names whose result has not arrived. `[]` and "answered empty" are the same value and must
  // not be the same state, so the harness models the difference the surface has to render.
  pending: new Set<string>(),
  requests: [] as { name: string; args: unknown }[],
}))

// What an unanswered query yields is not one value: a `.one()` query resolves to `undefined` and a
// collection to `[]`. The harness reproduces both, because the whole distinction under test is
// between "answered with nothing" and "not answered yet".
const ONE_ROW = new Set(['issues.byKey'])

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const { query, args } = request as { query: { queryName: string }; args?: unknown }
    const name = query.queryName
    harness.requests.push({ name, args })
    const empty = ONE_ROW.has(name) ? undefined : []
    if (harness.pending.has(name)) return [empty, { type: 'unknown' }]
    return [name in harness.rows ? harness.rows[name] : empty, { type: 'complete' }]
  },
  useZero: () => ({ mutate: vi.fn() }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: { children?: React.ReactNode }) => <a {...props}>{children}</a>,
}))

// The detail itself has its own file of tests; here it is only the thing the resolver either
// reaches or does not, so it reports which row it was handed.
vi.mock('@/issues/issue-detail', () => ({
  IssueDetail: ({ issueId }: { issueId: string }) => <div data-testid="detail">{issueId}</div>,
}))

import { IssueAddress } from './issue-address'

const TEAM = { id: 'team-1', key: 'ENG', name: 'Engineering', members: [] }

function byKeyRequests(): { teamId: string; number: number }[] {
  return harness.requests
    .filter((request) => request.name === 'issues.byKey')
    .map((request) => request.args as { teamId: string; number: number })
}

beforeEach(() => {
  harness.rows = { 'teams.all': [TEAM], 'issues.byKey': { id: 'issue-116' } }
  harness.pending = new Set()
  harness.requests = []
})

afterEach(cleanup)

function mount(issueKey: string) {
  return render(<IssueAddress teamId="team-1" issueKey={issueKey} />)
}

test('`ENG-116` resolves through the by-key query, at the pair the key spells', () => {
  mount('ENG-116')

  expect(screen.getByTestId('detail')).toHaveTextContent('issue-116')
  expect(byKeyRequests()).toEqual([{ teamId: 'team-1', number: 116 }])
})

test('the bare number the side panel emits resolves to the same row', () => {
  mount('116')

  expect(screen.getByTestId('detail')).toHaveTextContent('issue-116')
  expect(byKeyRequests()).toEqual([{ teamId: 'team-1', number: 116 }])
})

test('another team’s key is not an address here, and is never asked about', () => {
  mount('OPS-116')

  expect(screen.queryByTestId('detail')).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('does not exist')
  // The scan this replaced would have answered with team-1's 116. Nothing is even requested.
  expect(byKeyRequests()).toEqual([])
})

test('a resolvable key whose row is answered empty is missing, not loading', () => {
  harness.rows = { 'teams.all': [TEAM] }
  mount('ENG-404')

  expect(screen.getByRole('status')).toHaveTextContent('does not exist')
  expect(byKeyRequests()).toEqual([{ teamId: 'team-1', number: 404 }])
})

test('a row that has not arrived is still loading, never missing', () => {
  harness.pending = new Set(['issues.byKey'])
  mount('ENG-116')

  expect(screen.getByRole('status')).toHaveTextContent('Loading issue…')
  expect(screen.getByRole('status').textContent ?? '').not.toMatch(/does not exist/)
})

test('a key cannot be judged before the team it names has synced', () => {
  harness.pending = new Set(['teams.all'])
  mount('ENG-116')

  // `ENG-116` and `OPS-116` are indistinguishable until the team key is known, so the answer is
  // "not yet" — and nothing is asked of the by-key query on a guess.
  expect(screen.getByRole('status')).toHaveTextContent('Loading issue…')
  expect(byKeyRequests()).toEqual([])
})

test('a bare number needs no team key, so it resolves while the roster is still syncing', () => {
  harness.pending = new Set(['teams.all'])
  mount('116')

  expect(screen.getByTestId('detail')).toHaveTextContent('issue-116')
})

test('a segment that is not an address is refused the moment it is read', () => {
  harness.pending = new Set(['teams.all'])
  mount('nonsense')

  expect(screen.getByRole('status')).toHaveTextContent('does not exist')
  expect(byKeyRequests()).toEqual([])
})

test('the unresolved states keep a way back to the list', () => {
  mount('OPS-116')

  expect(screen.getByLabelText('Back to issues')).toBeInTheDocument()
})
