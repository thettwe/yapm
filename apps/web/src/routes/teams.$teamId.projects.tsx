import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { ProjectsView } from '@/projects/projects-view'

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

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="projects" measure="full">
        <ProjectsView {...(open ? { openProjectId: open } : {})} />
      </AppFrame>
    </Authenticated>
  )
}
