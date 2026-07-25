import type { ZeroOptions } from '@rocicorp/zero'
import { useConnectionState, useZero, ZeroProvider } from '@rocicorp/zero/react'
import { type AuthContext, mutators, schema, type WorkspaceRole } from '@yapm/schema'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useSession } from '@/auth/client'
import { atBackoffCeiling, backoffDelay } from '@/zero/backoff'
import {
  RECOVERY_IDLE,
  RETRY_OFFER_AFTER_MS,
  type RecoveryPlan,
  recoveryPlan,
  SyncRecoveryContext,
  type SyncRecoveryStatus,
  type SyncRecoveryValue,
} from '@/zero/recovery'
import {
  fetchSyncCredential,
  proactiveRefreshDelay,
  type SyncCredentialResult,
  shouldRefreshOnWake,
} from '@/zero/session'

const CACHE_URL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'

// Zero keeps writes queued while `connecting`; the default minute before it admits
// to being `disconnected` is a minute of a user typing into a surface that cannot save.
const DISCONNECT_TIMEOUT_MS = 5_000

// `pending` before the first token fetch settles; `logged-out` when the endpoint rejects the
// caller (no session); `ready` once the server has resolved the caller's authoritative role.
type SyncStatus = 'pending' | 'logged-out' | 'ready'

interface SyncSessionRecord {
  status: SyncStatus
  userID: string | null
  token: string | null
  role: WorkspaceRole | null
  expiresAt: number | null
  fetchedAt: number
  unavailable: boolean
  // Bumped by every settled credential request so a failed proactive refresh reschedules
  // itself; without it an `unavailable` outcome leaves no timer behind.
  revision: number
}

const PENDING: SyncSessionRecord = {
  status: 'pending',
  userID: null,
  token: null,
  role: null,
  expiresAt: null,
  fetchedAt: 0,
  unavailable: false,
  revision: 0,
}

// An `unavailable` outcome keeps whatever session we already had. Only a rejection from the
// endpoint clears it — a request that never landed says nothing about whether we are signed in.
export function applyCredential(
  previous: SyncSessionRecord,
  result: SyncCredentialResult,
  nowMs: number,
): SyncSessionRecord {
  const revision = previous.revision + 1
  switch (result.kind) {
    case 'session':
      return {
        status: 'ready',
        userID: result.userID,
        token: result.token,
        role: result.role,
        expiresAt: result.expiresAt,
        fetchedAt: nowMs,
        unavailable: false,
        revision,
      }
    case 'no-session':
      return { ...PENDING, status: 'logged-out', fetchedAt: nowMs, revision }
    case 'unavailable':
      return { ...previous, unavailable: true, revision }
  }
}

interface SyncControl {
  refresh: () => void
}

const SyncControlContext = createContext<SyncControl>({ refresh: () => {} })

export interface SyncSessionState {
  status: SyncStatus
  userID: string | null
  role: WorkspaceRole | null
  unavailable: boolean
}

const SyncSessionContext = createContext<SyncSessionState>({
  status: 'pending',
  userID: null,
  role: null,
  unavailable: false,
})

// Membership changes (accepting an invite, being promoted/removed) do not change the
// better-auth identity, so the sync token must be re-minted explicitly to pick up the new
// role. Any surface that mutates membership calls this after the server confirms it.
export function useSyncControl(): SyncControl {
  return useContext(SyncControlContext)
}

// The server-resolved identity and role, authoritative for the access gate.
export function useSyncSession(): SyncSessionState {
  return useContext(SyncSessionContext)
}

interface SyncRecoveryProps {
  token: string | null
  enabled: boolean
  remint: () => Promise<SyncCredentialResult>
  children: ReactNode
}

// The single owner of every reconnect. Zero parks in `needs-auth` and `error` and never
// retries out of them by itself, so nothing but this component gets the client moving again.
// It must live inside `ZeroProvider`: both `useZero` and `useConnectionState` read that context.
function SyncRecovery({ token, enabled, remint, children }: SyncRecoveryProps) {
  const zero = useZero()
  const state = useConnectionState()
  const [status, setStatus] = useState<SyncRecoveryStatus>(RECOVERY_IDLE)
  const [request, setRequest] = useState(0)

  const attemptRef = useRef(0)
  const startedAtRef = useRef<number | null>(null)
  const immediateRef = useRef(false)
  const tokenRef = useRef(token)

  // Read through refs, never through the effect's dependency array: a dependency whose
  // identity churns per render would re-run the scheduler on every render, which is the
  // shape of the hot loop this component exists to prevent.
  const zeroRef = useRef(zero)

  useEffect(() => {
    tokenRef.current = token
    zeroRef.current = zero
  }, [token, zero])

  const retryNow = useCallback(() => {
    attemptRef.current = 0
    startedAtRef.current = Date.now()
    immediateRef.current = true
    setRequest((current) => current + 1)
  }, [])

  const name = state.name

  useEffect(() => {
    const plan: RecoveryPlan = enabled ? recoveryPlan(name) : { kind: 'none' }

    if (plan.kind === 'reset') {
      attemptRef.current = 0
      startedAtRef.current = null
      immediateRef.current = false
      setStatus(RECOVERY_IDLE)
      return
    }

    if (plan.kind === 'none') {
      // `connecting` deliberately does not reset the attempt counter: an
      // error → connect → connecting → error cycle that reset it would be the hot loop.
      setStatus((current) => {
        if (attemptRef.current === 0) return RECOVERY_IDLE
        return current.phase === 'retrying' ? current : { ...current, phase: 'retrying' }
      })
      return
    }

    let cancelled = false
    if (startedAtRef.current === null) startedAtRef.current = Date.now()

    const attempt = attemptRef.current
    const immediate = immediateRef.current
    immediateRef.current = false
    // The grace floors every attempt, not just the first: while `disconnected` Zero is
    // already retrying on its own, so our re-mint cadence never needs to be tighter.
    const delayMs = immediate ? 0 : Math.max(plan.graceMs, backoffDelay(attempt))

    const elapsed = Date.now() - startedAtRef.current
    const offered = atBackoffCeiling(attempt) || elapsed >= RETRY_OFFER_AFTER_MS
    setStatus((current) => ({
      phase: 'waiting',
      attempt,
      delayMs,
      retryOffered: current.retryOffered || offered,
    }))

    const offerTimer = offered
      ? undefined
      : setTimeout(
          () => setStatus((current) => ({ ...current, retryOffered: true })),
          Math.max(0, RETRY_OFFER_AFTER_MS - elapsed),
        )

    const timer = setTimeout(() => {
      void (async () => {
        attemptRef.current = attempt + 1
        setStatus((current) => ({ ...current, phase: 'retrying' }))

        const previous = tokenRef.current
        const result = await remint()
        if (cancelled) return

        // A real rejection means we are signed out; the access gate takes it from here.
        if (result.kind === 'no-session') return

        if (result.kind === 'session' && plan.reconnect && result.token === previous) {
          // An unchanged `auth` prop leaves `ZeroProvider` a no-op, which would park the
          // client forever. When the token does change the provider calls connect for us.
          await zeroRef.current.connection.connect()
          if (cancelled) return
        }

        // Reaching here means no state change cancelled us, so sync is still broken:
        // ask for the next attempt, which the growing backoff paces.
        setRequest((current) => current + 1)
      })()
    }, delayMs)

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (offerTimer !== undefined) clearTimeout(offerTimer)
    }
  }, [name, request, enabled, remint])

  const value = useMemo<SyncRecoveryValue>(() => ({ ...status, retryNow }), [status, retryNow])

  return <SyncRecoveryContext.Provider value={value}>{children}</SyncRecoveryContext.Provider>
}

function useProactiveRefresh(
  session: SyncSessionRecord,
  remint: () => Promise<SyncCredentialResult>,
): void {
  const { status, expiresAt, fetchedAt, revision } = session
  const ready = status === 'ready'

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => void remint(), proactiveRefreshDelay(expiresAt, Date.now()))
    return () => clearTimeout(timer)
  }, [ready, expiresAt, fetchedAt, revision, remint])

  useEffect(() => {
    if (!ready) return
    const check = () => {
      if (shouldRefreshOnWake({ expiresAt, fetchedAt }, Date.now())) void remint()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [ready, expiresAt, fetchedAt, remint])
}

export function ZeroRoot({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SyncSessionRecord>(PENDING)
  const { data: authSession } = useSession()
  const authUserId = authSession?.user.id ?? null

  const inFlight = useRef<Promise<SyncCredentialResult> | null>(null)
  const flightId = useRef(0)

  // One scheduler, one in-flight fetch: a role change and a reconnect arriving together
  // share the same request instead of racing two tokens onto the same connection.
  const remint = useCallback((): Promise<SyncCredentialResult> => {
    const current = inFlight.current
    if (current !== null) return current

    const id = flightId.current + 1
    flightId.current = id
    // `fetchSyncCredential` is total, but a rejection escaping here would leave the slot
    // occupied forever and disable recovery permanently — the failure this whole change
    // exists to prevent. Clear the slot on both paths.
    const settle = (result: SyncCredentialResult) => {
      if (flightId.current === id) inFlight.current = null
      setSession((previous) => applyCredential(previous, result, Date.now()))
      return result
    }
    const pending = fetchSyncCredential().then(settle, (error: unknown) =>
      settle({ kind: 'unavailable', reason: String(error) }),
    )
    inFlight.current = pending
    return pending
  }, [])

  const refresh = useCallback(() => {
    void remint()
  }, [remint])

  // Re-mint the sync token on mount and whenever the signed-in identity changes.
  useEffect(() => {
    refresh()
  }, [refresh, authUserId])

  useProactiveRefresh(session, remint)

  const { userID, token, role } = session

  // `ZeroProvider` recreates the whole Zero instance when any non-`auth` option changes
  // identity — reopening IndexedDB and rehydrating every query. `context` is the only object
  // among them, so it is memoized on its values: a re-mint that keeps the same identity and
  // role must refresh `auth` in place, not tear the client down.
  const context = useMemo<AuthContext | undefined>(
    () => (userID === null ? undefined : { userID, role }),
    [userID, role],
  )

  const options = useMemo(
    () =>
      ({
        schema,
        mutators,
        cacheURL: CACHE_URL,
        userID,
        auth: token,
        context,
        kvStore: 'idb',
        disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
      }) satisfies ZeroOptions,
    [userID, token, context],
  )

  const control = useMemo<SyncControl>(() => ({ refresh }), [refresh])
  const sessionState = useMemo<SyncSessionState>(
    () => ({ status: session.status, userID, role, unavailable: session.unavailable }),
    [session.status, userID, role, session.unavailable],
  )

  return (
    <SyncControlContext.Provider value={control}>
      <SyncSessionContext.Provider value={sessionState}>
        <ZeroProvider {...options}>
          <SyncRecovery token={token} enabled={session.status !== 'logged-out'} remint={remint}>
            {children}
          </SyncRecovery>
        </ZeroProvider>
      </SyncSessionContext.Provider>
    </SyncControlContext.Provider>
  )
}
