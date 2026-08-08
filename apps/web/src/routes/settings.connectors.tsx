import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { ConnectorsView } from '@/settings/connectors-view'

export const Route = createFileRoute('/settings/connectors')({ component: ConnectorsPage })

function ConnectorsPage() {
  return (
    <Authenticated>
      <AppFrame>
        <ConnectorsView />
      </AppFrame>
    </Authenticated>
  )
}
