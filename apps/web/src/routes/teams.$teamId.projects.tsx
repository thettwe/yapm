import { createFileRoute } from '@tanstack/react-router'
import { useSession } from '@/auth/client'
import { ViewSwitch } from '@/board/view-switch'
import { Authenticated } from '@/components/authenticated'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { ProjectsView } from '@/projects/projects-view'
import { useConnectionSummary } from '@/zero/connection'

interface ProjectsSearch {
  open?: string
}

export const Route = createFileRoute('/teams/$teamId/projects')({
  component: ProjectsPage,
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    open: typeof search.open === 'string' ? search.open : undefined,
  }),
})

function ProjectsPage() {
  const { teamId } = Route.useParams()
  const { open } = Route.useSearch()
  const connection = useConnectionSummary()
  const { data: session } = useSession()

  return (
    <Authenticated>
      <div className="flex min-h-svh flex-col bg-bg">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur">
          <Switcher current="Projects" />
          <ViewSwitch teamId={teamId} current="projects" />
          <div className="flex-1" />
          <ConnectionStatus connection={connection} />
          <ThemeControls />
          <UserMenu
            {...(session?.user.name ? { name: session.user.name } : {})}
            {...(session?.user.email ? { email: session.user.email } : {})}
          />
        </header>
        <ProjectsView {...(open ? { openProjectId: open } : {})} />
      </div>
    </Authenticated>
  )
}
