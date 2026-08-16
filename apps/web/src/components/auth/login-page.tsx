import { useQuery } from '@rocicorp/zero/react'
import { Navigate } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { useState } from 'react'
import { useSession } from '@/auth/client'
import { LoginForm } from '@/components/auth/login-form'
import { SyncUnavailable } from '@/components/authenticated'
import { type LandingTeam, readAnchorTeam, resolveLandingTeam } from '@/frame/team-context'
import { useSyncClientReady } from '@/zero/identity'
import { useSyncSession } from '@/zero/provider'
import { useSyncRecovery } from '@/zero/recovery'

// Where signing in lands, decided in ONE place. The sign-in form carries no `callbackURL` on its
// email paths precisely so better-auth's redirect plugin cannot take a second decision here.
//
// Lives beside the form rather than in `routes/login.tsx` because a route file that exports a
// second symbol loses the router's code-splitting for it, and this decision is worth a component
// test of its own.
export function LoginPage() {
  const { data: session, isPending } = useSession()

  if (isPending) {
    return <Loading />
  }

  // The roster is queried in a CHILD, so a visitor who is not signed in issues no query at all —
  // there is nothing for it to resolve to, and the surface they came for is a form.
  if (!session) {
    return <SignIn />
  }

  return <LandingDecision />
}

function LandingDecision() {
  const { status, role, userID, unavailable } = useSyncSession()
  const clientReady = useSyncClientReady()
  const recovery = useSyncRecovery()
  const [teams, teamsResult] = useQuery(queries.teams.all())
  const [remembered] = useState<string | null>(() => readAnchorTeam())

  // `unavailable` is read BEFORE `ready` because it coexists with `pending` rather than replacing
  // it: a caller whose credential request never lands would otherwise wait on a status that will
  // not arrive. The retry surface is the one `Authenticated` already shows, not a second copy.
  if (unavailable) {
    return <SyncUnavailable />
  }

  // A settled, clean `logged-out` RENDERS the sign-in form and does not navigate: `Authenticated`
  // sends that state back here, and two routes that Navigate at each other starve the renderer.
  if (status === 'logged-out') {
    return <SignIn />
  }

  // Both conditions are required, and the first is about the ROSTER'S OWN identity rather than the
  // credential's. Before the credential settles there is no auth context, so `queries.teams.all()`
  // resolves through `denyAll` and reports complete-and-EMPTY — a roster that would send a member of
  // five teams to workspace administration. `status === 'ready'` cannot see that: the credential
  // lands a full commit before the Zero client rebuilt around it does, and this navigation is taken
  // in that gap. `useSyncClientReady` asks the client whose answer this is who it belongs to.
  if (!clientReady || teamsResult.type !== 'complete') {
    // …and this wait is bounded too. `unavailable` above only covers a failed `/api/zero/token`
    // call; a credential that mints fine against a zero-cache that is down leaves the roster at
    // `unknown` forever, which would hold the sign-in surface on a spinner with nothing to press.
    // The bound is the one the statusline already uses — `SyncRecovery` offers the manual retry
    // once waiting stops feeling like a hiccup (`RETRY_OFFER_AFTER_MS`) and clears it again when
    // the connection holds — so the surface is self-healing rather than a dead end.
    if (recovery.retryOffered || teamsResult.type === 'error') {
      return <SyncUnavailable />
    }
    return <Loading />
  }

  const landing = resolveLandingTeam(teams as readonly LandingTeam[], remembered, { userID, role })

  // No readable team — including the settled non-member, whose destination is the access gate every
  // route renders.
  if (landing === null) {
    return <Navigate to="/" />
  }

  return <Navigate to="/teams/$teamId" params={{ teamId: landing.id }} />
}

function Loading() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <p className="text-muted-foreground text-sm" role="status">
        Loading…
      </p>
    </main>
  )
}

function SignIn() {
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <LoginForm />
    </main>
  )
}
