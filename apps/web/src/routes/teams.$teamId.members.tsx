import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { TeamDetail } from '@/components/team-detail'

// The members management surface the team page used to be (design D10): roster, join/leave and the
// admin controls, unchanged — the team's index route now renders the Home digest instead.
export const Route = createFileRoute('/teams/$teamId/members')({ component: MembersPage })

function MembersPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppShell current="Team">
        <TeamDetail teamId={teamId} />
      </AppShell>
    </Authenticated>
  )
}
