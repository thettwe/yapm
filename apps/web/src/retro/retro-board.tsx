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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@yapm/ui/components/button'
import {
  RetroAccentBar,
  type RetroAccentKind,
  RetroCard,
  RetroVotePips,
} from '@yapm/ui/components/retro-card'
import { cn } from '@yapm/ui/lib/utils'
import { GroupIcon, PlusIcon, Trash2Icon, UngroupIcon } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RetroApi } from '@/retro/api'
import {
  ACCENT_TO_KIND,
  appendRank,
  buildRetroColumns,
  compareByRank,
  myVotesFor,
  type RetroBoardColumn,
  type RetroBoardItem,
  type RetroCardData,
  type RetroColumnData,
  type RetroDraftData,
  type RetroGroupData,
  type RetroRowData,
  type RetroTallyData,
  type RetroVoteRowData,
  rankForSlot,
  retroCan,
  tallyFor,
  voteTarget,
} from '@/retro/model'

export interface RetroAuthor {
  name: string
  image?: string | null
}

export interface RetroBoardProps {
  retro: RetroRowData
  columns: readonly RetroColumnData[]
  cards: readonly RetroCardData[]
  groups: readonly RetroGroupData[]
  tallies: readonly RetroTallyData[]
  drafts: readonly RetroDraftData[]
  votes: readonly RetroVoteRowData[]
  authorOf: (userId: string) => RetroAuthor
  canWrite: boolean
  facilitator: boolean
  api: RetroApi
  composerColumnId: string | null
  onComposerColumn: (columnId: string | null) => void
  onFocusColumn: (columnId: string | null) => void
  onFocusChange: (focus: RetroFocus | null) => void
  onGroupWith: (cardId: string) => void
  onActionFrom: (item: RetroBoardItem) => void
}

export interface RetroFocus {
  id: string
  type: 'card' | 'group' | 'draft'
  columnId: string
}

const COLUMN_DROPPABLE_PREFIX = 'retro-column:'
const GROUP_DROPPABLE_PREFIX = 'retro-group:'

export function RetroBoard({
  retro,
  columns,
  cards,
  groups,
  tallies,
  drafts,
  votes,
  authorOf,
  canWrite,
  facilitator,
  api,
  composerColumnId,
  onComposerColumn,
  onFocusColumn,
  onFocusChange,
  onGroupWith,
  onActionFrom,
}: RetroBoardProps) {
  const boardColumns = useMemo(
    () => buildRetroColumns(columns, cards, groups),
    [columns, cards, groups],
  )
  const cardById = useMemo(() => new Map(cards.map((card) => [card.id, card])), [cards])
  const containerRef = useRef<HTMLElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const draggingRef = useRef(false)

  const canDraft = retroCan(retro.phase, 'draft', { canWrite })
  const canGroup = retroCan(retro.phase, 'group', { canWrite })
  const canVote = retroCan(retro.phase, 'vote', { canWrite })
  const canModerate = retroCan(retro.phase, 'moderate', { canWrite })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const focusItem = useCallback((id: string) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-retro-item="${id}"]`)
    el?.focus()
  }, [])

  // Roving focus across the whole board: every focusable card/group carries `data-retro-item`
  // and `data-retro-column`, so navigation reads the live DOM order and never a stale index.
  const focusables = useCallback((): HTMLElement[] => {
    const nodes = containerRef.current?.querySelectorAll<HTMLElement>('[data-retro-item]')
    return nodes ? [...nodes] : []
  }, [])

  const moveFocus = useCallback(
    (current: HTMLElement, delta: number, axis: 'column' | 'board') => {
      const all = focusables()
      if (axis === 'column') {
        const columnId = current.dataset.retroColumn
        const within = all.filter((el) => el.dataset.retroColumn === columnId)
        const index = within.indexOf(current)
        within[Math.max(0, Math.min(within.length - 1, index + delta))]?.focus()
        return
      }
      const columnIds = boardColumns.map((entry) => entry.column.id)
      const from = columnIds.indexOf(current.dataset.retroColumn ?? '')
      const target = columnIds[Math.max(0, Math.min(columnIds.length - 1, from + delta))]
      if (target === undefined) return
      const within = all.filter((el) => el.dataset.retroColumn === target)
      const rank = all.filter((el) => el.dataset.retroColumn === current.dataset.retroColumn)
      const offset = Math.min(rank.indexOf(current), within.length - 1)
      ;(within[Math.max(0, offset)] ?? within[0])?.focus()
    },
    [boardColumns, focusables],
  )

  // A dot follows the same target rule the mutator enforces: a grouped card is voted on THROUGH
  // its group, so a `v` on one is retargeted rather than sent to be rejected.
  const castOrRetract = useCallback(
    (id: string, kind: 'card' | 'group', retract: boolean) => {
      if (!canVote) return
      const card = kind === 'card' ? cardById.get(id) : undefined
      const targetType = card?.groupId != null ? 'group' : kind
      const targetId = card?.groupId != null ? card.groupId : id
      if (retract) {
        const mine = myVotesFor(votes, targetId)
        const last = mine[mine.length - 1]
        if (last) void api.retractVote(last.id)
        return
      }
      void api.castVote(targetType, targetId)
    },
    [api, canVote, cardById, votes],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (draggingRef.current) return
      const target = event.target as HTMLElement | null
      const editing =
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.closest('[role="dialog"]') != null
      if (editing) return
      const current = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>(
        '[data-retro-item]',
      )
      if (!current) return
      const itemId = current.dataset.retroItem
      const itemType = current.dataset.retroItemType
      if (itemId === undefined) return

      switch (event.key) {
        case 'ArrowDown':
        case 'j':
          event.preventDefault()
          moveFocus(current, 1, 'column')
          break
        case 'ArrowUp':
        case 'k':
          event.preventDefault()
          moveFocus(current, -1, 'column')
          break
        case 'ArrowRight':
          event.preventDefault()
          moveFocus(current, 1, 'board')
          break
        case 'ArrowLeft':
          event.preventDefault()
          moveFocus(current, -1, 'board')
          break
        case 'v':
          event.preventDefault()
          castOrRetract(itemId, itemType === 'group' ? 'group' : 'card', false)
          break
        case 'V':
          event.preventDefault()
          castOrRetract(itemId, itemType === 'group' ? 'group' : 'card', true)
          break
        case 'g':
          if (canGroup && itemType === 'card') {
            event.preventDefault()
            onGroupWith(itemId)
          }
          break
        default:
          break
      }
    },
    [canGroup, castOrRetract, moveFocus, onGroupWith],
  )

  // Dropping a card onto another ungrouped card in the same column FORMS a group (one group row
  // plus both cards' references); every other drop is the board's single-write move — one card
  // row's rank and group reference, minted here at the call site.
  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingRef.current = false
      setActiveId(null)
      const { active, over } = event
      if (!over || !canGroup) return
      const card = cardById.get(String(active.id))
      if (!card) return
      const overId = String(over.id)

      if (overId.startsWith(COLUMN_DROPPABLE_PREFIX)) {
        const columnId = overId.slice(COLUMN_DROPPABLE_PREFIX.length)
        const destination = cards.filter((row) => row.columnId === columnId && row.id !== card.id)
        if (columnId === card.columnId && card.groupId === null) return
        void api.moveCard(card.id, {
          columnId,
          groupId: null,
          rank: appendRank(destination),
        })
        return
      }

      if (overId.startsWith(GROUP_DROPPABLE_PREFIX)) {
        const groupId = overId.slice(GROUP_DROPPABLE_PREFIX.length)
        if (card.groupId === groupId) return
        const group = groups.find((row) => row.id === groupId)
        if (!group) return
        void api.moveCard(card.id, {
          columnId: group.columnId,
          groupId,
          rank: appendRank(cards.filter((row) => row.groupId === groupId)),
        })
        return
      }

      const overCard = cardById.get(overId)
      if (!overCard || overCard.id === card.id) return
      if (overCard.groupId !== null) {
        void api.moveCard(card.id, {
          columnId: overCard.columnId,
          groupId: overCard.groupId,
          rank: appendRank(cards.filter((row) => row.groupId === overCard.groupId)),
        })
        return
      }
      if (overCard.columnId !== card.columnId) {
        const destination = cards
          .filter((row) => row.columnId === overCard.columnId && row.id !== card.id)
          .sort(compareByRank)
        const at = destination.findIndex((row) => row.id === overCard.id)
        const finalOrder = [...destination.slice(0, at), card, ...destination.slice(at)]
        void api.moveCard(card.id, {
          columnId: overCard.columnId,
          groupId: null,
          rank: rankForSlot(finalOrder, at),
        })
        return
      }
      void api.groupCards(overCard.columnId, [overCard.id, card.id], overCard.rank)
    },
    [api, canGroup, cardById, cards, groups],
  )

  const announcements = useMemo<Announcements>(() => {
    const bodyOf = (id: string | number) => cardById.get(String(id))?.body ?? 'card'
    return {
      onDragStart: ({ active }) => `Picked up ${bodyOf(active.id)}.`,
      onDragOver: ({ active, over }) =>
        over ? `${bodyOf(active.id)} moved over a drop target.` : undefined,
      onDragEnd: ({ active }) => `Dropped ${bodyOf(active.id)}.`,
      onDragCancel: ({ active }) => `Move cancelled. ${bodyOf(active.id)} returned.`,
    }
  }, [cardById])

  const screenReaderInstructions = useMemo<ScreenReaderInstructions>(
    () => ({
      draggable:
        'To pick up a card, press Space or Enter. While dragging, use the arrow keys to move it ' +
        'over another card to group them, or over a column to move it there. Press Space or ' +
        'Enter again to drop, or Escape to cancel. "Group with…" is also available on G.',
    }),
    [],
  )

  const activeCard = activeId ? cardById.get(activeId) : undefined
  const accentOf = useCallback(
    (columnId: string) => {
      const column = columns.find((entry) => entry.id === columnId)
      return ACCENT_TO_KIND[column?.accentToken ?? 'neutral']
    },
    [columns],
  )

  useEffect(() => {
    if (canDraft) return
    onComposerColumn(null)
  }, [canDraft, onComposerColumn])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      accessibility={{ announcements, screenReaderInstructions }}
      onDragStart={(event: DragStartEvent) => {
        draggingRef.current = true
        setActiveId(String(event.active.id))
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        draggingRef.current = false
        setActiveId(null)
      }}
    >
      <section
        ref={containerRef}
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto bg-bg p-3"
        aria-label={`${retro.title} board`}
        onKeyDown={onKeyDown}
        onFocusCapture={(event) => {
          const target = event.target as HTMLElement
          onFocusColumn(
            target.closest<HTMLElement>('[data-retro-column]')?.dataset.retroColumn ?? null,
          )
          const item = target.closest<HTMLElement>('[data-retro-item]')
          const id = item?.dataset.retroItem
          onFocusChange(
            id === undefined
              ? null
              : {
                  id,
                  type: (item?.dataset.retroItemType as RetroFocus['type']) ?? 'card',
                  columnId: item?.dataset.retroColumn ?? '',
                },
          )
        }}
      >
        {boardColumns.map((entry) => (
          <BoardColumn
            key={entry.column.id}
            entry={entry}
            retro={retro}
            drafts={drafts.filter((draft) => draft.columnId === entry.column.id)}
            votes={votes}
            tallies={tallies}
            authorOf={authorOf}
            canDraft={canDraft}
            canGroup={canGroup}
            canVote={canVote}
            canModerate={canModerate}
            facilitator={facilitator}
            api={api}
            activeId={activeId}
            reducedMotion={reducedMotion}
            composerOpen={composerColumnId === entry.column.id}
            onOpenComposer={() => onComposerColumn(entry.column.id)}
            onCloseComposer={() => onComposerColumn(null)}
            onFocusItem={focusItem}
            onGroupWith={onGroupWith}
            onActionFrom={onActionFrom}
            onVote={castOrRetract}
          />
        ))}
      </section>

      <DragOverlay dropAnimation={reducedMotion ? null : undefined}>
        {activeCard ? (
          <RetroCard
            accent={accentOf(activeCard.columnId)}
            body={activeCard.body}
            anonymous={activeCard.isAnonymous}
            className="shadow-lg"
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

interface BoardColumnProps {
  entry: RetroBoardColumn
  retro: RetroRowData
  drafts: readonly RetroDraftData[]
  votes: readonly RetroVoteRowData[]
  tallies: readonly RetroTallyData[]
  authorOf: (userId: string) => RetroAuthor
  canDraft: boolean
  canGroup: boolean
  canVote: boolean
  canModerate: boolean
  facilitator: boolean
  api: RetroApi
  activeId: string | null
  reducedMotion: boolean
  composerOpen: boolean
  onOpenComposer: () => void
  onCloseComposer: () => void
  onFocusItem: (id: string) => void
  onGroupWith: (cardId: string) => void
  onActionFrom: (item: RetroBoardItem) => void
  onVote: (targetId: string, targetType: 'card' | 'group', retract: boolean) => void
}

function BoardColumn({
  entry,
  retro,
  drafts,
  votes,
  tallies,
  authorOf,
  canDraft,
  canGroup,
  canVote,
  canModerate,
  facilitator,
  api,
  activeId,
  reducedMotion,
  composerOpen,
  onOpenComposer,
  onCloseComposer,
  onFocusItem,
  onGroupWith,
  onActionFrom,
  onVote,
}: BoardColumnProps) {
  const { column, items, cardCount } = entry
  const accent = ACCENT_TO_KIND[column.accentToken]
  const { setNodeRef } = useDroppable({
    id: `${COLUMN_DROPPABLE_PREFIX}${column.id}`,
    data: { columnId: column.id, type: 'column' },
  })
  const sortableIds = useMemo(
    () =>
      items.flatMap((item) => (item.kind === 'group' ? item.cards.map((c) => c.id) : [item.id])),
    [items],
  )
  const mine = [...drafts].sort(compareByRank)

  return (
    <section
      data-retro-column={column.id}
      className="flex w-80 shrink-0 flex-col rounded-card border border-border bg-bg-sidebar/50"
      aria-label={`${column.title}, ${retro.phase === 'brainstorm' ? mine.length : cardCount} cards`}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <RetroAccentBar accent={accent} />
        <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
          {column.title}
        </span>
        <span className="font-mono text-xs text-text-3">
          {retro.phase === 'brainstorm' ? mine.length : cardCount}
        </span>
        {canDraft ? (
          <Button
            size="icon-xs"
            variant="ghost"
            className="ml-auto"
            aria-label={`Add a card to ${column.title}`}
            aria-keyshortcuts="c"
            data-testid="retro-add-card"
            onClick={onOpenComposer}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </header>

      <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-16 flex-1 flex-col gap-2 px-2 pb-3">
          {retro.phase === 'brainstorm' ? (
            <>
              {mine.length === 0 && !composerOpen ? (
                <p className="px-1 py-2 text-xs text-text-3">
                  Nothing yet. Your cards stay private until the room moves on.
                </p>
              ) : null}
              {mine.map((draft) => (
                <DraftCard
                  key={draft.id}
                  draft={draft}
                  accent={accent}
                  columnId={column.id}
                  editable={canDraft}
                  api={api}
                />
              ))}
              {composerOpen ? (
                <Composer
                  columnTitle={column.title}
                  onSubmit={(body) => void api.createDraft(column.id, body, mine)}
                  onClose={onCloseComposer}
                />
              ) : null}
            </>
          ) : (
            <>
              {items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-text-3">No cards</p>
              ) : null}
              {items.map((item) =>
                item.kind === 'group' ? (
                  <GroupBlock
                    key={item.id}
                    item={item}
                    columnId={column.id}
                    accent={accent}
                    retro={retro}
                    votes={votes}
                    tallies={tallies}
                    authorOf={authorOf}
                    canGroup={canGroup}
                    canVote={canVote}
                    canModerate={canModerate}
                    facilitator={facilitator}
                    api={api}
                    activeId={activeId}
                    reducedMotion={reducedMotion}
                    onGroupWith={onGroupWith}
                    onActionFrom={onActionFrom}
                    onVote={onVote}
                    onFocusItem={onFocusItem}
                  />
                ) : (
                  <SortableRetroCard
                    key={item.id}
                    card={item.card}
                    columnId={column.id}
                    accent={accent}
                    retro={retro}
                    authorOf={authorOf}
                    draggable={canGroup}
                    canVote={canVote}
                    canModerate={canModerate}
                    reducedMotion={reducedMotion}
                    dimmed={activeId === item.id}
                    votes={myVotesFor(votes, item.id).length}
                    tally={tallyFor(tallies, item.id)}
                    onVote={(retract) => onVote(item.id, 'card', retract)}
                    onGroupWith={() => onGroupWith(item.id)}
                    onDelete={() => void api.deleteCard(item.id)}
                    onAction={() => onActionFrom(item)}
                  />
                ),
              )}
            </>
          )}
        </div>
      </SortableContext>
    </section>
  )
}

function Composer({
  columnTitle,
  onSubmit,
  onClose,
}: {
  columnTitle: string
  onSubmit: (body: string) => void
  onClose: () => void
}) {
  const [body, setBody] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  // Enter submits and KEEPS the composer open for the next card; Shift+Enter is a newline and
  // Escape leaves. This is the capture loop the keyboard spec asks for.
  return (
    <textarea
      ref={ref}
      rows={3}
      data-testid="retro-composer"
      aria-label={`New card in ${columnTitle}`}
      placeholder="What happened? Enter to add, Esc to close…"
      value={body}
      onChange={(event) => setBody(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault()
          const trimmed = body.trim()
          if (trimmed.length === 0) return
          onSubmit(trimmed)
          setBody('')
          return
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
      className="w-full resize-none rounded-card border border-accent-line bg-bg-elevated px-3 py-2.5 text-[13.5px] leading-snug text-text-1 outline-none placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
    />
  )
}

function DraftCard({
  draft,
  accent,
  columnId,
  editable,
  api,
}: {
  draft: RetroDraftData
  accent: RetroAccentKind
  columnId: string
  editable: boolean
  api: RetroApi
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(draft.body)

  if (editing) {
    return (
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the editor replaces the focused card in place
        autoFocus
        rows={3}
        aria-label="Edit card"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            const trimmed = body.trim()
            if (trimmed.length > 0) void api.updateDraft(draft.id, trimmed)
            setEditing(false)
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setBody(draft.body)
            setEditing(false)
          }
        }}
        className="w-full resize-none rounded-card border border-accent-line bg-bg-elevated px-3 py-2.5 text-[13.5px] leading-snug text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      />
    )
  }

  return (
    <RetroCard
      role="button"
      tabIndex={0}
      data-retro-item={draft.id}
      data-retro-item-type="draft"
      data-retro-column={columnId}
      data-testid="retro-draft"
      accent={accent}
      body={draft.body}
      aria-label={`Your card: ${draft.body}`}
      onClick={() => editable && setEditing(true)}
      onKeyDown={(event) => {
        if (!editable) return
        if (event.key === 'Enter') {
          event.preventDefault()
          setEditing(true)
          return
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          event.preventDefault()
          void api.deleteDraft(draft.id)
        }
      }}
      actions={
        editable ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Delete card"
            onClick={(event) => {
              event.stopPropagation()
              void api.deleteDraft(draft.id)
            }}
          >
            <Trash2Icon />
          </Button>
        ) : undefined
      }
    />
  )
}

interface GroupBlockProps {
  item: Extract<RetroBoardItem, { kind: 'group' }>
  columnId: string
  accent: RetroAccentKind
  retro: RetroRowData
  votes: readonly RetroVoteRowData[]
  tallies: readonly RetroTallyData[]
  authorOf: (userId: string) => RetroAuthor
  canGroup: boolean
  canVote: boolean
  canModerate: boolean
  facilitator: boolean
  api: RetroApi
  activeId: string | null
  reducedMotion: boolean
  onGroupWith: (cardId: string) => void
  onActionFrom: (item: RetroBoardItem) => void
  onVote: (targetId: string, targetType: 'card' | 'group', retract: boolean) => void
  onFocusItem: (id: string) => void
}

function GroupBlock({
  item,
  columnId,
  accent,
  retro,
  votes,
  tallies,
  authorOf,
  canGroup,
  canVote,
  canModerate,
  facilitator,
  api,
  activeId,
  reducedMotion,
  onGroupWith,
  onActionFrom,
  onVote,
  onFocusItem,
}: GroupBlockProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${GROUP_DROPPABLE_PREFIX}${item.id}`,
    data: { groupId: item.id, type: 'group' },
  })
  const [labelling, setLabelling] = useState(false)
  const [label, setLabel] = useState(item.label ?? '')
  const mine = myVotesFor(votes, item.id).length
  const target = voteTarget(item)

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 rounded-card border border-dashed border-border-strong bg-bg/40 p-2',
        isOver && 'border-accent bg-accent-soft/40',
      )}
    >
      <div className="flex items-center gap-2">
        {labelling ? (
          <input
            // biome-ignore lint/a11y/noAutofocus: the field replaces the label in place
            autoFocus
            aria-label="Group label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            onBlur={() => setLabelling(false)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void api.labelGroup(item.id, label.trim().length === 0 ? null : label.trim())
                setLabelling(false)
                onFocusItem(item.id)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setLabel(item.label ?? '')
                setLabelling(false)
                onFocusItem(item.id)
              }
            }}
            className="flex-1 rounded-control border border-accent-line bg-bg-elevated px-2 py-1 text-xs text-text-1 outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        ) : (
          <button
            type="button"
            data-retro-item={item.id}
            data-retro-item-type="group"
            data-retro-column={columnId}
            data-testid="retro-group"
            aria-label={`Group ${item.label ?? 'unlabelled'}, ${item.cards.length} cards`}
            aria-keyshortcuts="v"
            className="flex flex-1 items-center gap-2 rounded-control px-1 py-0.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => canGroup && setLabelling(true)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && canGroup) {
                event.preventDefault()
                setLabelling(true)
              }
            }}
          >
            <span className="text-[12px] font-semibold text-text-1">
              {item.label ?? 'Unlabelled cluster'}
            </span>
            <span className="font-mono text-[11px] text-text-3">{item.cards.length}</span>
          </button>
        )}
        <VoteControl
          disabled={!canVote}
          count={tallyFor(tallies, item.id)}
          mine={mine}
          label={item.label ?? 'cluster'}
          onCast={() => onVote(target.targetId, 'group', false)}
          onRetract={() => onVote(target.targetId, 'group', true)}
        />
        {canGroup ? (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Ungroup these cards"
            onClick={() => void api.dissolveGroup(item.id)}
          >
            <UngroupIcon />
          </Button>
        ) : null}
        <ActionFromButton onClick={() => onActionFrom(item)} retro={retro} />
      </div>
      {item.cards.map((card) => (
        <SortableRetroCard
          key={card.id}
          card={card}
          columnId={columnId}
          accent={accent}
          retro={retro}
          authorOf={authorOf}
          draggable={canGroup}
          canVote={false}
          canModerate={canModerate}
          reducedMotion={reducedMotion}
          dimmed={activeId === card.id}
          votes={0}
          tally={0}
          grouped
          onVote={() => undefined}
          onGroupWith={() => onGroupWith(card.id)}
          onDelete={() => void api.deleteCard(card.id)}
          onAction={() => onActionFrom({ kind: 'card', id: card.id, rank: card.rank, card })}
        />
      ))}
      {facilitator && item.cards.length === 0 ? (
        <p className="px-1 text-[11px] text-text-3">Empty clusters are dissolved automatically.</p>
      ) : null}
    </div>
  )
}

interface SortableRetroCardProps {
  card: RetroCardData
  columnId: string
  accent: RetroAccentKind
  retro: RetroRowData
  authorOf: (userId: string) => RetroAuthor
  draggable: boolean
  canVote: boolean
  canModerate: boolean
  reducedMotion: boolean
  dimmed: boolean
  votes: number
  tally: number
  grouped?: boolean
  onVote: (retract: boolean) => void
  onGroupWith: () => void
  onDelete: () => void
  onAction: () => void
}

function SortableRetroCard({
  card,
  columnId,
  accent,
  retro,
  authorOf,
  draggable,
  canVote,
  canModerate,
  reducedMotion,
  dimmed,
  votes,
  tally,
  grouped = false,
  onVote,
  onGroupWith,
  onDelete,
  onAction,
}: SortableRetroCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { columnId, groupId: card.groupId, type: 'card' },
    disabled: !draggable,
    animateLayoutChanges: () => !reducedMotion,
  })

  // dnd-kit reports a non-draggable card as aria-disabled because dragging is off, but the card
  // is still an operable, focusable target (vote, group-with, action). Strip those states when
  // dragging is unavailable so AT announces something actionable rather than dead.
  const dragA11y = draggable
    ? attributes
    : {
        ...attributes,
        'aria-disabled': undefined,
        'aria-roledescription': undefined,
        'aria-describedby': undefined,
      }

  const author = card.authorDisplayId === null ? undefined : authorOf(card.authorDisplayId)

  return (
    <RetroCard
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reducedMotion ? undefined : transition,
      }}
      data-retro-item={card.id}
      data-retro-item-type="card"
      data-retro-column={columnId}
      data-testid="retro-card"
      dragging={isDragging || dimmed}
      accent={accent}
      body={card.body}
      anonymous={card.isAnonymous}
      {...(author ? { author: { name: author.name, src: author.image ?? null } } : {})}
      aria-label={`${card.body}${card.isAnonymous ? ', anonymous' : ''}`}
      aria-keyshortcuts={canVote ? 'v' : undefined}
      votes={
        grouped ? undefined : (
          <VoteControl
            disabled={!canVote}
            count={tally}
            mine={votes}
            label={card.body}
            onCast={() => onVote(false)}
            onRetract={() => onVote(true)}
          />
        )
      }
      actions={
        <>
          {draggable ? (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Group with…"
              aria-keyshortcuts="g"
              data-testid="retro-group-with"
              onClick={onGroupWith}
            >
              <GroupIcon />
            </Button>
          ) : null}
          <ActionFromButton onClick={onAction} retro={retro} />
          {canModerate ? (
            <Button size="icon-xs" variant="ghost" aria-label="Remove card" onClick={onDelete}>
              <Trash2Icon />
            </Button>
          ) : null}
        </>
      }
      {...dragA11y}
      {...listeners}
    />
  )
}

function ActionFromButton({ onClick, retro }: { onClick: () => void; retro: RetroRowData }) {
  if (!retroCan(retro.phase, 'action', { canWrite: true })) return null
  return (
    <Button size="xs" variant="ghost" onClick={onClick} data-testid="retro-action-from">
      Make an action
    </Button>
  )
}

function VoteControl({
  disabled,
  count,
  mine,
  label,
  onCast,
  onRetract,
}: {
  disabled: boolean
  count: number
  mine: number
  label: string
  onCast: () => void
  onRetract: () => void
}) {
  if (disabled) {
    return count === 0 ? null : <RetroVotePips count={count} mine={mine} />
  }
  return (
    <span className="flex shrink-0 items-center gap-1">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Retract a dot from ${label}`}
        disabled={mine === 0}
        onClick={onRetract}
        data-testid="retro-retract-vote"
      >
        −
      </Button>
      <RetroVotePips count={count} mine={mine} />
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Vote for ${label}`}
        aria-keyshortcuts="v"
        onClick={onCast}
        data-testid="retro-cast-vote"
      >
        +
      </Button>
    </span>
  )
}
