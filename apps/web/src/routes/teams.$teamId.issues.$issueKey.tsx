import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { ArrowLeftIcon } from 'lucide-react'
import { useSession } from '@/auth/client'
import { Authenticated } from '@/components/authenticated'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { IssueDetail } from '@/issues/issue-detail'
import { useConnectionSummary } from '@/zero/connection'

export const Route = createFileRoute('/teams/$teamId/issues/$issueKey')({
  component: IssueDetailPage,
})

function IssueDetailPage() {
  const { teamId, issueKey } = Route.useParams()
  const connection = useConnectionSummary()
  const { data: session } = useSession()
  const [issues, result] = useQuery(queries.issues.byTeam({ teamId }))

  const wanted = Number.parseInt(issueKey.replace(/^[^\d]*/u, ''), 10)
  const match = Number.isNaN(wanted) ? undefined : issues.find((issue) => issue.number === wanted)

  return (
    <Authenticated>
      <div className="flex min-h-svh flex-col bg-bg">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur">
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
          <Switcher current="Issues" />
          <div className="flex-1" />
          <ConnectionStatus connection={connection} />
          <ThemeControls />
          <UserMenu
            {...(session?.user.name ? { name: session.user.name } : {})}
            {...(session?.user.email ? { email: session.user.email } : {})}
          />
        </header>
        {match ? (
          <IssueDetail issueId={match.id} teamId={teamId} />
        ) : (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            {result.type === 'complete'
              ? 'This issue does not exist or is not visible to you.'
              : 'Loading issue…'}
          </p>
        )}
      </div>
    </Authenticated>
  )
}
