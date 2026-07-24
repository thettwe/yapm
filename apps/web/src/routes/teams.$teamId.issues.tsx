import { createFileRoute } from '@tanstack/react-router'
import { useSession } from '@/auth/client'
import { Authenticated } from '@/components/authenticated'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { IssueList } from '@/issues/issue-list'
import { useConnectionSummary } from '@/zero/connection'

interface IssuesSearch {
  open?: string
}

export const Route = createFileRoute('/teams/$teamId/issues')({
  component: IssuesPage,
  validateSearch: (search: Record<string, unknown>): IssuesSearch => ({
    open: typeof search.open === 'string' ? search.open : undefined,
  }),
})

function IssuesPage() {
  const { teamId } = Route.useParams()
  const { open } = Route.useSearch()
  const connection = useConnectionSummary()
  const { data: session } = useSession()

  return (
    <Authenticated>
      <div className="flex min-h-svh flex-col bg-bg">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur">
          <Switcher current="Issues" />
          <div className="flex-1" />
          <ConnectionStatus connection={connection} />
          <ThemeControls />
          <UserMenu
            {...(session?.user.name ? { name: session.user.name } : {})}
            {...(session?.user.email ? { email: session.user.email } : {})}
          />
        </header>
        <IssueList teamId={teamId} {...(open ? { openIssueId: open } : {})} />
      </div>
    </Authenticated>
  )
}
