import type { ZeroOptions } from '@rocicorp/zero'
import { useConnectionState, ZeroProvider } from '@rocicorp/zero/react'
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

const CACHE_URL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'
const SYNC_TOKEN_URL = '/api/zero/token'

// Zero keeps writes queued while `connecting`; the default minute before it admits
// to being `disconnected` is a minute of a user typing into a surface that cannot save.
const DISCONNECT_TIMEOUT_MS = 5_000

// `pending` before the first token fetch settles; `logged-out` when the endpoint rejects the
// caller (no session); `ready` once the server has resolved the caller's authoritative role.
type SyncStatus = 'pending' | 'logged-out' | 'ready'

interface SyncSession {
  status: SyncStatus
  userID: string | null
  auth: string | null
  context: AuthContext | undefined
}

const PENDING: SyncSession = { status: 'pending', userID: null, auth: null, context: undefined }
const LOGGED_OUT: SyncSession = {
  status: 'logged-out',
  userID: null,
  auth: null,
  context: undefined,
}

interface SyncTokenResponse {
  token?: unknown
  userID?: unknown
  role?: unknown
}

function asRole(value: unknown): WorkspaceRole | null {
  return value === 'admin' || value === 'member' || value === 'viewer' ? value : null
}

// zero-cache authenticates the sync socket with a short-lived JWT minted by better-auth.
// We fetch it (cookie session) and hand Zero the token plus the caller's role for the
// optimistic client context. A non-OK response means no session (logged out); a 200 with a
// null role means an authenticated non-member — the authoritative membership signal.
async function fetchSyncSession(): Promise<SyncSession> {
  try {
    const response = await fetch(SYNC_TOKEN_URL, { credentials: 'include' })
    if (!response.ok) return LOGGED_OUT
    const data = (await response.json()) as SyncTokenResponse
    if (typeof data.token !== 'string' || typeof data.userID !== 'string') return LOGGED_OUT
    return {
      status: 'ready',
      userID: data.userID,
      auth: data.token,
      context: { userID: data.userID, role: asRole(data.role) },
    }
  } catch {
    return LOGGED_OUT
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
}

const SyncSessionContext = createContext<SyncSessionState>({
  status: 'pending',
  userID: null,
  role: null,
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

// Zero flips to `needs-auth` when the sync endpoints reject the JWT as expired. Re-fetch a
// fresh token; changing `auth` makes ZeroProvider reconnect without a page reload.
function SyncAuthRefresher({ onNeedsAuth }: { onNeedsAuth: () => void }): null {
  const state = useConnectionState()
  const handled = useRef(false)

  useEffect(() => {
    if (state.name === 'needs-auth') {
      if (!handled.current) {
        handled.current = true
        onNeedsAuth()
      }
    } else {
      handled.current = false
    }
  }, [state.name, onNeedsAuth])

  return null
}

export function ZeroRoot({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SyncSession>(PENDING)
  const { data: authSession } = useSession()
  const authUserId = authSession?.user.id ?? null

  const refresh = useCallback(() => {
    void fetchSyncSession().then(setSession)
  }, [])

  // Re-mint the sync token on mount and whenever the signed-in identity changes.
  useEffect(() => {
    refresh()
  }, [refresh, authUserId])

  const options = useMemo(
    () =>
      ({
        schema,
        mutators,
        cacheURL: CACHE_URL,
        userID: session.userID,
        auth: session.auth,
        context: session.context,
        kvStore: 'idb',
        disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
      }) satisfies ZeroOptions,
    [session],
  )

  const control = useMemo<SyncControl>(() => ({ refresh }), [refresh])
  const sessionState = useMemo<SyncSessionState>(
    () => ({
      status: session.status,
      userID: session.userID,
      role: session.context?.role ?? null,
    }),
    [session],
  )

  return (
    <SyncControlContext.Provider value={control}>
      <SyncSessionContext.Provider value={sessionState}>
        <ZeroProvider {...options}>
          <SyncAuthRefresher onNeedsAuth={refresh} />
          {children}
        </ZeroProvider>
      </SyncSessionContext.Provider>
    </SyncControlContext.Provider>
  )
}
