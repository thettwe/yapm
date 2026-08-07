import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { TeamHome } from '@/home/team-home'

export const Route = createFileRoute('/teams/$teamId/')({ component: TeamPage })

function TeamPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppShell current="Team" wide>
        <TeamHome teamId={teamId} />
      </AppShell>
    </Authenticated>
  )
}
