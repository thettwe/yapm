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
  CONNECTION_SETTLED_MS,
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
  // Stored as a JOINED STRING rather than an array, and that is not a micro-optimization: every
  // re-mint returns a fresh array, and an array in the `context` memo's dependency list would give
  // the Zero client a new options identity on every refresh — reopening IndexedDB and rehydrating
  // every query. A string compares by value, so a re-mint that changes nothing changes nothing.
  pmAudienceKey: string
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
  pmAudienceKey: '',
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
        pmAudienceKey: [...result.pmAudienceTeamIds].sort().join(','),
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

interface RemintOptions {
  // "The token as of now" rather than "any current token": a caller that just changed
  // something the server bakes into the credential cannot be answered with one minted
  // before that change committed.
  fresh?: boolean
}

type Remint = (options?: RemintOptions) => Promise<SyncCredentialResult>

interface SyncControl {
  // "The token as of now" — for a caller that just changed what the server bakes into it.
  refresh: () => void
  // "Any current token" — for a caller that only wants the outage to end sooner.
  retry: () => void
}

const SyncControlContext = createContext<SyncControl>({ refresh: () => {}, retry: () => {} })

export interface SyncSessionState {
  status: SyncStatus
  userID: string | null
  role: WorkspaceRole | null
  // Empty for everyone until an administrator turns disclosure on and names somebody. A surface
  // reads this to decide whether it EXISTS — which is how the disclosure reader stays cleanly absent
  // without issuing a query whose emptiness would have said the same thing more loudly.
  pmAudienceTeamIds: readonly string[]
  unavailable: boolean
}

const EMPTY_AUDIENCE: readonly string[] = []

const SyncSessionContext = createContext<SyncSessionState>({
  status: 'pending',
  userID: null,
  role: null,
  pmAudienceTeamIds: EMPTY_AUDIENCE,
  unavailable: false,
})

// `refresh()`: membership changes (accepting an invite, being promoted/removed) do not change
// the better-auth identity, so the sync token must be re-minted explicitly to pick up the new
// role. Any surface that mutates membership calls this after the server confirms it.
// `retry()`: the outage surfaces, which want whatever token the server will give them next.
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
  const hidden = useDocumentHidden()
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
    const plan: RecoveryPlan = enabled ? recoveryPlan(name, { hidden }) : { kind: 'none' }

    if (plan.kind === 'reset') {
      immediateRef.current = false
      // The pill clears immediately — the user is connected — but the schedule only forgets
      // the outage once the connection has held for `CONNECTION_SETTLED_MS`. Leaving
      // `connected` before then cancels this timer, so a validation-failure cycle keeps
      // climbing the backoff instead of restarting it.
      setStatus(RECOVERY_IDLE)
      const settled = setTimeout(() => {
        attemptRef.current = 0
        startedAtRef.current = null
      }, CONNECTION_SETTLED_MS)
      return () => clearTimeout(settled)
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
  }, [name, hidden, request, enabled, remint])

  const value = useMemo<SyncRecoveryValue>(() => ({ ...status, retryNow }), [status, retryNow])

  return <SyncRecoveryContext.Provider value={value}>{children}</SyncRecoveryContext.Provider>
}

function useDocumentHidden(): boolean {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden')

  useEffect(() => {
    const read = () => setHidden(document.visibilityState === 'hidden')
    read()
    document.addEventListener('visibilitychange', read)
    return () => document.removeEventListener('visibilitychange', read)
  }, [])

  return hidden
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

// Before the first credential lands there is no Zero connection to be broken, so
// `SyncRecovery` sees a healthy client, and the proactive refresher is gated off by `ready`.
// Nothing re-armed, and the "Can't reach the server — retrying" surface never retried. This
// loop is keyed on `revision` — bumped by every settled request — so each failure schedules
// the next attempt on the same bounded backoff.
//
// Scoped to "no credential yet" on purpose, to keep one owner per fault: once a session exists,
// a failed refresh already reschedules itself through the proactive refresher's `revision`
// dependency, and a broken connection is `SyncRecovery`'s. A third scheduler on the same
// endpoint would double the traffic this change exists to bound.
//
// `logged-out` is a no-credential state too, and excluding it wedged every sign-up that raced a
// slow first mint: the anonymous mount mints once and is answered 401, which is CORRECT and sets
// `logged-out`; signing up re-mints; if that one fails, `applyCredential` preserves the previous
// status, so the session stays `logged-out` with `unavailable` set and nothing was scheduled to
// ask again. The client sat there until the tab was reloaded. Only `ready` is somebody else's.
function useUnavailableRetry(session: SyncSessionRecord, remint: () => void): void {
  const { status, unavailable, revision } = session
  const retrying = unavailable && status !== 'ready'
  const attemptRef = useRef(0)

  useEffect(() => {
    if (!retrying) {
      attemptRef.current = 0
      return
    }

    const attempt = attemptRef.current
    const timer = setTimeout(() => {
      attemptRef.current = attempt + 1
      remint()
    }, backoffDelay(attempt))

    // Timers do not fire faithfully across a sleep, and a machine that just regained the
    // network should not wait out a 30s window it accrued while offline.
    const check = () => remint()
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [retrying, revision, remint])
}

interface ZeroRootProps {
  // Resolved at runtime by `RuntimeConfigGate` and handed down. It MUST be a stable string across
  // renders: the options memo's identity is what `ZeroProvider` keys the whole client on, and a
  // value that changes identity per render reopens IndexedDB and rehydrates every query.
  cacheUrl: string
  children: ReactNode
}

export function ZeroRoot({ cacheUrl, children }: ZeroRootProps) {
  const [session, setSession] = useState<SyncSessionRecord>(PENDING)
  const { data: authSession } = useSession()
  const authUserId = authSession?.user.id ?? null

  const inFlight = useRef<Promise<SyncCredentialResult> | null>(null)
  const flightId = useRef(0)

  // One scheduler, one in-flight fetch: a role change and a reconnect arriving together
  // share the same request instead of racing two tokens onto the same connection. A `fresh`
  // caller opts out of the sharing — but chains behind the open request rather than racing
  // it, so the server is only asked once the earlier answer is in.
  const remint = useCallback<Remint>(({ fresh = false } = {}): Promise<SyncCredentialResult> => {
    const current = inFlight.current
    if (current !== null && !fresh) return current

    const id = flightId.current + 1
    flightId.current = id
    // `fetchSyncCredential` is total, but a rejection escaping here would leave the slot
    // occupied forever and disable recovery permanently — the failure this whole change
    // exists to prevent. Clear the slot on both paths. A superseded flight applies nothing:
    // its answer predates the change the newer request exists to observe.
    const settle = (result: SyncCredentialResult) => {
      if (flightId.current !== id) return result
      inFlight.current = null
      setSession((previous) => applyCredential(previous, result, Date.now()))
      return result
    }
    const start = () =>
      fetchSyncCredential().then(settle, (error: unknown) =>
        settle({ kind: 'unavailable', reason: String(error) }),
      )

    const pending = current === null ? start() : current.then(start, start)
    inFlight.current = pending
    return pending
  }, [])

  // Membership changes are why this exists, and a credential minted before the change
  // committed would answer with the stale role — parking a just-accepted invitee on the
  // access gate. `refresh()` therefore always forces a new request.
  const refresh = useCallback(() => {
    void remint({ fresh: true })
  }, [remint])

  // The outage path wants the wait to end, not a guaranteed-newer token. Forcing here would
  // discard the answer already on its way and queue a second request behind it, making the
  // "Retry now" button slower than doing nothing.
  const retry = useCallback(() => {
    void remint()
  }, [remint])

  // Re-mint the sync token on mount and whenever the signed-in identity changes — and FIRST
  // return the session to `pending`, because the previous answer was about a different identity
  // and must stop steering the router before the new request settles. Concretely: sign-up flips
  // `session` immediately while sync still says `logged-out`; in that window `/login` renders
  // `<Navigate to="/">` (session exists) and `Authenticated` renders `<Navigate to="/login">`
  // (logged-out) — a reciprocal redirect cycle that starves the renderer so thoroughly that no
  // timer, fetch callback or paint ever runs again. The server was measured answering the
  // post-sign-up token in 29ms; the page locked anyway. `pending` renders the sync gate instead
  // of a redirect, which breaks the cycle by construction.
  //
  // An identity CHANGE must also not coalesce onto a still-in-flight pre-identity request: that
  // flight was asked about the previous identity, and its answer settling over the reset above
  // would stand as a clean, settled `logged-out` — bypassing both guards (the pending reset is
  // overwritten; the retry surface keys on `unavailable`, which is false) and resurrecting the
  // redirect cycle. `fresh` discards the stale flight's answer and chains the new request behind
  // it — the same semantics `refresh()` uses, for the same reason: the caller changed what the
  // server bakes into the credential. The mount itself (including StrictMode's dev re-run of the
  // effect) observes no change, so it still joins an open flight rather than queueing a second.
  const observedAuthUserId = useRef<string | null | undefined>(undefined)
  useEffect(() => {
    const changed =
      observedAuthUserId.current !== undefined && observedAuthUserId.current !== authUserId
    observedAuthUserId.current = authUserId
    setSession((previous) => ({ ...PENDING, revision: previous.revision + 1 }))
    void remint({ fresh: changed })
  }, [remint, authUserId])

  useProactiveRefresh(session, remint)
  useUnavailableRetry(session, retry)

  const { userID, token, role, pmAudienceKey } = session

  // Rebuilt from the joined key so both memos below depend on a VALUE. Advisory: the server
  // re-evaluates the audience on every query, so this only decides what the local replica renders.
  const pmAudienceTeamIds = useMemo<readonly string[]>(
    () => (pmAudienceKey === '' ? EMPTY_AUDIENCE : pmAudienceKey.split(',')),
    [pmAudienceKey],
  )

  // `ZeroProvider` recreates the whole Zero instance when any non-`auth` option changes
  // identity — reopening IndexedDB and rehydrating every query. `context` is the only object
  // among them, so it is memoized on its values: a re-mint that keeps the same identity and
  // role must refresh `auth` in place, not tear the client down.
  const context = useMemo<AuthContext | undefined>(
    () => (userID === null ? undefined : { userID, role, pmAudienceTeamIds }),
    [userID, role, pmAudienceTeamIds],
  )

  const options = useMemo(
    () =>
      ({
        schema,
        mutators,
        cacheURL: cacheUrl,
        userID,
        auth: token,
        context,
        kvStore: 'idb',
        disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
      }) satisfies ZeroOptions,
    [cacheUrl, userID, token, context],
  )

  const control = useMemo<SyncControl>(() => ({ refresh, retry }), [refresh, retry])
  const sessionState = useMemo<SyncSessionState>(
    () => ({
      status: session.status,
      userID,
      role,
      pmAudienceTeamIds,
      unavailable: session.unavailable,
    }),
    [session.status, userID, role, pmAudienceTeamIds, session.unavailable],
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
