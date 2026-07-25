import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSession } from '@/auth/client'
import { AccessGate } from '@/components/access-gate'
import { useSyncControl, useSyncSession } from '@/zero/provider'

// Route protection: the sync-token endpoint is the authoritative auth check. `logged-out`
// (no session) lands on login; an authenticated non-member (role null) sees the access gate;
// only a member reaches the app. Deciding on the server-resolved role avoids a gate flash
// while the roster loads.
export function Authenticated({ children }: { children: ReactNode }) {
  const { status, role, unavailable } = useSyncSession()
  const { data: session } = useSession()

  if (status === 'pending') {
    // A credential request that never landed says nothing about whether we are signed in, so
    // this is a retry surface rather than a redirect — and rather than an endless "Loading…".
    return unavailable ? <SyncUnavailable /> : <SyncPending />
  }

  if (status === 'logged-out') {
    return <Navigate to="/login" />
  }

  if (role === null) {
    return <AccessGate {...(session?.user.email ? { email: session.user.email } : {})} />
  }

  return <>{children}</>
}

function SyncPending() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p className="text-muted-foreground text-sm" role="status">
        Loading…
      </p>
    </main>
  )
}

function SyncUnavailable() {
  const { refresh } = useSyncControl()

  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <div className="flex flex-col items-center gap-3" data-testid="sync-unavailable">
        <p className="text-muted-foreground text-sm" role="status" aria-live="polite">
          Can’t reach the server — retrying.
        </p>
        <button
          type="button"
          className="border-input hover:bg-accent focus-visible:ring-ring rounded-md border px-3 py-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
          onClick={refresh}
          data-testid="sync-unavailable-retry"
        >
          Retry now
        </button>
      </div>
    </main>
  )
}
