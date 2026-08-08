import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { IssueAddress } from '@/issues/issue-address'

export const Route = createFileRoute('/teams/$teamId/issues/$issueKey')({
  component: IssueDetailPage,
})

// A doorway from an Issues row, so the Issues stop stays current.
function IssueDetailPage() {
  const { teamId, issueKey } = Route.useParams()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <IssueAddress teamId={teamId} issueKey={issueKey} />
      </AppFrame>
    </Authenticated>
  )
}
