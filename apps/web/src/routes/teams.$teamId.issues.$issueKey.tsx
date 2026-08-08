import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { ArrowLeftIcon } from 'lucide-react'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { Masthead } from '@/frame/masthead'
import { IssueDetail } from '@/issues/issue-detail'

export const Route = createFileRoute('/teams/$teamId/issues/$issueKey')({
  component: IssueDetailPage,
})

// A doorway from an Issues row, so the Issues stop stays current.
function IssueDetailPage() {
  const { teamId, issueKey } = Route.useParams()
  const [issues, result] = useQuery(queries.issues.byTeam({ teamId }))

  const wanted = Number.parseInt(issueKey.replace(/^[^\d]*/u, ''), 10)
  const match = Number.isNaN(wanted) ? undefined : issues.find((issue) => issue.number === wanted)

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <Masthead
          title={issueKey}
          actions={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to issues"
              render={
                <Link to="/teams/$teamId/issues" params={{ teamId }} search={{}}>
                  <ArrowLeftIcon />
                </Link>
              }
            />
          }
        />
        {match ? (
          <IssueDetail issueId={match.id} teamId={teamId} />
        ) : (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            {result.type === 'complete'
              ? 'This issue does not exist or is not visible to you.'
              : 'Loading issue…'}
          </p>
        )}
      </AppFrame>
    </Authenticated>
  )
}
