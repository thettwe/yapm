import { createFileRoute } from '@tanstack/react-router'
import { useSession } from '@/auth/client'
import { ViewSwitch } from '@/board/view-switch'
import { Authenticated } from '@/components/authenticated'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { TriageView } from '@/triage/triage-view'
import { useConnectionSummary } from '@/zero/connection'

export const Route = createFileRoute('/teams/$teamId/triage')({ component: TriagePage })

function TriagePage() {
  const { teamId } = Route.useParams()
  const connection = useConnectionSummary()
  const { data: session } = useSession()

  return (
    <Authenticated>
      <div className="flex min-h-svh flex-col bg-bg">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur">
          <Switcher current="Triage" />
          <ViewSwitch teamId={teamId} current="triage" />
          <div className="flex-1" />
          <ConnectionStatus connection={connection} />
          <ThemeControls />
          <UserMenu
            {...(session?.user.name ? { name: session.user.name } : {})}
            {...(session?.user.email ? { email: session.user.email } : {})}
          />
        </header>
        <TriageView teamId={teamId} />
      </div>
    </Authenticated>
  )
}
