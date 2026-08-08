import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { DELIVERY_WINDOW_SIZES, type DeliveryWindowSize } from '@yapm/schema'
import { Authenticated } from '@/components/authenticated'
import { DeliveryView } from '@/delivery/delivery-view'
import { AppFrame } from '@/frame/app-frame'

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

  return (
    <Authenticated>
      <AppFrame teamId={teamId} current="delivery" measure="full">
        <DeliveryView
          teamId={teamId}
          size={window}
          // One history entry per window, not a replace: the reader who widens 3 → 12 to check a
          // trend expects Back to return them to the 3 they came from, not out of the view.
          onSizeChange={(size) => {
            void navigate({
              to: '/teams/$teamId/delivery',
              params: { teamId },
              search: { window: size },
            })
          }}
        />
      </AppFrame>
    </Authenticated>
  )
}
