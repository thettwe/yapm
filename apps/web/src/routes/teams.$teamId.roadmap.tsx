import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { RoadmapView } from '@/projects/roadmap-view'

export const Route = createFileRoute('/teams/$teamId/roadmap')({ component: RoadmapPage })

function RoadmapPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="roadmap" measure="full">
        <RoadmapView teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
