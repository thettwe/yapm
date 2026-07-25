import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { ConnectorsView } from '@/settings/connectors-view'

export const Route = createFileRoute('/settings/connectors')({ component: ConnectorsPage })

function ConnectorsPage() {
  return (
    <Authenticated>
      <AppShell current="Settings">
        <ConnectorsView />
      </AppShell>
    </Authenticated>
  )
}
