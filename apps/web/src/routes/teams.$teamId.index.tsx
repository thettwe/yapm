import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { TeamHome } from '@/home/team-home'

export const Route = createFileRoute('/teams/$teamId/')({ component: TeamPage })

// Home opts out of `Masthead`: in `home-digest-2.html` the hero IS band 2, so the page owns the
// band — and owning it includes declining to draw a masthead.
function TeamPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="home" measure="wide">
        <TeamHome teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
