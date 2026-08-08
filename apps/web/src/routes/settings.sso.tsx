import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { SsoSettingsView } from '@/settings/sso-view'

export const Route = createFileRoute('/settings/sso')({ component: SsoSettingsPage })

function SsoSettingsPage() {
  return (
    <Authenticated>
      <AppFrame>
        <SsoSettingsView />
      </AppFrame>
    </Authenticated>
  )
}
