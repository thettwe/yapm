import type { ZeroOptions } from '@rocicorp/zero'
import { useConnectionState, ZeroProvider } from '@rocicorp/zero/react'
import { type AuthContext, mutators, schema, type WorkspaceRole } from '@yapm/schema'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

const CACHE_URL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'
const SYNC_TOKEN_URL = '/api/zero/token'

// Zero keeps writes queued while `connecting`; the default minute before it admits
// to being `disconnected` is a minute of a user typing into a surface that cannot save.
const DISCONNECT_TIMEOUT_MS = 5_000

interface SyncSession {
  userID: string | null
  auth: string | null
  context: AuthContext | undefined
}

const LOGGED_OUT: SyncSession = { userID: null, auth: null, context: undefined }

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
// optimistic client context. A 401 means logged out.
async function fetchSyncSession(): Promise<SyncSession> {
  try {
    const response = await fetch(SYNC_TOKEN_URL, { credentials: 'include' })
    if (!response.ok) return LOGGED_OUT
    const data = (await response.json()) as SyncTokenResponse
    if (typeof data.token !== 'string' || typeof data.userID !== 'string') return LOGGED_OUT
    return {
      userID: data.userID,
      auth: data.token,
      context: { userID: data.userID, role: asRole(data.role) },
    }
  } catch {
    return LOGGED_OUT
  }
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
  const [session, setSession] = useState<SyncSession>(LOGGED_OUT)

  const refresh = useCallback(() => {
    void fetchSyncSession().then(setSession)
  }, [])

  useEffect(refresh, [refresh])

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

  return (
    <ZeroProvider {...options}>
      <SyncAuthRefresher onNeedsAuth={refresh} />
      {children}
    </ZeroProvider>
  )
}
