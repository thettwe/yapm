import { useQuery } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { useEffect, useRef, useState } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { SyncUnavailable } from '@/components/authenticated'
import { type LandingTeam, readAnchorTeam, resolveLandingTeam } from '@/frame/team-context'
import { useSyncClientReady } from '@/zero/identity'
import { useSyncControl, useSyncSession } from '@/zero/provider'
import { useSyncRecovery } from '@/zero/recovery'

// The fourth door into the product, and until this change the third answer to where a signed-in
// caller arrives. It now takes the same landing decision `/login` takes.
//
// Lives beside `LoginPage` rather than in `routes/invite.tsx` for the same reason that one does:
// the router's code-splitting owns a route file's component, so a decision worth rendering in a
// test has to be importable from somewhere else.

type AcceptState = 'accepting' | 'done' | 'error'

function reasonText(reason: unknown, statusCode: number): string {
  if (reason === 'not_found') return 'This invitation is no longer valid.'
  if (reason === 'email_mismatch') return 'This invitation is for a different email address.'
  if (statusCode === 409) return 'You already have access to this workspace.'
  return 'This invitation could not be accepted.'
}

export function InvitePage({ token }: { token?: string }) {
  const { status } = useSyncSession()

  if (!token) {
    return (
      <Shell>
        <p className="text-destructive text-sm" role="alert">
          This invitation link is missing its token.
        </p>
        <BackHome />
      </Shell>
    )
  }

  if (status === 'pending') {
    return (
      <Shell>
        <p className="text-muted-foreground text-sm" role="status">
          Loading…
        </p>
      </Shell>
    )
  }

  if (status === 'logged-out') {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted-foreground max-w-sm text-center text-sm">
          Sign in or create an account to accept your invitation.
        </p>
        <LoginForm />
      </main>
    )
  }

  return <AcceptInvite token={token} />
}

function AcceptInvite({ token }: { token: string }) {
  const { refresh } = useSyncControl()
  const { role, userID } = useSyncSession()
  const clientReady = useSyncClientReady()
  const recovery = useSyncRecovery()
  const navigate = useNavigate()
  const [teams, teamsResult] = useQuery(queries.teams.all())
  const [remembered] = useState<string | null>(() => readAnchorTeam())
  const [state, setState] = useState<AcceptState>('accepting')
  const [reason, setReason] = useState<string | undefined>(undefined)
  const [acceptedTeamId, setAcceptedTeamId] = useState<string | null>(null)
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void fetch('/api/invites/accept', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          error?: unknown
          teamId?: unknown
        }
        if (response.ok) {
          if (typeof body.teamId === 'string') setAcceptedTeamId(body.teamId)
          refresh()
          setState('done')
          return
        }
        setReason(reasonText(body.error, response.status))
        setState('error')
      })
      .catch(() => {
        setReason('Could not reach the server. Try again.')
        setState('error')
      })
  }, [token, refresh])

  // The same landing decision `/login` takes, so acceptance is not a second answer to where a
  // signed-in caller arrives. A team-bound invitation skips the roster entirely: the server has
  // just written the membership row, which is stronger evidence than any test of a synced roster.
  useEffect(() => {
    if (state !== 'done') return
    if (acceptedTeamId !== null) {
      void navigate({ to: '/teams/$teamId', params: { teamId: acceptedTeamId } })
      return
    }
    // The roster must belong to the role the acceptance just granted. `refresh()` above re-mints the
    // credential, which rebuilds the Zero client around the new role — and until that lands, the
    // roster on screen is the one the OLD role could read, which for a caller who was not yet a
    // member is `denyAll`: complete, empty, and one commit from being wrong.
    if (!clientReady || teamsResult.type !== 'complete') return
    const landing = resolveLandingTeam(teams as readonly LandingTeam[], remembered, {
      userID,
      role,
    })
    void navigate(
      landing === null ? { to: '/' } : { to: '/teams/$teamId', params: { teamId: landing.id } },
    )
  }, [state, acceptedTeamId, navigate, clientReady, teams, teamsResult, remembered, userID, role])

  if (state === 'error') {
    return (
      <Shell>
        <p className="text-destructive text-sm" role="alert">
          {reason}
        </p>
        <BackHome />
      </Shell>
    )
  }

  // The membership is granted; only the roster is late. Holding the accepting copy on a roster that
  // never settles strands the one caller who has just joined and has nothing else on screen — so
  // the wait carries the same bound `/login` gives its own: the recovery surface the rest of the
  // product shows when the server is unreachable, cleared again the moment the connection holds.
  const waitingOnRoster = state === 'done' && acceptedTeamId === null
  if (waitingOnRoster && (recovery.retryOffered || teamsResult.type === 'error')) {
    return <SyncUnavailable />
  }

  return (
    <Shell>
      <p className="text-muted-foreground text-sm" role="status">
        Accepting your invitation…
      </p>
      <BackHome />
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
      <section className="bg-card flex w-full max-w-md flex-col items-center gap-4 rounded-xl border p-8 text-center shadow-sm">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Invitation</h1>
        {children}
      </section>
    </main>
  )
}

function BackHome() {
  return <Button variant="outline" render={<Link to="/">Go to the app</Link>} />
}
