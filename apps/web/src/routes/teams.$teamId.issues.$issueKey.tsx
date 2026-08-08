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
  const [teams] = useQuery(queries.teams.all())

  const wanted = Number.parseInt(issueKey.replace(/^[^\d]*/u, ''), 10)
  const match = Number.isNaN(wanted) ? undefined : issues.find((issue) => issue.number === wanted)
  const teamKey = teams.find((team) => team.id === teamId)?.key

  // The URL segment is a bare number when the side panel handed the reader here, so band 2 states
  // the issue rather than the address: `ENG-116 · Saved cards behind a flag` (design §D7). Until
  // the row is synced there is nothing truer to say than the segment itself.
  const title =
    match === undefined || teamKey === undefined
      ? issueKey
      : `${teamKey}-${match.number} · ${match.title}`

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <Masthead
          title={title}
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
