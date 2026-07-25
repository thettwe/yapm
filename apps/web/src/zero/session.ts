import type { WorkspaceRole } from '@yapm/schema'

export const SYNC_TOKEN_URL = '/api/zero/token'

// A fetch issued while the machine is still waking can hang far longer than any human
// waits, and the auth gate blocks on it. Never let a socket wedge the app.
export const SYNC_TOKEN_TIMEOUT_MS = 10_000

// Re-mint at 75% of the credential's remaining life, so the idle case never breaks the
// socket at all. Clamped: the floor bounds a pathologically short-lived token to one
// re-mint a minute, the ceiling keeps a long-lived one from parking a multi-hour timer.
export const PROACTIVE_FRACTION = 0.75
export const PROACTIVE_MIN_MS = 60_000
export const PROACTIVE_MAX_MS = 30 * 60_000

// Used when the server does not report `expiresAt` (older server, newer client).
export const PROACTIVE_FALLBACK_MS = 45 * 60_000

export interface SyncCredential {
  kind: 'session'
  userID: string
  token: string
  role: WorkspaceRole | null
  expiresAt: number | null
}

// `no-session` is reserved for the endpoint answering "you are not signed in". Everything
// else is `unavailable`: the caller keeps the session it already has and retries. Collapsing
// the two is what made a transient network blip look like a logout.
export type SyncCredentialResult =
  | SyncCredential
  | { kind: 'no-session' }
  | { kind: 'unavailable'; reason: string }

interface SyncTokenResponse {
  token?: unknown
  userID?: unknown
  role?: unknown
  expiresAt?: unknown
}

function asRole(value: unknown): WorkspaceRole | null {
  return value === 'admin' || value === 'member' || value === 'viewer' ? value : null
}

function asExpiresAt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

// An abort surfaces as a DOMException, which is not always an `instanceof Error` across
// runtimes, so the name is read structurally.
function failureReason(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown }
    if (typeof name === 'string' && name.length > 0) return name
  }
  return 'request failed'
}

export async function fetchSyncCredential(): Promise<SyncCredentialResult> {
  let response: Response
  try {
    response = await fetch(SYNC_TOKEN_URL, {
      credentials: 'include',
      signal: AbortSignal.timeout(SYNC_TOKEN_TIMEOUT_MS),
    })
  } catch (error) {
    return { kind: 'unavailable', reason: failureReason(error) }
  }

  if (response.status === 401 || response.status === 403) return { kind: 'no-session' }
  if (!response.ok) return { kind: 'unavailable', reason: `HTTP ${response.status}` }

  let data: SyncTokenResponse
  try {
    data = (await response.json()) as SyncTokenResponse
  } catch {
    return { kind: 'unavailable', reason: 'unreadable response' }
  }

  if (typeof data.token !== 'string' || typeof data.userID !== 'string') {
    return { kind: 'unavailable', reason: 'malformed response' }
  }

  return {
    kind: 'session',
    userID: data.userID,
    token: data.token,
    role: asRole(data.role),
    expiresAt: asExpiresAt(data.expiresAt),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function proactiveRefreshDelay(expiresAt: number | null, nowMs: number): number {
  if (expiresAt === null) return PROACTIVE_FALLBACK_MS
  const remaining = expiresAt * 1_000 - nowMs
  return clamp(remaining * PROACTIVE_FRACTION, PROACTIVE_MIN_MS, PROACTIVE_MAX_MS)
}

// Timers do not fire faithfully across a laptop sleep — the exact scenario in the bug
// report — so waking the tab or regaining the network re-checks the credential's age.
export function shouldRefreshOnWake(
  credential: { expiresAt: number | null; fetchedAt: number },
  nowMs: number,
): boolean {
  const { expiresAt, fetchedAt } = credential
  const lifetime = expiresAt === null ? PROACTIVE_FALLBACK_MS : expiresAt * 1_000 - fetchedAt
  if (lifetime <= 0) return true
  return nowMs - fetchedAt > lifetime / 2
}
