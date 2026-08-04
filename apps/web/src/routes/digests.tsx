import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { PmDigestsGate } from '@/pm-digest/digests-gate'

export const Route = createFileRoute('/digests')({ component: PmDigestsPage })

// Workspace-wide like the inbox, and outside the `/teams/$teamId` tree for a stronger reason than
// either of those: the caller is not on the producing team, so there is no team route they could
// have reached this from.
function PmDigestsPage() {
  return (
    <Authenticated>
      <PmDigestsGate />
    </Authenticated>
  )
}
