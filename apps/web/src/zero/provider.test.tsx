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
  return {
    connect: vi.fn(() => Promise.resolve()),
    fetchSyncCredential: vi.fn(),
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(next: ConnectionState) {
      state = next
      for (const listener of listeners) listener()
    },
    reset() {
      state = { name: 'connecting' }
      listeners.clear()
    },
  }
})

vi.mock('@rocicorp/zero/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    ZeroProvider: ({ children }: { children: React.ReactNode }) => children,
    // Deliberately a fresh object per call: the scheduler must not key off the Zero
    // instance's identity, or it re-runs on every render and becomes the hot loop.
    useZero: () => ({ connection: { connect: mocks.connect } }),
    useConnectionState: () => useSyncExternalStore(mocks.subscribe, mocks.getState),
  }
})

vi.mock('@/auth/client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1' } } }),
}))

vi.mock('@/zero/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/session')>()),
  fetchSyncCredential: mocks.fetchSyncCredential,
}))

import { ZeroRoot } from './provider'

const SESSION: SyncCredentialResult = {
  kind: 'session',
  userID: 'user-1',
  token: 'jwt-1',
  role: 'member',
  expiresAt: null,
}

function Probe() {
  const recovery = useSyncRecovery()
  return (
    <div>
      <span data-testid="phase">{recovery.phase}</span>
      <span data-testid="attempt">{String(recovery.attempt)}</span>
      <span data-testid="delay">{String(Math.round(recovery.delayMs))}</span>
      <span data-testid="offered">{String(recovery.retryOffered)}</span>
      <button type="button" data-testid="retry" onClick={recovery.retryNow}>
        retry
      </button>
    </div>
  )
}

async function mount() {
  const view = render(
    <ZeroRoot>
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
    <ZeroRoot>
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
