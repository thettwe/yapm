import { render, screen, waitFor } from '@testing-library/react'
import type { AuthContext } from '@yapm/schema'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { SyncSessionState } from '@/zero/provider'

// Invitation acceptance is the fourth door into the product (design §D10), and until this change it
// answered the landing question on its own authority. What this suite proves is that it now takes
// the same decision `/login` takes — and that a team-bound acceptance short-circuits it on the
// strongest evidence there is: the membership row the server has just written.

const harness = vi.hoisted(() => ({
  sync: {} as SyncSessionState,
  // What the Zero client in context was CONSTRUCTED with, which after `refresh()` still names the
  // role the caller held BEFORE the acceptance until the replacement client lands.
  zeroContext: undefined as AuthContext | undefined,
  teams: [] as unknown[],
  result: { type: 'complete' } as { type: 'complete' | 'unknown' | 'error' },
  retryOffered: false,
  navigate: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [harness.teams, harness.result],
  useZero: () => ({ context: harness.zeroContext }),
}))

vi.mock('@tanstack/react-router', () => ({
  // `to` is the router's prop, not the DOM's; dropping it keeps jsdom from warning about it.
  Link: ({ children }: { to: string; children: ReactNode }) => <a href="/">{children}</a>,
  // Reached through `@/components/authenticated`, which owns the shared retry surface.
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
  useNavigate: () => harness.navigate,
}))

vi.mock('@/auth/client', () => ({
  authClient: {},
  signIn: { email: vi.fn(), social: vi.fn(), sso: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => ({ data: null, isPending: false }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => harness.sync,
  useSyncControl: () => ({ refresh: harness.refresh, retry: vi.fn() }),
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

import { InvitePage } from './invite-page'

const READY: SyncSessionState = {
  status: 'ready',
  userID: 'viewer-1',
  role: 'member',
  pmAudienceTeamIds: [],
  unavailable: false,
}

const SETTLED_CLIENT: AuthContext = { userID: 'viewer-1', role: 'member', pmAudienceTeamIds: [] }

const team = (id: string, memberIds: readonly string[]) => ({
  id,
  name: id,
  key: id.toUpperCase(),
  members: memberIds.map((userId) => ({ userId })),
})

function accepts(body: Record<string, unknown>, ok = true, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, status, json: () => Promise.resolve(body) })),
  )
}

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
  harness.sync = READY
  harness.zeroContext = SETTLED_CLIENT
  harness.teams = []
  harness.result = { type: 'complete' }
  harness.retryOffered = false
  harness.navigate.mockReset()
  harness.refresh.mockReset()
  accepts({})
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// The team the acceptance itself granted, taken from the response the server already returns. No
// roster wait and no readability test: the membership row exists before the navigation is taken.
test('a team-bound acceptance lands on that team', async () => {
  accepts({ teamId: 'team-bound' })
  harness.teams = [team('team-other', ['viewer-1'])]
  render(<InvitePage token="invite-token" />)

  await waitFor(() =>
    expect(harness.navigate).toHaveBeenCalledWith({
      to: '/teams/$teamId',
      params: { teamId: 'team-bound' },
    }),
  )
})

test('a workspace-level acceptance falls to the shared landing resolution', async () => {
  accepts({})
  harness.teams = [team('team-strangers', ['someone-else']), team('team-own', ['viewer-1'])]
  render(<InvitePage token="invite-token" />)

  await waitFor(() =>
    expect(harness.navigate).toHaveBeenCalledWith({
      to: '/teams/$teamId',
      params: { teamId: 'team-own' },
    }),
  )
})

test('a workspace-level acceptance with no readable team lands on the workspace surface', async () => {
  accepts({})
  harness.teams = [team('team-strangers', ['someone-else'])]
  render(<InvitePage token="invite-token" />)

  await waitFor(() => expect(harness.navigate).toHaveBeenCalledWith({ to: '/' }))
})

// The gap `/login` was caught by, on this door's own axis. `refresh()` re-mints the credential with
// the role the acceptance just granted, and the Zero client is rebuilt around it a commit later — so
// there is a moment where the credential says `member` while the roster on screen is the one a
// non-member could read: `denyAll`, complete, empty. Landing on `/` there strands the caller who has
// just joined on administration.
test('a workspace-level acceptance does not decide on the roster its old role could read', async () => {
  accepts({})
  harness.zeroContext = { ...SETTLED_CLIENT, role: null }
  harness.teams = []
  const view = render(<InvitePage token="invite-token" />)

  await waitFor(() => expect(harness.refresh).toHaveBeenCalled())
  expect(harness.navigate).not.toHaveBeenCalled()

  harness.zeroContext = SETTLED_CLIENT
  harness.teams = [team('team-own', ['viewer-1'])]
  view.rerender(<InvitePage token="invite-token" />)

  await waitFor(() =>
    expect(harness.navigate).toHaveBeenCalledWith({
      to: '/teams/$teamId',
      params: { teamId: 'team-own' },
    }),
  )
})

// The same gate `/login` holds: a roster that has not settled decides nothing, so a brand-new
// member is never answered by a roster that is empty only because it is early.
test('a workspace-level acceptance waits for the roster rather than guessing', async () => {
  accepts({})
  harness.result = { type: 'unknown' }
  harness.teams = []
  render(<InvitePage token="invite-token" />)

  await waitFor(() => expect(harness.refresh).toHaveBeenCalled())
  expect(harness.navigate).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('Accepting your invitation…')
  // The membership is granted either way, so the wait always carries a way out of it.
  expect(screen.getByRole('link', { name: 'Go to the app' })).toBeInTheDocument()
})

// …and the wait ends. The acceptor of a workspace-level invitation has nothing else on screen, so a
// roster that never settles would strand exactly the caller who has just joined.
test('a roster that never settles ends the wait on the shared retry surface', async () => {
  accepts({})
  harness.result = { type: 'unknown' }
  harness.retryOffered = true
  render(<InvitePage token="invite-token" />)

  expect(await screen.findByTestId('sync-unavailable')).toBeInTheDocument()
  expect(screen.getByTestId('sync-unavailable-retry')).toBeInTheDocument()
  expect(harness.navigate).not.toHaveBeenCalled()
})

// A team-bound acceptance never waits on the roster at all, so the bound must not steal its landing.
test('a team-bound acceptance lands even while the roster is unreachable', async () => {
  accepts({ teamId: 'team-bound' })
  harness.result = { type: 'unknown' }
  harness.retryOffered = true
  render(<InvitePage token="invite-token" />)

  await waitFor(() =>
    expect(harness.navigate).toHaveBeenCalledWith({
      to: '/teams/$teamId',
      params: { teamId: 'team-bound' },
    }),
  )
})

test('a spent invitation states why and navigates nowhere', async () => {
  accepts({ error: 'not_found' }, false, 404)
  render(<InvitePage token="invite-token" />)

  expect(await screen.findByRole('alert')).toHaveTextContent('This invitation is no longer valid.')
  expect(harness.navigate).not.toHaveBeenCalled()
})

test('an unreachable server states so rather than hanging on the accepting state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('offline'))),
  )
  render(<InvitePage token="invite-token" />)

  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server')
})

test('a link with no token says so and never calls the accept endpoint', () => {
  render(<InvitePage />)

  expect(screen.getByRole('alert')).toHaveTextContent('missing its token')
  expect(globalThis.fetch).not.toHaveBeenCalled()
})

test('a signed-out invitee is offered the sign-in surface on the invitation page itself', () => {
  harness.sync = { ...READY, status: 'logged-out', userID: null, role: null }
  render(<InvitePage token="invite-token" />)

  expect(screen.getByTestId('login-form')).toBeInTheDocument()
  expect(globalThis.fetch).not.toHaveBeenCalled()
})
