import { useVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useRef } from 'react'
import type { BoardCardData } from '@/board/model'
import { SortableCard } from './board'

const ESTIMATED_CARD_HEIGHT = 96
const OVERSCAN = 8

// Lazy virtualization for columns past the ~100-card threshold. The virtualizer positions each
// row with an outer absolutely-positioned wrapper (its transform lives here), while the
// SortableCard keeps its own sortable transform on the inner card element — so the two never
// overwrite each other (the canonical dnd-kit × virtualizer fix). The parent SortableContext
// still receives the full ordered id list, so drop indices stay correct even though only the
// visible window is mounted.
export function VirtualColumnList({
  cards,
  teamKey,
  readOnly,
  activeId,
  pendingFocusId,
  onFocusRestored,
  onOpenCard,
}: {
  cards: readonly BoardCardData[]
  teamKey: string
  readOnly: boolean
  activeId: string | null
  pendingFocusId: string | null
  onFocusRestored: () => void
  onOpenCard: (id: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_CARD_HEIGHT,
    overscan: OVERSCAN,
    getItemKey: (index) => cards[index]?.id ?? index,
  })

  // A card moved into this virtualized column may land outside the rendered window, so the
  // board-level focus-restore cannot reach it. When it belongs here, scroll it into view, then
  // focus it on the next frame once its row has mounted and clear the pending-focus state — so
  // "focus returns to the moved card" holds even for appended-to-a-large-column moves.
  useEffect(() => {
    if (pendingFocusId === null) return
    const index = cards.findIndex((card) => card.id === pendingFocusId)
    if (index === -1) return
    virtualizer.scrollToIndex(index, { align: 'auto' })
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-card-id="${pendingFocusId}"]`)
      if (el) {
        el.focus()
        onFocusRestored()
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [cards, pendingFocusId, virtualizer, onFocusRestored])

  return (
    <div ref={scrollRef} className="max-h-[70vh] overflow-y-auto">
      <div className="relative w-full" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const card = cards[virtualRow.index]
          if (!card) return null
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full pb-2"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <SortableCard
                card={card}
                teamKey={teamKey}
                readOnly={readOnly}
                dimmed={activeId === card.id}
                onOpenCard={onOpenCard}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
