import { useQuery } from '@rocicorp/zero/react'
import { createFileRoute } from '@tanstack/react-router'
import { queries } from '@yapm/schema'
import { useMembership } from '@/auth/use-membership'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { InvitesPanel } from '@/components/invites-panel'
import { MembersPanel } from '@/components/members-panel'
import { TeamsPanel } from '@/components/teams-panel'
import { WorkspaceName } from '@/components/workspace-name'
import { useConnectionSummary } from '@/zero/connection'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return (
    <Authenticated>
      <AppShell current="Workspace">
        <Overview />
      </AppShell>
    </Authenticated>
  )
}

function Overview() {
  const connection = useConnectionSummary()
  const { canManage } = useMembership()
  const [workspace] = useQuery(queries.workspace.current())

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        {workspace ? (
          <WorkspaceName workspace={workspace} connection={connection} />
        ) : (
          <h1
            className="font-heading text-2xl font-semibold tracking-tight"
            data-testid="workspace-placeholder"
          >
            Loading workspace…
          </h1>
        )}
        <p className="text-muted-foreground text-sm">
          Project management that respects your keyboard.
        </p>
      </header>
      <MembersPanel />
      <TeamsPanel />
      {canManage ? <InvitesPanel /> : null}
    </div>
  )
}
