import { createFileRoute } from '@tanstack/react-router'
import { AppShell } from '@/components/app-shell'
import { Authenticated } from '@/components/authenticated'
import { AiSettingsView } from '@/settings/ai-view'

export const Route = createFileRoute('/settings/ai')({ component: AiSettingsPage })

function AiSettingsPage() {
  return (
    <Authenticated>
      <AppShell current="Settings">
        <AiSettingsView />
      </AppShell>
    </Authenticated>
  )
}
