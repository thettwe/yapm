import { createFileRoute } from '@tanstack/react-router'
import { Authenticated } from '@/components/authenticated'
import { AppFrame } from '@/frame/app-frame'
import { AiSettingsView } from '@/settings/ai-view'

export const Route = createFileRoute('/settings/ai')({ component: AiSettingsPage })

function AiSettingsPage() {
  return (
    <Authenticated>
      <AppFrame>
        <AiSettingsView />
      </AppFrame>
    </Authenticated>
  )
}
