import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  type ScreenReaderInstructions,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery, useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { type IssueStatus, mutators, queries } from '@yapm/schema'
import { BoardCard } from '@yapm/ui/components/board-card'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@yapm/ui/components/command-palette'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  appendRank,
  type BoardCardData,
  type BoardColumn,
  buildColumns,
  columnDroppableId,
  rankForSlot,
} from '@/board/model'
import {
  type IssueRowData,
  isPendingNumber,
  issueKey,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import { runMutation } from '@/lib/mutation'
import { VirtualColumnList } from './virtual-column'

const VIRTUALIZE_THRESHOLD = 100

function toCardData(issue: {
  id: string
  number?: number | null
  title: string
  status: IssueStatus
  priority: IssueRowData['priority']
  assigneeId?: string | null
  rank?: string | null
  updatedAt: number
  createdAt: number
  labels?: readonly { id: string; name: string; color: string }[]
  assignee?: {
    id: string
    name?: string | null
    email?: string | null
    image?: string | null
  } | null
}): BoardCardData {
  return {
    id: issue.id,
    number: issue.number ?? null,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assigneeId ?? null,
    rank: issue.rank ?? null,
    updatedAt: issue.updatedAt,
    createdAt: issue.createdAt,
    labels: (issue.labels ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
    assignee: issue.assignee
      ? {
          id: issue.assignee.id,
          name: issue.assignee.name,
          email: issue.assignee.email,
          image: issue.assignee.image,
        }
      : null,
  }
}

export function Board({ teamId }: { teamId: string }) {
  const [teams] = useQuery(queries.teams.all())
  const [issuesRaw] = useQuery(queries.issues.byTeam({ teamId }))
  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const cards = useMemo<BoardCardData[]>(
    () => issuesRaw.map((issue) => toCardData(issue as Parameters<typeof toCardData>[0])),
    [issuesRaw],
  )

  if (!team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 ? 'This team no longer exists.' : 'Loading team…'}
      </p>
    )
  }

  return <BoardBody teamId={teamId} teamKey={teamKey} teamName={team.name} cards={cards} />
}

interface BoardBodyProps {
  teamId: string
  teamKey: string
  teamName: string
  cards: readonly BoardCardData[]
}

function BoardBody({ teamId, teamKey, teamName, cards }: BoardBodyProps) {
  const zero = useZero()
  const navigate = useNavigate()
  const { canWrite } = useMembership()

  const columns = useMemo(() => buildColumns(cards), [cards])
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [paletteFor, setPaletteFor] = useState<string | null>(null)
  const [pendingFocus, setPendingFocus] = useState<string | null>(null)
  const pendingAttemptsRef = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const move = useCallback(
    (id: string, status: IssueStatus, rank: string) => {
      pendingAttemptsRef.current = 0
      setPendingFocus(id)
      void runMutation(
        zero.mutate(mutators.issue.move({ id, status, rank, updatedAt: Date.now() })),
      )
    },
    [zero],
  )

  const clearPendingFocus = useCallback(() => setPendingFocus(null), [])

  const openCard = useCallback(
    (id: string) => {
      void navigate({
        to: '/teams/$teamId/issues',
        params: { teamId },
        search: { open: id },
      })
    },
    [navigate, teamId],
  )

  // Restore focus to a moved card after its optimistic row lands and it remounts in the new
  // column (a keyboard move would otherwise drop focus to <body>). A card that lands in a
  // virtualized column outside the rendered window is scrolled into view and focused by its
  // VirtualColumnList; here the retries are bounded so a genuinely unreachable target is
  // dropped rather than left pending, where a late remount could abruptly steal focus.
  useEffect(() => {
    if (pendingFocus === null) return
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-card-id="${pendingFocus}"]`)
    if (el) {
      el.focus()
      setPendingFocus(null)
      return
    }
    pendingAttemptsRef.current += 1
    if (pendingAttemptsRef.current >= 3) setPendingFocus(null)
  }, [cards, pendingFocus])

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id))
  }, [])

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null)
      const { active, over } = event
      if (!over) return
      const activeCard = cardById.get(String(active.id))
      if (!activeCard) return

      const overData = over.data.current as { status?: IssueStatus } | undefined
      const overCard = cardById.get(String(over.id))
      const destStatus: IssueStatus = overData?.status ?? overCard?.status ?? activeCard.status

      const sameColumn = destStatus === activeCard.status
      const destCards = columns.find((c) => c.status === destStatus)?.cards ?? []

      let finalOrder: BoardCardData[]
      if (sameColumn) {
        const ids = destCards.map((c) => c.id)
        const oldIndex = ids.indexOf(activeCard.id)
        const overIndex = overCard ? ids.indexOf(overCard.id) : ids.length - 1
        if (oldIndex === -1 || overIndex === -1 || oldIndex === overIndex) return
        finalOrder = arrayMove([...destCards], oldIndex, overIndex)
      } else {
        const without = destCards.filter((c) => c.id !== activeCard.id)
        const overIndex = overCard ? without.findIndex((c) => c.id === overCard.id) : without.length
        const at = overIndex === -1 ? without.length : overIndex
        finalOrder = [...without.slice(0, at), activeCard, ...without.slice(at)]
      }

      const index = finalOrder.findIndex((c) => c.id === activeCard.id)
      move(activeCard.id, destStatus, rankForSlot(finalOrder, index))
    },
    [cardById, columns, move],
  )

  const announcements = useMemo<Announcements>(() => {
    const titleOf = (id: string | number) => cardById.get(String(id))?.title ?? 'issue'
    const statusOf = (id: string | number | undefined) =>
      id === undefined ? undefined : cardById.get(String(id))?.status
    return {
      onDragStart: ({ active }) => `Picked up ${titleOf(active.id)}.`,
      onDragOver: ({ active, over }) => {
        const status = statusOf(over?.id)
        return status
          ? `${titleOf(active.id)} moved over ${STATUS_LABEL[status]} column.`
          : undefined
      },
      onDragEnd: ({ active, over }) => {
        const status = statusOf(over?.id)
        return status
          ? `Dropped ${titleOf(active.id)} in ${STATUS_LABEL[status]}.`
          : `Dropped ${titleOf(active.id)}.`
      },
      onDragCancel: ({ active }) =>
        `Move cancelled. ${titleOf(active.id)} returned to its position.`,
    }
  }, [cardById])

  const screenReaderInstructions = useMemo<ScreenReaderInstructions>(
    () => ({
      draggable:
        'To pick up an issue, press Space or Enter. While dragging, use the arrow keys to move ' +
        'the card within and between status columns. Press Space or Enter again to drop, or ' +
        'Escape to cancel.',
    }),
    [],
  )

  // Keyboard shortcuts on the focused card. `o` opens the issue — a pointer-free open available
  // to viewers too (Enter and Space stay owned by dnd-kit's KeyboardSensor for pick-up/drop, so
  // they cannot double as "open"). `m` / ⌘K opens the "Move to status…" palette for writers.
  // The focused card is read from document.activeElement, so a shortcut can never fire against a
  // stale reference. Ignored while typing in a field or while a dialog is already open.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const editing =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.closest('[role="dialog"]') != null
      if (editing) return
      const cardEl = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
        '[data-card-id]',
      )
      const cardId = cardEl?.dataset.cardId
      if (!cardId) return
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openCard(cardId)
        return
      }
      const openMove =
        event.key.toLowerCase() === 'm' ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')
      if (openMove && canWrite) {
        event.preventDefault()
        setPaletteFor(cardId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canWrite, openCard])

  const activeCard = activeId ? cardById.get(activeId) : undefined

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <section
        ref={containerRef}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-bg p-3"
        aria-label={`${teamName} board`}
      >
        {columns.map((column) => (
          <Column
            key={column.status}
            column={column}
            teamKey={teamKey}
            readOnly={!canWrite}
            activeId={activeId}
            pendingFocusId={pendingFocus}
            onFocusRestored={clearPendingFocus}
            onOpenCard={openCard}
          />
        ))}
      </section>

      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeCard ? (
          <BoardCard
            issueKey={issueKey(teamKey, activeCard)}
            title={activeCard.title}
            status={STATUS_TO_KIND[activeCard.status]}
            priority={PRIORITY_TO_KIND[activeCard.priority]}
            labels={(activeCard.labels ?? []).map((l) => ({ name: l.name, color: l.color }))}
            {...assigneeProps(activeCard)}
            className="shadow-lg"
          />
        ) : null}
      </DragOverlay>

      {paletteFor ? (
        <MovePalette
          card={cardById.get(paletteFor)}
          columns={columns}
          onClose={() => setPaletteFor(null)}
          onMove={(status) => {
            const card = cardById.get(paletteFor)
            if (!card) return
            const dest = columns.find((c) => c.status === status)?.cards ?? []
            move(card.id, status, appendRank(dest.filter((c) => c.id !== card.id)))
            setPaletteFor(null)
          }}
        />
      ) : null}
    </DndContext>
  )
}

function assigneeProps(card: BoardCardData): { assignee?: { name: string; src?: string } } {
  if (!card.assignee) return {}
  const name = card.assignee.name ?? card.assignee.email ?? card.assignee.id
  return card.assignee.image
    ? { assignee: { name, src: card.assignee.image } }
    : { assignee: { name } }
}

interface ColumnProps {
  column: BoardColumn
  teamKey: string
  readOnly: boolean
  activeId: string | null
  pendingFocusId: string | null
  onFocusRestored: () => void
  onOpenCard: (id: string) => void
}

function Column({
  column,
  teamKey,
  readOnly,
  activeId,
  pendingFocusId,
  onFocusRestored,
  onOpenCard,
}: ColumnProps) {
  const { setNodeRef } = useDroppable({
    id: columnDroppableId(column.status),
    data: { status: column.status, type: 'column' },
  })
  const ids = column.cards.map((card) => card.id)
  const virtualize = column.cards.length > VIRTUALIZE_THRESHOLD

  return (
    <section
      className="flex w-72 shrink-0 flex-col rounded-card bg-bg-sidebar/50"
      aria-label={`${column.label}, ${column.cards.length} issues`}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <StatusGlyph status={STATUS_TO_KIND[column.status]} />
        <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
          {column.label}
        </span>
        <span className="font-mono text-xs text-text-3">{column.cards.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-16 flex-1 flex-col gap-2 px-2 pb-3">
          {column.cards.length === 0 ? (
            <p className="px-1 py-2 text-xs text-text-3">No issues</p>
          ) : virtualize ? (
            <VirtualColumnList
              cards={column.cards}
              teamKey={teamKey}
              readOnly={readOnly}
              activeId={activeId}
              pendingFocusId={pendingFocusId}
              onFocusRestored={onFocusRestored}
              onOpenCard={onOpenCard}
            />
          ) : (
            column.cards.map((card) => (
              <SortableCard
                key={card.id}
                card={card}
                teamKey={teamKey}
                readOnly={readOnly}
                dimmed={activeId === card.id}
                onOpenCard={onOpenCard}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  )
}

export interface SortableCardProps {
  card: BoardCardData
  teamKey: string
  readOnly: boolean
  dimmed: boolean
  onOpenCard: (id: string) => void
}

export function SortableCard({ card, teamKey, readOnly, dimmed, onOpenCard }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { status: card.status, rank: card.rank, type: 'card' },
    disabled: readOnly,
  })

  return (
    <BoardCard
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-card-id={card.id}
      data-testid="board-card"
      data-pending={isPendingNumber(card) || undefined}
      dragging={isDragging || dimmed}
      issueKey={issueKey(teamKey, card)}
      title={card.title}
      status={STATUS_TO_KIND[card.status]}
      priority={PRIORITY_TO_KIND[card.priority]}
      labels={(card.labels ?? []).map((l) => ({ name: l.name, color: l.color }))}
      {...assigneeProps(card)}
      onClick={() => onOpenCard(card.id)}
      {...attributes}
      {...listeners}
    />
  )
}

function MovePalette({
  card,
  columns,
  onClose,
  onMove,
}: {
  card: BoardCardData | undefined
  columns: readonly BoardColumn[]
  onClose: () => void
  onMove: (status: IssueStatus) => void
}) {
  return (
    <CommandDialog open onOpenChange={(next) => (next ? undefined : onClose())} label="Move issue">
      <CommandInput placeholder={`Move ${card?.title ?? 'issue'} to…`} />
      <CommandList>
        <CommandEmpty>No statuses found.</CommandEmpty>
        <CommandGroup heading="Move to status">
          {columns.map((column) => (
            <CommandItem
              key={column.status}
              value={`move to ${column.label}`}
              disabled={card?.status === column.status}
              onSelect={() => onMove(column.status)}
            >
              <StatusGlyph status={STATUS_TO_KIND[column.status]} />
              Move to {column.label}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
