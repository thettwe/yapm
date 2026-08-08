import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { TriageView } from '@/triage/triage-view'

export const Route = createFileRoute('/teams/$teamId/triage')({ component: TriagePage })

function TriagePage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="triage" measure="full">
        <TriageView teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
