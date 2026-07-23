import { useZero } from '@rocicorp/zero/react'
import { mutators, newId } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { runMutation } from '@/lib/mutation'

interface TeamMembershipRow {
  id: string
  userId: string
}

// Self-serve join/leave for the signed-in user. Joining grants a viewer read scope but no
// write power (the mutators still reject a viewer's writes).
export function TeamMembershipButton({
  teamId,
  memberships,
}: {
  teamId: string
  memberships: readonly TeamMembershipRow[]
}) {
  const zero = useZero()
  const { userId } = useMembership()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const mine = userId ? memberships.find((row) => row.userId === userId) : undefined

  async function toggle() {
    if (!userId || busy) return
    setError(undefined)
    setBusy(true)
    const failure = mine
      ? await runMutation(zero.mutate(mutators.team.removeMember({ id: mine.id })))
      : await runMutation(
          zero.mutate(
            mutators.team.addMember({
              id: newId(),
              teamId,
              userId,
              createdAt: Date.now(),
            }),
          ),
        )
    setBusy(false)
    if (failure !== undefined) setError(failure)
  }

  return (
    <span className="flex flex-col items-end gap-1">
      <Button
        variant={mine ? 'outline' : 'secondary'}
        size="sm"
        onClick={toggle}
        disabled={busy}
        aria-label={mine ? 'Leave this team' : 'Join this team'}
      >
        {mine ? 'Leave' : 'Join'}
      </Button>
      {error !== undefined ? (
        <span className="text-destructive text-xs" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}
