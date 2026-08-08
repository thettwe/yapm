import { createFileRoute } from '@tanstack/react-router'
import { Board } from '@/board/board'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { Masthead } from '@/frame/masthead'
import { IssuesLens } from '@/issues/issues-lens'

export const Route = createFileRoute('/teams/$teamId/board')({ component: BoardPage })

// The Issues stop stays current: Board is a lens on the same work, reached from the Issues masthead.
function BoardPage() {
  const { teamId } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <Masthead title="Issues" lens={<IssuesLens teamId={teamId} current="board" />} />
        <Board teamId={teamId} />
      </AppFrame>
    </Authenticated>
  )
}
