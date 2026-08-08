import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { IssueDetailPanel } from '@/issues/issue-detail'
import { IssueList } from '@/issues/issue-list'
import { IssuesLens } from '@/issues/issues-lens'

interface IssuesSearch {
  open?: string
}

export const Route = createFileRoute('/teams/$teamId/issues/')({
  component: IssuesPage,
  validateSearch: (search: Record<string, unknown>): IssuesSearch => ({
    open: typeof search.open === 'string' ? search.open : undefined,
  }),
})

function IssuesPage() {
  const { teamId } = Route.useParams()
  const { open } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="issues" measure="full">
        <IssueList
          teamId={teamId}
          lens={<IssuesLens teamId={teamId} current="list" />}
          {...(open ? { openIssueId: open } : {})}
        />
        {open ? (
          <IssueDetailPanel
            issueId={open}
            teamId={teamId}
            onClose={() =>
              void navigate({ to: '/teams/$teamId/issues', params: { teamId }, search: {} })
            }
          />
        ) : null}
      </AppFrame>
    </Authenticated>
  )
}
