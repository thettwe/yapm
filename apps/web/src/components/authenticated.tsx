import { Navigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useSession } from '@/auth/client'
import { AccessGate } from '@/components/access-gate'
import { useSyncSession } from '@/zero/provider'

// Route protection: the sync-token endpoint is the authoritative auth check. `logged-out`
// (no session) lands on login; an authenticated non-member (role null) sees the access gate;
// only a member reaches the app. Deciding on the server-resolved role avoids a gate flash
// while the roster loads.
export function Authenticated({ children }: { children: ReactNode }) {
  const { status, role } = useSyncSession()
  const { data: session } = useSession()

  if (status === 'pending') {
    return (
      <main className="flex min-h-svh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      </main>
    )
  }

  if (status === 'logged-out') {
    return <Navigate to="/login" />
  }

  if (role === null) {
    return <AccessGate {...(session?.user.email ? { email: session.user.email } : {})} />
  }

  return <>{children}</>
}
