import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { ArrowLeftIcon } from 'lucide-react'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { Masthead } from '@/frame/masthead'
import { IssueDetail } from '@/issues/issue-detail'
import { parseIssueKey } from '@/issues/model'

export const Route = createFileRoute('/teams/$teamId/issues/$issueKey')({
  component: IssueDetailPage,
})

// A doorway from an Issues row, so the Issues stop stays current.
function IssueDetailPage() {
  const { teamId, issueKey } = Route.useParams()
  const [teams, teamsResult] = useQuery(queries.teams.all())
  const teamKey = teams.find((team) => team.id === teamId)?.key
  // Until the team row syncs, `ENG-116` cannot be told apart from `OPS-116`, so the segment is
  // UNDECIDED rather than wrong — the parser's `undefined` is a third state, not a failure.
  const parsed = parseIssueKey(issueKey, teamKey)
  const undecided = parsed === undefined && teamsResult.type !== 'complete'
  const number = parsed ?? null

  // The address names `(teamId, number)`, which is exactly what the query takes. Resolving used to
  // mean syncing the whole team's backlog with its linked-delivery subtree and scanning it for a
  // number parsed out of the segment's digits — a cost paid in full on every cold deep link, and a
  // scan that would happily answer `OPS-116` with this team's 116.
  const [match, result] = useQuery(
    number === null ? undefined : queries.issues.byKey({ teamId, number }),
  )

  // Not-found is only ever said once something has actually finished: a malformed segment is known
  // immediately, but an unresolved one waits for the query to complete.
  const missing =
    !undecided && (number === null || (match === undefined && result.type === 'complete'))

  // Band 2 belongs to the page, and on this page band 2 IS the issue — breadcrumb, key, divergence
  // pill, the two-register subline, Follow and the primary action, all of which read the same
  // delivery signal the rail does. So the detail owns the masthead once it has a row to state; the
  // route keeps only the address-resolution states, which have nothing but the segment to say.
  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        {match ? (
          <IssueDetail issueId={match.id} teamId={teamId} layout="page" />
        ) : (
          <>
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
            <p className="p-8 text-center text-sm text-text-3" role="status">
              {missing ? 'This issue does not exist or is not visible to you.' : 'Loading issue…'}
            </p>
          </>
        )}
      </AppFrame>
    </Authenticated>
  )
}
