import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { RetrosView } from '@/retro/retros-view'

export const Route = createFileRoute('/teams/$teamId/retros/')({ component: RetrosPage })

function RetrosPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="retros" measure="full">
        <RetrosView teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
