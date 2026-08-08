import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { CyclesView } from '@/cycles/cycles-view'
import { AppFrame } from '@/frame/app-frame'

export const Route = createFileRoute('/teams/$teamId/cycles')({ component: CyclesPage })

function CyclesPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="cycles" measure="full">
        <CyclesView teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
