import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { RetroView } from '@/retro/retro-view'

export const Route = createFileRoute('/teams/$teamId/retros/$retroId')({ component: RetroPage })

// A doorway from the Retros list; the retro itself is not a destination, so no bar stop is current.
function RetroPage() {
  const { teamId, retroId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="retros" measure="full">
        <RetroView teamId={teamId} retroId={retroId} />
      </AppFrame>
    </Authenticated>
  )
}
