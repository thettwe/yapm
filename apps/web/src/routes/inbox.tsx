import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { InboxView } from '@/notifications/inbox-view'

export const Route = createFileRoute('/inbox')({ component: InboxPage })

// Workspace-wide, like `issues.mine`: the inbox spans every team the caller belongs to, so it
// sits outside the `/teams/$teamId` tree rather than inside it.
function InboxPage() {
  return (
    <Authenticated>
      <AppShell current="Inbox">
        <InboxView />
      </AppShell>
    </Authenticated>
  )
}
