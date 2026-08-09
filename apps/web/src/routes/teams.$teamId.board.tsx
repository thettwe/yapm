import { createFileRoute } from '@tanstack/react-router'
import { Board } from '@/board/board'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { IssuesLens } from '@/issues/issues-lens'

export const Route = createFileRoute('/teams/$teamId/board')({ component: BoardPage })

// The Issues stop stays current: Board is a lens on the same work, reached from the Issues
// masthead. Band 2 belongs to the lens, not to the route: it states the FILTERED count, so only
// the surface that owns the filter can draw it.
function BoardPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <Board teamId={teamId} lens={<IssuesLens teamId={teamId} current="board" />} />
      </AppFrame>
    </Authenticated>
  )
}
