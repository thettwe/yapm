import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DELIVERY_WINDOW_SIZES, type DeliveryWindowSize } from '@yapm/schema'
import { useSession } from '@/auth/client'
import { ViewSwitch } from '@/board/view-switch'
import { Authenticated } from '@/components/authenticated'
import { ConnectionStatus } from '@/components/connection-status'
import { Switcher } from '@/components/switcher'
import { ThemeControls } from '@/components/theme-controls'
import { UserMenu } from '@/components/user-menu'
import { DeliveryView } from '@/delivery/delivery-view'
import { useConnectionSummary } from '@/zero/connection'

interface DeliverySearch {
  window: DeliveryWindowSize
}

const DEFAULT_WINDOW: DeliveryWindowSize = 6

function toWindowSize(value: unknown): DeliveryWindowSize {
  const size = Number(value)
  return (DELIVERY_WINDOW_SIZES as readonly number[]).includes(size)
    ? (size as DeliveryWindowSize)
    : DEFAULT_WINDOW
}

export const Route = createFileRoute('/teams/$teamId/delivery')({
  component: DeliveryPage,
  // The window lives in the URL so a reading is shareable and the back button behaves — the
  // precedent `/search?q=` set. Anything outside the three offered sizes narrows to the default
  // rather than rendering an unbounded window.
  validateSearch: (search: Record<string, unknown>): DeliverySearch => ({
    window: toWindowSize(search.window),
  }),
})

function DeliveryPage() {
  const { teamId } = Route.useParams()
  const { window } = Route.useSearch()
  const navigate = useNavigate()
  const connection = useConnectionSummary()
  const { data: session } = useSession()

  return (
    <Authenticated>
      <div className="flex min-h-svh flex-col bg-bg">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 py-2.5 backdrop-blur">
          <Switcher current="Delivery" />
          <ViewSwitch teamId={teamId} current="delivery" />
          <div className="flex-1" />
          <ConnectionStatus connection={connection} />
          <ThemeControls />
          <UserMenu
            {...(session?.user.name ? { name: session.user.name } : {})}
            {...(session?.user.email ? { email: session.user.email } : {})}
          />
        </header>
        <DeliveryView
          teamId={teamId}
          size={window}
          onSizeChange={(size) => {
            void navigate({
              to: '/teams/$teamId/delivery',
              params: { teamId },
              search: { window: size },
              replace: true,
            })
          }}
        />
      </div>
    </Authenticated>
  )
}
