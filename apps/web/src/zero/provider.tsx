import type { ZeroOptions } from '@rocicorp/zero'
import { ZeroProvider } from '@rocicorp/zero/react'
import { type AuthContext, mutators, schema } from '@yapm/schema'
import { type ReactNode, useMemo } from 'react'

export const ANONYMOUS_CONTEXT: AuthContext = {
  userID: 'anonymous',
  role: 'member',
}

const CACHE_URL = import.meta.env.VITE_ZERO_CACHE_URL ?? 'http://localhost:4848'

// Zero keeps writes queued while `connecting`; the default minute before it admits
// to being `disconnected` is a minute of a user typing into a surface that cannot save.
const DISCONNECT_TIMEOUT_MS = 5_000

export function ZeroRoot({ children }: { children: ReactNode }) {
  const options = useMemo(
    () =>
      ({
        schema,
        mutators,
        cacheURL: CACHE_URL,
        userID: ANONYMOUS_CONTEXT.userID,
        context: ANONYMOUS_CONTEXT,
        kvStore: 'idb',
        disconnectTimeoutMs: DISCONNECT_TIMEOUT_MS,
      }) satisfies ZeroOptions,
    [],
  )

  return <ZeroProvider {...options}>{children}</ZeroProvider>
}
