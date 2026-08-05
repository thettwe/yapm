import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { SsoSettingsView } from '@/settings/sso-view'

export const Route = createFileRoute('/settings/sso')({ component: SsoSettingsPage })

function SsoSettingsPage() {
  return (
    <Authenticated>
      <AppShell current="Settings">
        <SsoSettingsView />
      </AppShell>
    </Authenticated>
  )
}
