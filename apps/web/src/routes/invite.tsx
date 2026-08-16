import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { useEffect, useRef, useState } from 'react'
import { LoginForm } from '@/components/auth/login-form'
import { type LandingTeam, readAnchorTeam, resolveLandingTeam } from '@/frame/team-context'
import { useSyncControl, useSyncSession } from '@/zero/provider'

interface InviteSearch {
  token?: string
}

export const Route = createFileRoute('/invite')({
  component: InvitePage,
  validateSearch: (search: Record<string, unknown>): InviteSearch =>
    typeof search.token === 'string' ? { token: search.token } : {},
})

type AcceptState = 'accepting' | 'done' | 'error'

function reasonText(reason: unknown, statusCode: number): string {
  if (reason === 'not_found') return 'This invitation is no longer valid.'
  if (reason === 'email_mismatch') return 'This invitation is for a different email address.'
  if (statusCode === 409) return 'You already have access to this workspace.'
  return 'This invitation could not be accepted.'
}

function InvitePage() {
  const { token } = Route.useSearch()
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
  const { status, role, userID } = useSyncSession()
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
    if (status !== 'ready' || teamsResult.type !== 'complete') return
    const landing = resolveLandingTeam(teams as readonly LandingTeam[], remembered, {
      userID,
      role,
    })
    void navigate(
      landing === null ? { to: '/' } : { to: '/teams/$teamId', params: { teamId: landing.id } },
    )
  }, [state, acceptedTeamId, navigate, status, teams, teamsResult, remembered, userID, role])

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

  return (
    <Shell>
      <p className="text-muted-foreground text-sm" role="status">
        Accepting your invitation…
      </p>
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
