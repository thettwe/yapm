import type { ConnectionState } from '@rocicorp/zero'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BACKOFF_CAP_MS } from './backoff'
import {
  CONNECTION_SETTLED_MS,
  DISCONNECTED_GRACE_MS,
  RETRY_OFFER_AFTER_MS,
  useSyncRecovery,
} from './recovery'
import type { SyncCredentialResult } from './session'

const mocks = vi.hoisted(() => {
  let state: ConnectionState = { name: 'connecting' }
  const listeners = new Set<() => void>()
  let authData: { user: { id: string } } | null = { user: { id: 'user-1' } }
  const authListeners = new Set<() => void>()
  return {
    connect: vi.fn(() => Promise.resolve()),
    fetchSyncCredential: vi.fn(),
    // What `ZeroRoot` actually hands the provider — the handler assertions read these — and how
    // many times the provider mounted, which is how a `key`-driven client replacement shows up.
    zeroProviderProps: null as Record<string, unknown> | null,
    zeroProviderMounts: 0,
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(next: ConnectionState) {
      state = next
      for (const listener of listeners) listener()
    },
    getAuth: () => authData,
    subscribeAuth: (listener: () => void) => {
      authListeners.add(listener)
      return () => authListeners.delete(listener)
    },
    setAuthUser(id: string | null) {
      authData = id === null ? null : { user: { id } }
      for (const listener of authListeners) listener()
    },
    reset() {
      state = { name: 'connecting' }
      listeners.clear()
      authData = { user: { id: 'user-1' } }
      authListeners.clear()
      this.zeroProviderProps = null
      this.zeroProviderMounts = 0
    },
  }
})

vi.mock('@rocicorp/zero/react', async () => {
  const { useSyncExternalStore, useEffect } = await import('react')
  return {
    ZeroProvider: ({ children, ...props }: { children: React.ReactNode }) => {
      mocks.zeroProviderProps = props
      useEffect(() => {
        mocks.zeroProviderMounts += 1
      }, [])
      return children
    },
    // Deliberately a fresh object per call: the scheduler must not key off the Zero
    // instance's identity, or it re-runs on every render and becomes the hot loop.
    useZero: () => ({ connection: { connect: mocks.connect } }),
    useConnectionState: () => useSyncExternalStore(mocks.subscribe, mocks.getState),
  }
})

vi.mock('@/auth/client', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => ({ data: useSyncExternalStore(mocks.subscribeAuth, mocks.getAuth) }),
  }
})

vi.mock('@/zero/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/session')>()),
  fetchSyncCredential: mocks.fetchSyncCredential,
}))

import { useSyncCondition } from './condition'
import { useSyncControl, useSyncSession, ZeroRoot } from './provider'

const SESSION: SyncCredentialResult = {
  kind: 'session',
  userID: 'user-1',
  token: 'jwt-1',
  role: 'member',
  pmAudienceTeamIds: [],
  expiresAt: null,
}

function Probe() {
  const recovery = useSyncRecovery()
  const session = useSyncSession()
  const condition = useSyncCondition()
  const { refresh, retry } = useSyncControl()
  return (
    <div>
      <span data-testid="condition">{condition.kind}</span>
      <span data-testid="phase">{recovery.phase}</span>
      <span data-testid="attempt">{String(recovery.attempt)}</span>
      <span data-testid="delay">{String(Math.round(recovery.delayMs))}</span>
      <span data-testid="offered">{String(recovery.retryOffered)}</span>
      <span data-testid="role">{session.role ?? 'none'}</span>
      <span data-testid="status">{session.status}</span>
      <span data-testid="unavailable">{String(session.unavailable)}</span>
      <button type="button" data-testid="retry" onClick={recovery.retryNow}>
        retry
      </button>
      <button type="button" data-testid="refresh" onClick={refresh}>
        refresh
      </button>
      <button type="button" data-testid="outage-retry" onClick={retry}>
        outage retry
      </button>
    </div>
  )
}

async function mount() {
  const view = render(
    <ZeroRoot cacheUrl="http://localhost:4848">
      <Probe />
    </ZeroRoot>,
  )
  await act(async () => {})
  return view
}

async function transition(next: ConnectionState) {
  await act(async () => {
    mocks.emit(next)
  })
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function remintCount() {
  return mocks.fetchSyncCredential.mock.calls.length
}

beforeEach(() => {
  vi.useFakeTimers()
  // Full jitter with the roll pinned to the top of the window makes each scheduled delay
  // exactly the ceiling, so the growth and the cap are assertable.
  vi.spyOn(Math, 'random').mockReturnValue(0.999_999)
  mocks.reset()
  mocks.connect.mockClear().mockResolvedValue(undefined)
  mocks.fetchSyncCredential.mockReset().mockResolvedValue(SESSION)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

test('the initial connect mints exactly one token and starts no recovery', async () => {
  await mount()

  expect(remintCount()).toBe(1)
  expect(screen.getByTestId('phase')).toHaveTextContent('idle')
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('connecting neither re-mints nor resets, so a connect/error cycle cannot reset the backoff', async () => {
  await mount()
  const baseline = remintCount()

  await transition({ name: 'error', reason: 'InvalidConnectionRequest' })
  await advance(BACKOFF_CAP_MS)
  const afterFirst = remintCount()
  expect(afterFirst).toBeGreaterThan(baseline)

  await transition({ name: 'connecting' })
  await advance(BACKOFF_CAP_MS * 2)
  expect(remintCount()).toBe(afterFirst)

  await transition({ name: 'error', reason: 'again' })
  expect(screen.getByTestId('attempt')).toHaveTextContent('1')
})

test('closed is terminal: no re-mint, no reconnect', async () => {
  await mount()
  const baseline = remintCount()

  await transition({ name: 'closed', reason: 'zero.close()' })
  await advance(BACKOFF_CAP_MS * 4)

  expect(remintCount()).toBe(baseline)
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('an error re-mints and reconnects — the state the old code never escaped', async () => {
  await mount()

  await transition({ name: 'error', reason: 'InvalidConnectionRequest' })
  expect(screen.getByTestId('phase')).toHaveTextContent('waiting')

  await advance(1_000)

  expect(remintCount()).toBe(2)
  expect(mocks.connect).toHaveBeenCalledTimes(1)
})

test('needs-auth re-mints and reconnects', async () => {
  await mount()

  await transition({ name: 'needs-auth', reason: { type: 'query', status: 401 } })
  await advance(1_000)

  expect(remintCount()).toBe(2)
  expect(mocks.connect).toHaveBeenCalledTimes(1)
})

test('an unchanged token still forces a reconnect, because the auth prop would not change', async () => {
  await mount()

  await transition({ name: 'error', reason: 'boom' })
  await advance(1_000)

  expect(mocks.fetchSyncCredential).toHaveReturnedTimes(2)
  expect(mocks.connect).toHaveBeenCalledTimes(1)
  expect(mocks.connect).toHaveBeenCalledWith()
})

test('a changed token is left to the provider, so the reconnect is not doubled', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ ...SESSION, token: 'jwt-2' })

  await transition({ name: 'error', reason: 'boom' })
  await advance(1_000)

  expect(remintCount()).toBe(2)
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('disconnected waits out the grace, re-mints, and never calls connect', async () => {
  await mount()
  const baseline = remintCount()

  await transition({ name: 'disconnected', reason: 'socket closed' })
  await advance(DISCONNECTED_GRACE_MS - 1_000)
  expect(remintCount()).toBe(baseline)

  await advance(2_000)
  expect(remintCount()).toBe(baseline + 1)
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('a repeatedly failing recovery backs off and cannot become a hot loop', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TypeError' })
  const baseline = remintCount()

  await transition({ name: 'error', reason: 'boom' })

  const delays: number[] = []
  for (let i = 0; i < 8; i++) {
    delays.push(Number(screen.getByTestId('delay').textContent))
    await advance(BACKOFF_CAP_MS + 1_000)
  }

  expect(delays.slice(0, 6)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, BACKOFF_CAP_MS])
  for (const delay of delays) expect(delay).toBeLessThanOrEqual(BACKOFF_CAP_MS)

  // Eight windows of a capped schedule, not thousands of spins.
  expect(remintCount()).toBe(baseline + 8)
})

test('a failing recovery never signs the user out', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TypeError' })

  await transition({ name: 'error', reason: 'boom' })
  await advance(BACKOFF_CAP_MS * 6)

  expect(screen.getByTestId('phase')).toBeInTheDocument()
  expect(screen.queryByTestId('sync-unavailable')).not.toBeInTheDocument()
})

test('a rejected credential stops the loop — that is a real logout, not an outage', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'no-session' })

  await transition({ name: 'error', reason: 'boom' })
  await advance(1_000)
  const afterRejection = remintCount()

  await advance(BACKOFF_CAP_MS * 4)
  expect(remintCount()).toBe(afterRejection)
})

test('reconnecting resets the schedule so the next outage starts fast again', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TypeError' })

  await transition({ name: 'error', reason: 'boom' })
  await advance(BACKOFF_CAP_MS * 5)
  expect(Number(screen.getByTestId('attempt').textContent)).toBeGreaterThan(0)

  await transition({ name: 'connected' })
  expect(screen.getByTestId('phase')).toHaveTextContent('idle')

  await advance(CONNECTION_SETTLED_MS)
  expect(screen.getByTestId('attempt')).toHaveTextContent('0')

  mocks.fetchSyncCredential.mockResolvedValue(SESSION)
  await transition({ name: 'error', reason: 'boom' })
  expect(screen.getByTestId('delay')).toHaveTextContent('1000')
})

// The regression this change exists to close. Zero reports `connected` on socket open, so a
// credential that zero-cache refuses produces `needs-auth → connecting → connected →
// needs-auth` forever. Resetting the counter on arrival at `connected` pinned every delay at
// the first backoff step; measured live at ~75 re-mints in 45s with the CPU pegged.
test('a connection that fails validation cannot reset the backoff by passing through connected', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue(SESSION)

  const delays: number[] = []
  for (let cycle = 0; cycle < 6; cycle += 1) {
    await transition({ name: 'needs-auth', reason: { type: 'query', status: 401 } })
    delays.push(Number(screen.getByTestId('delay').textContent))
    await advance(BACKOFF_CAP_MS)
    await transition({ name: 'connecting' })
    // Held for less than the settle window, exactly as a refused connection is.
    await transition({ name: 'connected' })
    await advance(CONNECTION_SETTLED_MS / 4)
  }

  expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000])
})

test('a connection that holds does reset the backoff', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue(SESSION)

  await transition({ name: 'needs-auth', reason: { type: 'query', status: 401 } })
  await advance(BACKOFF_CAP_MS)
  await transition({ name: 'connected' })
  await advance(CONNECTION_SETTLED_MS)

  await transition({ name: 'needs-auth', reason: { type: 'query', status: 401 } })
  expect(screen.getByTestId('delay')).toHaveTextContent('1000')
})

test('the manual retry is offered once waiting stops feeling like a hiccup', async () => {
  await mount()

  await transition({ name: 'disconnected', reason: 'socket closed' })
  expect(screen.getByTestId('offered')).toHaveTextContent('false')

  await advance(RETRY_OFFER_AFTER_MS + 100)
  expect(screen.getByTestId('offered')).toHaveTextContent('true')
})

test('the manual retry restarts the schedule with no wait at all', async () => {
  await mount()
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TypeError' })

  await transition({ name: 'error', reason: 'boom' })
  await advance(BACKOFF_CAP_MS * 5)
  const before = remintCount()

  await act(async () => {
    screen.getByTestId('retry').click()
  })
  expect(screen.getByTestId('delay')).toHaveTextContent('0')

  // A zero-length window is enough — the user does not wait out the remaining backoff.
  await advance(0)
  expect(remintCount()).toBe(before + 1)
  expect(screen.getByTestId('attempt')).toHaveTextContent('1')
})

test('recovery stays out of the way once the endpoint says the caller is signed out', async () => {
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'no-session' })
  await mount()
  const baseline = remintCount()

  await transition({ name: 'error', reason: 'boom' })
  await advance(BACKOFF_CAP_MS * 4)

  expect(remintCount()).toBe(baseline)
})

test('concurrent recovery and membership refreshes share one in-flight token request', async () => {
  let release: ((result: SyncCredentialResult) => void) | undefined
  mocks.fetchSyncCredential.mockImplementation(
    () =>
      new Promise<SyncCredentialResult>((resolve) => {
        release = resolve
      }),
  )

  render(
    <ZeroRoot cacheUrl="http://localhost:4848">
      <Probe />
    </ZeroRoot>,
  )
  await act(async () => {})
  expect(remintCount()).toBe(1)

  await transition({ name: 'error', reason: 'boom' })
  await advance(1_000)

  // The mount fetch is still open, so the recovery attempt must join it rather than
  // racing a second token onto the same connection.
  expect(remintCount()).toBe(1)

  await act(async () => {
    release?.(SESSION)
  })
})

// The membership case the control exists for: accepting an invite changes the role the
// server bakes into the credential, so an answer minted before the change committed would
// leave the new member parked on the access gate until they reloaded.
test('a membership refresh never settles for a token minted before the change', async () => {
  const releases: ((result: SyncCredentialResult) => void)[] = []
  mocks.fetchSyncCredential.mockImplementation(
    () =>
      new Promise<SyncCredentialResult>((resolve) => {
        releases.push(resolve)
      }),
  )

  await mount()
  expect(remintCount()).toBe(1)

  await act(async () => {
    screen.getByTestId('refresh').click()
  })
  // Chained, not raced: the server is asked once the earlier answer is in.
  expect(remintCount()).toBe(1)

  await act(async () => {
    releases[0]?.({ ...SESSION, role: null })
  })
  expect(remintCount()).toBe(2)
  expect(screen.getByTestId('role'), 'the superseded answer is discarded').toHaveTextContent('none')

  await act(async () => {
    releases[1]?.({ ...SESSION, role: 'admin' })
  })
  expect(screen.getByTestId('role')).toHaveTextContent('admin')
})

// The outage surface's "Retry now" is the opposite case to the membership refresh above:
// there is nothing newer to wait for, so forcing would throw away the answer already on its
// way and queue a second request behind it — pressing the button would slow recovery down.
test('the outage retry joins the open request and takes its answer', async () => {
  const releases: ((result: SyncCredentialResult) => void)[] = []
  mocks.fetchSyncCredential.mockImplementation(
    () =>
      new Promise<SyncCredentialResult>((resolve) => {
        releases.push(resolve)
      }),
  )

  await mount()
  expect(remintCount()).toBe(1)

  await act(async () => {
    screen.getByTestId('outage-retry').click()
  })
  expect(remintCount()).toBe(1)

  await act(async () => {
    releases[0]?.({ ...SESSION, role: 'admin' })
  })
  // The in-flight answer lands instead of being discarded, and nothing was queued behind it.
  expect(screen.getByTestId('role')).toHaveTextContent('admin')
  expect(remintCount()).toBe(1)
})

// Recovery and the proactive refresher keep sharing one request — only `refresh()` forces.
test('recovery still joins an open request rather than forcing a second one', async () => {
  mocks.fetchSyncCredential.mockImplementation(() => new Promise<SyncCredentialResult>(() => {}))

  await mount()
  await transition({ name: 'error', reason: 'boom' })
  await advance(1_000)

  expect(remintCount()).toBe(1)
})

// Nothing else re-arms while the session is still `pending`: `SyncRecovery` sees a healthy
// client and the proactive refresher is gated on `ready`. Without this loop the
// "Can't reach the server — retrying" surface would never retry.
test('a first credential request that never lands is retried on backoff', async () => {
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TypeError' })

  await mount()
  expect(remintCount()).toBe(1)

  await advance(BACKOFF_CAP_MS)
  const retried = remintCount()
  expect(retried).toBeGreaterThan(1)

  mocks.fetchSyncCredential.mockResolvedValue(SESSION)
  await advance(BACKOFF_CAP_MS)
  expect(remintCount()).toBe(retried + 1)

  // A settled session stops the loop — it does not keep polling behind a healthy app.
  await advance(BACKOFF_CAP_MS * 4)
  expect(remintCount()).toBe(retried + 1)
})

// Zero closes the socket of a tab hidden for five minutes on purpose, then parks its run
// loop until the tab is visible. Re-minting against that turns every backgrounded tab into
// a permanent token poll.
test('a hidden tab does not re-mint against its own deliberate disconnect', async () => {
  await mount()
  const baseline = remintCount()

  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

  await transition({ name: 'disconnected', reason: 'Connection closed because tab was hidden' })
  await advance(DISCONNECTED_GRACE_MS * 5)

  expect(remintCount()).toBe(baseline)
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('a token that expires soon is re-minted before the socket ever breaks', async () => {
  const expiresAt = Math.floor((Date.now() + 40 * 60_000) / 1_000)
  mocks.fetchSyncCredential.mockResolvedValue({ ...SESSION, expiresAt })

  await mount()
  await transition({ name: 'connected' })
  expect(remintCount()).toBe(1)

  // 75% of 40 minutes is clamped to the 30-minute ceiling.
  await advance(29 * 60_000)
  expect(remintCount()).toBe(1)

  await advance(2 * 60_000)
  expect(remintCount()).toBe(2)
  expect(mocks.connect).not.toHaveBeenCalled()
})

test('waking a tab that slept past half the token lifetime re-mints', async () => {
  const expiresAt = Math.floor((Date.now() + 60 * 60_000) / 1_000)
  mocks.fetchSyncCredential.mockResolvedValue({ ...SESSION, expiresAt })

  await mount()
  await transition({ name: 'connected' })
  expect(remintCount()).toBe(1)

  vi.setSystemTime(Date.now() + 40 * 60_000)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
  })

  expect(remintCount()).toBe(2)
})

test('a wake early in the token lifetime does not re-mint', async () => {
  const expiresAt = Math.floor((Date.now() + 60 * 60_000) / 1_000)
  mocks.fetchSyncCredential.mockResolvedValue({ ...SESSION, expiresAt })

  await mount()
  await transition({ name: 'connected' })

  vi.setSystemTime(Date.now() + 60_000)
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('online'))
  })

  expect(remintCount()).toBe(1)
})

// THE FALSIFIABLE CHECK for the sign-up wedge. The sequence is the one a real trace recorded:
// the anonymous mount mints once and is answered 401 — which is CORRECT, nobody is signed in —
// and that sets `logged-out`. Signing up re-mints, and if THAT request fails (it is bounded by
// the client's own 10s timeout, and a cold server can exceed it), `applyCredential` preserves the
// previous status. The session therefore sits at `logged-out` with `unavailable` set. While the
// retry was scoped to `pending`, nothing was scheduled to ask again and the client stayed wedged
// until the tab was reloaded — invisible to this suite because it only ever ran the dev server,
// which is slow enough to boot that the server is always warm by the first mint.
test('a failed mint after a 401 keeps asking — a logged-out session is not a settled one', async () => {
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'no-session' })
  await mount()
  expect(remintCount()).toBe(1)

  // Sign-up happens — which re-mints, exactly as the identity change does in the app — and the
  // next answer is a transient failure rather than a refusal.
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'unavailable', reason: 'TimeoutError' })
  await act(async () => {
    screen.getByTestId('refresh').click()
  })
  const afterFailure = remintCount()

  await advance(BACKOFF_CAP_MS * 3)
  expect(remintCount()).toBeGreaterThan(afterFailure)
})

// The other identity-change hazard, both ways in one sequence: sign-up flips the identity while
// the anonymous mount's mint is still in flight. That flight was asked about NOBODY — if the
// identity change coalesced onto it, its `no-session` answer would settle over the pending reset
// as a clean, settled logged-out, which neither RC1 guard can catch (the reset is overwritten;
// the retry surface keys on `unavailable`, which is false) — and the redirect cycle is back. The
// stale answer must be DISCARDED, and the post-identity answer must be the one APPLIED.
test('an identity change mid-flight discards the stale answer and applies the fresh one', async () => {
  const releases: ((result: SyncCredentialResult) => void)[] = []
  mocks.fetchSyncCredential.mockImplementation(
    () =>
      new Promise<SyncCredentialResult>((resolve) => {
        releases.push(resolve)
      }),
  )
  mocks.setAuthUser(null)
  await mount()
  expect(remintCount()).toBe(1)

  // Sign-up: the identity flips while the anonymous mint is open. The new request chains behind
  // the open one rather than racing a second token onto the same connection.
  await act(async () => {
    mocks.setAuthUser('user-1')
  })
  expect(remintCount()).toBe(1)

  // The pre-identity flight settles with the answer to a question nobody is asking anymore.
  await act(async () => {
    releases[0]?.({ kind: 'no-session' })
  })
  expect(screen.getByTestId('status'), 'the stale refusal is discarded').toHaveTextContent(
    'pending',
  )
  expect(remintCount()).toBe(2)

  // The post-identity answer is the one applied.
  await act(async () => {
    releases[1]?.(SESSION)
  })
  expect(screen.getByTestId('status')).toHaveTextContent('ready')
  expect(screen.getByTestId('role')).toHaveTextContent('member')
})

// The other half of the same rule: a definitive refusal still settles. Otherwise the fix above
// would turn every signed-out tab into a polling loop against `/api/zero/token`.
test('a settled logged-out session does not poll', async () => {
  mocks.fetchSyncCredential.mockResolvedValue({ kind: 'no-session' })
  await mount()
  const afterRefusal = remintCount()

  await advance(BACKOFF_CAP_MS * 4)
  expect(remintCount()).toBe(afterRefusal)
})

// The regression the merge gate caught on PR #53's first review fix. On a reload against a hung
// token route, the mount mints flight #1; the auth session resolving milliseconds later counts as
// an identity change, and the fresh re-mint CHAINS flight #2 behind the hung #1 while superseding
// it. When #1 finally settles `unavailable` at the client's own timeout, a settle that dropped
// everything from a superseded flight dropped the outage too — pushing the retry surface a full
// second timeout later than the moment the outage was known. An outage is identity-independent;
// only a superseded flight's SESSION answer is stale.
test('a superseded flight still surfaces an outage at the first timeout, not the second', async () => {
  let resolveFirst!: (result: SyncCredentialResult) => void
  mocks.fetchSyncCredential
    .mockImplementationOnce(
      () =>
        new Promise<SyncCredentialResult>((resolve) => {
          resolveFirst = resolve
        }),
    )
    // The outage is real, so the chained fresh flight hangs too.
    .mockImplementation(() => new Promise<SyncCredentialResult>(() => {}))

  await mount()
  expect(remintCount()).toBe(1)

  // The identity changes while flight #1 is still in the air.
  await act(async () => {
    mocks.setAuthUser('user-2')
  })
  expect(screen.getByTestId('unavailable')).toHaveTextContent('false')

  // Flight #1 settles unavailable — superseded, but the outage must surface NOW.
  await act(async () => {
    resolveFirst({ kind: 'unavailable', reason: 'TimeoutError' })
  })
  expect(screen.getByTestId('unavailable')).toHaveTextContent('true')
  expect(remintCount()).toBe(2)
})

// ---- The sync-recovery handlers (e2e-determinism section 4) -------------------------------------

// The library's default for BOTH conditions is `location.reload()` — the page taken out from
// under whoever is using it. Supplying both handlers is what makes that path unreachable; this
// asserts the wiring so a refactor cannot silently drop one and reopen it.
test('ZeroRoot supplies both sync-recovery handlers, so the library reload path is unreachable', async () => {
  await mount()

  expect(typeof mocks.zeroProviderProps?.onClientStateNotFound).toBe('function')
  expect(typeof mocks.zeroProviderProps?.onUpdateNeeded).toBe('function')
})

test('an unknown client routes into recovery: a replacement client, a surfaced condition, no reload', async () => {
  await mount()
  const mountsBefore = mocks.zeroProviderMounts
  const handler = mocks.zeroProviderProps?.onClientStateNotFound as () => void

  await act(async () => {
    handler()
  })

  // The condition is on the statusline's wire, and the dead client was replaced in place —
  // a remount, which is the React provider's own recovery, made visible.
  expect(screen.getByTestId('condition')).toHaveTextContent('client-reset')
  expect(mocks.zeroProviderMounts).toBe(mountsBefore + 1)

  // The moment the replacement connects, the condition clears — it was a repair, not a state.
  await transition({ name: 'connected' })
  expect(screen.getByTestId('condition')).toHaveTextContent('none')
})

test('a version mismatch surfaces to the user and never reloads — not even with a write in flight', async () => {
  // A write in flight: the credential fetch that would carry its refreshed role never settles,
  // exactly the moment a library-initiated reload would discard the optimistic write.
  mocks.fetchSyncCredential
    .mockResolvedValueOnce(SESSION)
    .mockImplementation(() => new Promise<SyncCredentialResult>(() => {}))
  await mount()
  const mountsBefore = mocks.zeroProviderMounts
  const handler = mocks.zeroProviderProps?.onUpdateNeeded as (reason: {
    type: string
    message?: string
  }) => void

  await act(async () => {
    handler({ type: 'VersionNotSupported' })
  })

  // Surfaced, not acted on: the client is left untouched (no remount tears down its queued
  // writes) and nothing navigated. The refresh is the user's, offered in the statusline.
  expect(screen.getByTestId('condition')).toHaveTextContent('update-needed')
  expect(mocks.zeroProviderMounts).toBe(mountsBefore)

  // Zero repeats the callback on every failed connect attempt; an unchanged reason must not churn.
  await act(async () => {
    handler({ type: 'VersionNotSupported' })
  })
  expect(screen.getByTestId('condition')).toHaveTextContent('update-needed')

  // A connect alone does not clear it — only the user's refresh resolves an update condition.
  await transition({ name: 'connected' })
  expect(screen.getByTestId('condition')).toHaveTextContent('update-needed')
})
