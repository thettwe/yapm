import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { TeamDetail } from '@/components/team-detail'
import { AppFrame } from '@/frame/app-frame'

// The members management surface the team page used to be (design D10): roster, join/leave and the
// admin controls, unchanged — the team's index route now renders the Home digest instead. It is
// reached from the workspace/team switcher, under the current team.
export const Route = createFileRoute('/teams/$teamId/members')({ component: MembersPage })

function MembersPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId}>
        <TeamDetail teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
