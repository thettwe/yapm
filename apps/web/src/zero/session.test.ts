import { afterEach, expect, test, vi } from 'vitest'
import {
  fetchSyncCredential,
  PROACTIVE_FALLBACK_MS,
  PROACTIVE_MAX_MS,
  PROACTIVE_MIN_MS,
  proactiveRefreshDelay,
  SYNC_TOKEN_TIMEOUT_MS,
  shouldRefreshOnWake,
} from './session'

function respond(status: number, body?: unknown, init?: { malformed?: boolean }): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: init?.malformed
      ? () => Promise.reject(new SyntaxError('Unexpected token <'))
      : () => Promise.resolve(body),
  } as unknown as Response
}

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

test('a valid response yields a session with the server-resolved role', async () => {
  stubFetch(() =>
    Promise.resolve(
      respond(200, { token: 'jwt-1', userID: 'user-1', role: 'member', expiresAt: 1_800 }),
    ),
  )

  await expect(fetchSyncCredential()).resolves.toEqual({
    kind: 'session',
    userID: 'user-1',
    token: 'jwt-1',
    role: 'member',
    expiresAt: 1_800,
  })
})

test('an authenticated non-member is a session with a null role, not a rejection', async () => {
  stubFetch(() => Promise.resolve(respond(200, { token: 'jwt-1', userID: 'user-1', role: null })))

  await expect(fetchSyncCredential()).resolves.toMatchObject({ kind: 'session', role: null })
})

test('a missing expiresAt degrades to null rather than breaking the parse', async () => {
  stubFetch(() =>
    Promise.resolve(respond(200, { token: 'jwt-1', userID: 'user-1', role: 'admin' })),
  )

  await expect(fetchSyncCredential()).resolves.toMatchObject({ expiresAt: null })
})

test('a nonsense expiresAt is discarded, not trusted', async () => {
  for (const expiresAt of ['soon', -1, 0, Number.NaN, null]) {
    stubFetch(() => Promise.resolve(respond(200, { token: 'jwt-1', userID: 'user-1', expiresAt })))
    await expect(fetchSyncCredential()).resolves.toMatchObject({ expiresAt: null })
  }
})

test('only 401 and 403 mean "not signed in"', async () => {
  for (const status of [401, 403]) {
    stubFetch(() => Promise.resolve(respond(status, { error: 'unauthorized' })))
    await expect(fetchSyncCredential()).resolves.toEqual({ kind: 'no-session' })
  }
})

test('every other non-OK status is unavailable, so the session survives it', async () => {
  for (const status of [400, 404, 429, 500, 502, 503]) {
    stubFetch(() => Promise.resolve(respond(status, { error: 'nope' })))
    await expect(fetchSyncCredential()).resolves.toMatchObject({ kind: 'unavailable' })
  }
})

test('a thrown fetch error is unavailable, never a logout', async () => {
  stubFetch(() => Promise.reject(new TypeError('Failed to fetch')))

  await expect(fetchSyncCredential()).resolves.toEqual({
    kind: 'unavailable',
    reason: 'TypeError',
  })
})

test('an aborted request is unavailable', async () => {
  stubFetch(() => Promise.reject(new DOMException('signal timed out', 'TimeoutError')))

  await expect(fetchSyncCredential()).resolves.toMatchObject({
    kind: 'unavailable',
    reason: 'TimeoutError',
  })
})

test('the request carries a timeout signal so a hung socket cannot wedge the gate', async () => {
  const spy = stubFetch(() =>
    Promise.resolve(respond(200, { token: 'jwt-1', userID: 'user-1', role: 'admin' })),
  )

  await fetchSyncCredential()

  const init = spy.mock.calls[0]?.[1] as RequestInit
  expect(init.credentials).toBe('include')
  expect(init.signal).toBeInstanceOf(AbortSignal)
  expect(SYNC_TOKEN_TIMEOUT_MS).toBeGreaterThan(0)
})

test('an unreadable body is unavailable', async () => {
  stubFetch(() => Promise.resolve(respond(200, undefined, { malformed: true })))

  await expect(fetchSyncCredential()).resolves.toMatchObject({
    kind: 'unavailable',
    reason: 'unreadable response',
  })
})

test('a 200 missing the token or userID is unavailable, not a logout', async () => {
  for (const body of [{}, { token: 'jwt-1' }, { userID: 'user-1' }, { token: 7, userID: 'u' }]) {
    stubFetch(() => Promise.resolve(respond(200, body)))
    await expect(fetchSyncCredential()).resolves.toMatchObject({
      kind: 'unavailable',
      reason: 'malformed response',
    })
  }
})

test('the proactive re-mint lands at 75% of the remaining lifetime', () => {
  const now = 1_000_000
  // 40 minutes left → 30 minutes, which is also the ceiling.
  expect(proactiveRefreshDelay(now / 1_000 + 2_400, now)).toBe(PROACTIVE_MAX_MS)
  // 20 minutes left → 15 minutes.
  expect(proactiveRefreshDelay(now / 1_000 + 1_200, now)).toBe(15 * 60_000)
})

test('the schedule is clamped at both ends', () => {
  const now = 1_000_000
  expect(proactiveRefreshDelay(now / 1_000 + 10, now)).toBe(PROACTIVE_MIN_MS)
  expect(proactiveRefreshDelay(now / 1_000 - 500, now)).toBe(PROACTIVE_MIN_MS)
  expect(proactiveRefreshDelay(now / 1_000 + 86_400, now)).toBe(PROACTIVE_MAX_MS)
})

test('a server that does not report expiresAt falls back to a fixed timer', () => {
  expect(proactiveRefreshDelay(null, Date.now())).toBe(PROACTIVE_FALLBACK_MS)
})

test('waking re-mints only once more than half the lifetime has gone', () => {
  const fetchedAt = 1_000_000
  const expiresAt = (fetchedAt + 60 * 60_000) / 1_000

  expect(shouldRefreshOnWake({ expiresAt, fetchedAt }, fetchedAt + 29 * 60_000)).toBe(false)
  expect(shouldRefreshOnWake({ expiresAt, fetchedAt }, fetchedAt + 31 * 60_000)).toBe(true)
})

test('waking after a sleep past the expiry always re-mints', () => {
  const fetchedAt = 1_000_000
  const expiresAt = (fetchedAt + 60 * 60_000) / 1_000

  expect(shouldRefreshOnWake({ expiresAt, fetchedAt }, fetchedAt + 5 * 60 * 60_000)).toBe(true)
})

test('an already-expired credential re-mints on wake instead of waiting for the clamp', () => {
  const fetchedAt = 1_000_000
  expect(shouldRefreshOnWake({ expiresAt: fetchedAt / 1_000 - 10, fetchedAt }, fetchedAt)).toBe(
    true,
  )
})

test('the wake threshold uses the fallback lifetime when expiresAt is absent', () => {
  const fetchedAt = 1_000_000
  const half = PROACTIVE_FALLBACK_MS / 2

  expect(shouldRefreshOnWake({ expiresAt: null, fetchedAt }, fetchedAt + half - 1_000)).toBe(false)
  expect(shouldRefreshOnWake({ expiresAt: null, fetchedAt }, fetchedAt + half + 1_000)).toBe(true)
})
