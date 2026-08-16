import { useZero } from '@rocicorp/zero/react'
import { useSyncSession } from '@/zero/provider'

// Whether the Zero client currently in context is the one built for the caller the credential names.
//
// `useSyncSession` answers "who does the server say we are". This answers "whose question is the
// replica currently answering", and on sign-in those are one commit apart, always in the same
// direction. `ZeroProvider` constructs the replacement client from a PASSIVE effect, so the render
// in which `status` first turns `ready` still holds the ANONYMOUS client — the one whose
// `queries.teams.all()` was resolved against no auth context, fell through `denyAll`, and was
// answered by the server with an empty roster that is genuinely, terminally `complete`. A `Navigate`
// taken in that commit fires from a layout effect, which flushes before any passive effect, so a
// decision that trusts `complete` alone loses that race by construction rather than by luck.
//
// Zero carries the answer on the client itself: `context` is verbatim the context the instance was
// constructed with — `undefined` before sign-in — so this costs no timer and no heuristic.
//
// Compared on VALUES rather than object identity, and the two values are exactly the two the
// roster's readability depends on. `userID` catches sign-in; `role` catches the invitation
// acceptance, where the identity never changes but a `null` role becoming `member` is the whole
// difference between `denyAll` and a roster. The pm-audience is deliberately not compared: it
// reconstructs the client without changing which rows the caller may read, so waiting on it would
// be a wait for nothing.
export function useSyncClientReady(): boolean {
  const { status, userID, role } = useSyncSession()
  const { context } = useZero()

  if (status !== 'ready' || context === undefined) return false
  return context.userID === userID && context.role === role
}
