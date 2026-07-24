import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { TeamDetail } from '@/components/team-detail'

export const Route = createFileRoute('/teams/$teamId/')({ component: TeamPage })

function TeamPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppShell current="Team">
        <TeamDetail teamId={teamId} />
      </AppShell>
    </Authenticated>
  )
}
