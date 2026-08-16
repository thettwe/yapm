import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SyncSessionState } from '@/zero/provider'

// What only a rendered `/login` can prove: that the landing decision is taken here, once, and that
// every state which is settled but not `ready` has an end — a surface, never an endless spinner,
// and never a `Navigate` that `Authenticated` would answer with one of its own.

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string } } | null,
  isPending: false,
  sync: {} as SyncSessionState,
  teams: [] as unknown[],
  result: { type: 'complete' } as { type: 'complete' | 'unknown' | 'error' },
  retryOffered: false,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [harness.teams, harness.result],
}))

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to, params }: { to: string; params?: { teamId: string } }) => (
    <div data-testid="navigate">{params ? to.replace('$teamId', params.teamId) : to}</div>
  ),
}))

vi.mock('@/auth/client', () => ({
  useSession: () => ({ data: harness.session, isPending: harness.isPending }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => harness.sync,
  useSyncControl: () => ({ refresh: vi.fn(), retry: vi.fn() }),
}))

vi.mock('@/zero/recovery', () => ({
  useSyncRecovery: () => ({
    phase: 'idle',
    attempt: 0,
    delayMs: 0,
    retryOffered: harness.retryOffered,
    retryNow: vi.fn(),
  }),
}))

vi.mock('@/components/auth/login-form', () => ({
  LoginForm: () => <div data-testid="login-form" />,
}))

import { LoginPage } from './login-page'

const READY: SyncSessionState = {
  status: 'ready',
  userID: 'viewer-1',
  role: 'member',
  pmAudienceTeamIds: [],
  unavailable: false,
}

const team = (id: string, memberIds: readonly string[]) => ({
  id,
  name: id,
  key: id.toUpperCase(),
  members: memberIds.map((userId) => ({ userId })),
})

// Storage is owned rather than inherited, on `team-context.test.ts`'s reasoning: whether jsdom's
// `localStorage` survives depends on the Node the runner is on.
function stubStorage(initial: Record<string, string> = {}): void {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  stubStorage()
  harness.session = { user: { id: 'viewer-1', email: 'ada@example.com' } }
  harness.isPending = false
  harness.sync = READY
  harness.teams = []
  harness.result = { type: 'complete' }
  harness.retryOffered = false
})

test('a member with a team of their own lands on that team, not on administration', () => {
  harness.teams = [team('team-1', ['viewer-1'])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-1')
})

// The deck may offer a team the reader is not on; the front door may not put them there.
test('a team the viewer cannot read is skipped for one they can', () => {
  harness.teams = [team('strangers', ['someone-else']), team('team-2', ['viewer-1'])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-2')
})

test('a member of no team lands on the workspace surface that is theirs', () => {
  harness.teams = [team('strangers', ['someone-else'])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/')
  expect(screen.getByTestId('navigate')).not.toHaveTextContent('/teams/')
})

test('an unsettled roster waits, and navigates nowhere', () => {
  harness.teams = []
  harness.result = { type: 'unknown' }
  render(<LoginPage />)

  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
})

// The invariant: an unidentified caller's `teams.all()` resolves through `denyAll` and reports
// complete-and-EMPTY. A gate that kept `complete` and dropped `ready` would send a member with five
// teams to administration, and this is the case that catches it.
test('a complete-and-empty roster on an unsettled sync session waits rather than deciding', () => {
  harness.sync = { ...READY, status: 'pending', userID: null, role: null }
  harness.teams = []
  harness.result = { type: 'complete' }
  render(<LoginPage />)

  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
})

// `unavailable` only ever describes the CREDENTIAL request. A credential that mints fine against a
// zero-cache that is down leaves the roster at `unknown` with nothing to press — so the roster wait
// is bounded by the same recovery clock the statusline reads.
test('a roster that never settles reaches the retry surface rather than spinning forever', () => {
  harness.result = { type: 'unknown' }
  harness.retryOffered = true
  render(<LoginPage />)

  expect(screen.getByTestId('sync-unavailable')).toBeInTheDocument()
  expect(screen.getByTestId('sync-unavailable-retry')).toBeInTheDocument()
  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
})

test('a roster that reports an error is a surface, not a wait', () => {
  harness.result = { type: 'error' }
  render(<LoginPage />)

  expect(screen.getByTestId('sync-unavailable')).toBeInTheDocument()
})

test('an unreachable sync server is a retry surface, in either settled status', () => {
  for (const status of ['pending', 'logged-out'] as const) {
    harness.sync = { ...READY, status, unavailable: true }
    const view = render(<LoginPage />)

    expect(screen.getByTestId('sync-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
    view.unmount()
  }
})

// The loop guard: a `Navigate` here would meet `Authenticated`'s own coming the other way, and two
// routes navigating at each other starve the renderer.
test('a clean settled logged-out renders the sign-in form and navigates nowhere', () => {
  harness.sync = { ...READY, status: 'logged-out', userID: null, role: null }
  render(<LoginPage />)

  expect(screen.getByTestId('login-form')).toBeInTheDocument()
  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
})

test('a caller with no better-auth session is asked to sign in', () => {
  harness.session = null
  render(<LoginPage />)

  expect(screen.getByTestId('login-form')).toBeInTheDocument()
  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
})

test('a remembered team the viewer can read wins over the first one', () => {
  stubStorage({ 'yapm.frame.team': 'team-3' })
  harness.teams = [team('team-1', ['viewer-1']), team('team-3', ['viewer-1'])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-3')
})

test('a workspace admin lands on the anchor without a membership row', () => {
  harness.sync = { ...READY, role: 'admin' }
  harness.teams = [team('team-1', [])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-1')
})
