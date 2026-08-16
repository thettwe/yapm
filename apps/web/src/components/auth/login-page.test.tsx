import { render, screen } from '@testing-library/react'
import type { AuthContext } from '@yapm/schema'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SyncSessionState } from '@/zero/provider'

// What only a rendered `/login` can prove: that the landing decision is taken here, once, and that
// every state which is settled but not `ready` has an end — a surface, never an endless spinner,
// and never a `Navigate` that `Authenticated` would answer with one of its own.
//
// `zeroContext` is modelled separately from `sync` on purpose: they are the same fact read from two
// places that are one commit apart on sign-in, and the gap between them is the whole bug.

const harness = vi.hoisted(() => ({
  session: null as { user: { id: string; email: string } } | null,
  isPending: false,
  sync: {} as SyncSessionState,
  // What the Zero client in context was CONSTRUCTED with — `undefined` for the anonymous client.
  zeroContext: undefined as AuthContext | undefined,
  teams: [] as unknown[],
  result: { type: 'complete' } as { type: 'complete' | 'unknown' | 'error' },
  retryOffered: false,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [harness.teams, harness.result],
  useZero: () => ({ context: harness.zeroContext }),
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

// The client Zero rebuilds around a settled credential — the one whose roster may be trusted.
const SETTLED_CLIENT: AuthContext = { userID: 'viewer-1', role: 'member', pmAudienceTeamIds: [] }

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
  harness.zeroContext = SETTLED_CLIENT
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
  harness.zeroContext = { ...SETTLED_CLIENT, role: 'admin' }
  harness.teams = [team('team-1', [])]
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-1')
})

// The defect this suite could not see until it modelled the two facts separately, and the reason it
// could not: every earlier case described a SETTLED moment, and the bug lives in one commit of
// transition. Signing in mints the credential and rebuilds the Zero client around it, but the client
// arrives a commit later — so `status` says `ready` while the roster on screen is still the
// anonymous one, which `denyAll` answered complete-and-EMPTY. Deciding there sent a workspace admin
// with teams to `/`, every time, because the redirect fires from a layout effect and the replacement
// client from a passive one.
test('a roster resolved before the client was rebuilt decides nothing, and the rebuilt one decides', () => {
  harness.sync = { ...READY, role: 'admin' }
  harness.zeroContext = undefined
  harness.teams = []
  harness.result = { type: 'complete' }
  const view = render(<LoginPage />)

  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')

  harness.zeroContext = { ...SETTLED_CLIENT, role: 'admin' }
  harness.teams = [team('team-1', [])]
  view.rerender(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/teams/team-1')
})

// The same gap on the other axis: the identity never changes, only the role does — which is exactly
// what accepting an invitation does, and a `null` role reads the roster through `denyAll` too.
test('a roster resolved under the previous role decides nothing either', () => {
  harness.sync = READY
  harness.zeroContext = { ...SETTLED_CLIENT, role: null }
  harness.teams = []
  render(<LoginPage />)

  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
})

// …and the wait this introduces still ends where it should. A roster that is empty because the
// workspace holds no team is a correct answer once the client asking is the caller's own, and it
// lands on administration rather than waiting for teams that will never arrive.
test('an empty roster from the caller’s own client still lands on the workspace surface', () => {
  harness.teams = []
  render(<LoginPage />)

  expect(screen.getByTestId('navigate')).toHaveTextContent('/')
})
