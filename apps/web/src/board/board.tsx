import {
  type Announcements,
  closestCorners,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
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
import {
  buildDeploymentIndex,
  type IssueFilter,
  type IssueStatus,
  mutators,
  queries,
  type TeamDeploymentRow,
} from '@yapm/schema'
import { BoardCard, CARD_TRACK_WIDTH } from '@yapm/ui/components/board-card'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@yapm/ui/components/command-palette'
import {
  buildRealityShape,
  RealityTrack,
  realityTrackLabel,
} from '@yapm/ui/components/reality-track'
import { RestPhraseText } from '@yapm/ui/components/rest-phrase'
import { StatusGlyph } from '@yapm/ui/components/status-glyph'
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useMembership } from '@/auth/use-membership'
import {
  appendRank,
  type BoardCardData,
  type BoardColumn,
  buildColumns,
  columnDroppableId,
  FOCUS_RESTORE_FRAMES,
  rankForSlot,
  shouldVirtualize,
} from '@/board/model'
import { useCommandSource } from '@/frame/command-registry'
import { CommandProvider, useCommand } from '@/issues/command'
import {
  DIVERGENCE_LABEL,
  deliveryView,
  type LinkedIssueRow,
  linkedEntitiesFor,
} from '@/issues/delivery'
import {
  type CycleOption,
  FilterBar,
  type ProjectOption,
  type TeamMemberOption,
} from '@/issues/filter-bar'
import {
  buildGroups,
  DEFAULT_GROUPING,
  DEFAULT_SORT,
  type IssueRowData,
  isPendingNumber,
  issueKey,
  PRIORITY_LABEL,
  PRIORITY_TO_KIND,
  STATUS_LABEL,
  STATUS_TO_KIND,
} from '@/issues/model'
import { ownsKeyboard } from '@/lib/keyboard'
import { runMutation } from '@/lib/mutation'
import { VirtualColumnList } from './virtual-column'

// The mock's two reserved measures: the resting slot an empty column keeps, and the landing slot a
// cross-column hover opens.
const REST_SLOT_HEIGHT = 64
const DROP_SLOT_HEIGHT = 104

// Where a live move will come to rest: the destination column, and the card it lands in front of
// (`null` appends). Only ever set for a column that is NOT the moved card's own — within a column
// the sortable strategy's own gap is already the landing site, and a second one drawn beside it
// would show two.
interface Landing {
  readonly status: IssueStatus
  readonly beforeId: string | null
}

function toCardData(
  issue: {
    id: string
    number?: number | null
    title: string
    status: IssueStatus
    priority: IssueRowData['priority']
    assigneeId?: string | null
    rank?: string | null
    cycleId?: string | null
    projectId?: string | null
    updatedAt: number
    createdAt: number
    labels?: readonly { id: string; name: string; color: string }[]
    assignee?: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    } | null
    issueLinks?: readonly LinkedIssueRow[]
  },
  deployIndex: ReturnType<typeof buildDeploymentIndex>,
): BoardCardData {
  return {
    id: issue.id,
    number: issue.number ?? null,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assigneeId ?? null,
    rank: issue.rank ?? null,
    cycleId: issue.cycleId ?? null,
    projectId: issue.projectId ?? null,
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
    linked: linkedEntitiesFor(issue.issueLinks, deployIndex),
  }
}

// Read from `document.activeElement` rather than a held reference, so a shortcut can never fire
// against a card that has since gone.
function focusedCardId(): string | undefined {
  return (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-card-id]')
    ?.dataset.cardId
}

export function Board({ teamId, lens }: { teamId: string; lens?: ReactNode }) {
  const [teams] = useQuery(queries.teams.all())
  const [issuesRaw, issuesResult] = useQuery(queries.issues.byTeam({ teamId }))
  const [users] = useQuery(queries.users.all())
  const [labels] = useQuery(queries.labels.byTeam({ teamId }))
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  const [projects] = useQuery(queries.projects.all())
  // The team-scoped query the list already runs. The deployment -> merged-PR match is a computed
  // join, so the board needs the team's deployments to draw the strip's deploy station.
  const [deployments] = useQuery(queries.deployments.byTeam({ teamId }))
  // Indexed ONCE for the whole board, never rescanned per card: the join is `repo + merge commit`,
  // so one pass over the team's deployments serves every card.
  const deployIndex = useMemo(
    () => buildDeploymentIndex(deployments as readonly TeamDeploymentRow[]),
    [deployments],
  )

  const team = teams.find((candidate) => candidate.id === teamId)
  const teamKey = team?.key ?? ''

  const memberOptions = useMemo<TeamMemberOption[]>(() => {
    const memberships = (team?.members ?? []) as readonly { userId: string }[]
    return memberships.map((membership) => {
      const user = users.find((candidate) => candidate.id === membership.userId)
      return { id: membership.userId, name: user?.name ?? user?.email ?? membership.userId }
    })
  }, [team, users])

  const cards = useMemo<BoardCardData[]>(
    () =>
      issuesRaw.map((issue) => toCardData(issue as Parameters<typeof toCardData>[0], deployIndex)),
    [issuesRaw, deployIndex],
  )

  if (!team) {
    // Labels, not sentences: this page carries no explanatory prose at all.
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {teams.length > 0 || issuesResult.type === 'complete' ? 'Team not found' : 'Loading…'}
      </p>
    )
  }

  return (
    <BoardBody
      teamId={teamId}
      teamKey={teamKey}
      teamName={team.name}
      cards={cards}
      memberOptions={memberOptions}
      labelOptions={labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      }))}
      cycleOptions={cycles.map((cycle) => ({
        id: cycle.id,
        name: cycle.name,
        number: cycle.number ?? null,
      }))}
      projectOptions={projects.map((project) => ({ id: project.id, name: project.name }))}
      {...(lens === undefined ? {} : { lens })}
    />
  )
}

interface BoardBodyProps {
  teamId: string
  teamKey: string
  teamName: string
  cards: readonly BoardCardData[]
  memberOptions: readonly TeamMemberOption[]
  labelOptions: readonly { id: string; name: string; color: string }[]
  cycleOptions: readonly CycleOption[]
  projectOptions: readonly ProjectOption[]
  lens?: ReactNode
}

function BoardBody({
  teamId,
  teamKey,
  teamName,
  cards,
  memberOptions,
  labelOptions,
  cycleOptions,
  projectOptions,
  lens,
}: BoardBodyProps) {
  const zero = useZero()
  const navigate = useNavigate()
  const { canWrite } = useMembership()
  const [savedViews] = useQuery(queries.savedViews.byTeam({ teamId }))

  const [filter, setFilter] = useState<IssueFilter>({})
  const [cycleFilter, setCycleFilter] = useState<readonly (string | null)[] | undefined>(undefined)
  const [projectFilter, setProjectFilter] = useState<readonly (string | null)[] | undefined>(
    undefined,
  )

  const assigneeName = useCallback(
    (id: string) => memberOptions.find((member) => member.id === id)?.name ?? id,
    [memberOptions],
  )
  const cycleName = useCallback(
    (id: string) => cycleOptions.find((cycle) => cycle.id === id)?.name ?? id,
    [cycleOptions],
  )
  const projectName = useCallback(
    (id: string) => projectOptions.find((project) => project.id === id)?.name ?? id,
    [projectOptions],
  )

  // The SAME evaluator the list runs, over the same already-synced rows: one filter model, so the
  // two lenses can never disagree about how much work matches. Grouping is `none` because the
  // board's grouping IS the status enum, and the sort is spent immediately — `buildColumns` orders
  // each column by its manual rank.
  const { ordered, count } = useMemo(
    () =>
      buildGroups(cards, {
        filter,
        grouping: 'none',
        sort: DEFAULT_SORT,
        teamKey,
        assigneeName,
        cycleName,
        projectName,
        ...(cycleFilter ? { cycleIds: cycleFilter } : {}),
        ...(projectFilter ? { projectIds: projectFilter } : {}),
      }),
    [cards, filter, teamKey, assigneeName, cycleName, projectName, cycleFilter, projectFilter],
  )

  const columns = useMemo(() => buildColumns(ordered as readonly BoardCardData[]), [ordered])
  const cardById = useMemo(
    () => new Map(columns.flatMap((column) => column.cards).map((card) => [card.id, card])),
    [columns],
  )

  const virtualizedIds = useMemo(() => {
    const set = new Set<string>()
    for (const col of columns) {
      if (shouldVirtualize(col.cards.length)) for (const card of col.cards) set.add(card.id)
    }
    return set
  }, [columns])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)
  const [paletteFor, setPaletteFor] = useState<string | null>(null)
  // The card a move is waiting to hand focus back to, WITH where it was sent: a move that takes the
  // card out of the current filter has no card to return focus to, and the destination column is
  // the only thing left standing where the reader left off.
  const [pendingFocus, setPendingFocus] = useState<{ id: string; status: IssueStatus } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const move = useCallback(
    (id: string, status: IssueStatus, rank: string) => {
      setPendingFocus({ id, status })
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
  // column (a keyboard move would otherwise drop focus to <body>). The restore must outlast the
  // competing focus handoffs that fire in the same tick: Radix returns focus to the (now stale)
  // trigger when the move palette closes, and dnd-kit's KeyboardSensor refocuses the activator
  // after a drop. So focus is (re)asserted across a bounded run of animation frames and only
  // settled once it has actually stuck (activeElement is the card). A card that lands in a
  // virtualized column is delegated entirely to its VirtualColumnList, which owns re-scroll +
  // re-focus and clears pendingFocus itself; this effect returns early for those targets so the
  // two never co-drive (and race to clear) the same pendingFocus. The attempt counter is local to
  // each effect run, mirroring VirtualColumnList, so a mid-window `cards` re-render resets both.
  //
  // A move can also make the card fail the board's own FILTER — send a card the reader has
  // narrowed to Todo into In Review and the row is still there, but this board no longer draws it.
  // Retrying a card selector that can never match again would spend the whole window and leave
  // focus on <body>, so the target becomes the DESTINATION COLUMN (whose accessible name already
  // states the label and the count) and the live region says where the card went. Same bounded
  // run of frames either way: the column has to outlast the same competing handoffs the card does.
  useEffect(() => {
    if (pendingFocus === null) return
    const filteredOut = !cardById.has(pendingFocus.id)
    if (!filteredOut && virtualizedIds.has(pendingFocus.id)) return
    if (filteredOut) {
      setAnnouncement(
        `Moved to ${STATUS_LABEL[pendingFocus.status]}, which the current filter hides.`,
      )
    }
    const selector = filteredOut
      ? `[data-column-status="${pendingFocus.status}"]`
      : `[data-card-id="${pendingFocus.id}"]`
    let frame = 0
    let attempts = 0
    const step = () => {
      const el = containerRef.current?.querySelector<HTMLElement>(selector)
      if (el && document.activeElement === el) {
        setPendingFocus(null)
        return
      }
      el?.focus()
      attempts += 1
      if (attempts >= FOCUS_RESTORE_FRAMES) {
        setPendingFocus(null)
        return
      }
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [cardById, cards, pendingFocus, virtualizedIds])

  const onDragStart = useCallback((event: DragStartEvent) => {
    draggingRef.current = true
    setActiveId(String(event.active.id))
  }, [])

  // dnd-kit reports `over` identically whether it came from a pointer or an arrow key, so the
  // landing slot is drawn for a keyboard move without a second code path.
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      const activeCard = cardById.get(String(active.id))
      if (!over || !activeCard) {
        setLanding(null)
        return
      }
      const overData = over.data.current as { status?: IssueStatus } | undefined
      const overCard = cardById.get(String(over.id))
      const destStatus: IssueStatus = overData?.status ?? overCard?.status ?? activeCard.status
      if (destStatus === activeCard.status) {
        setLanding(null)
        return
      }
      setLanding({ status: destStatus, beforeId: overCard?.id ?? null })
    },
    [cardById],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingRef.current = false
      setActiveId(null)
      setLanding(null)
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
      if (draggingRef.current) return
      if (ownsKeyboard(event.target)) return
      const cardId = focusedCardId()
      if (!cardId) return
      if (event.key.toLowerCase() === 'o') {
        event.preventDefault()
        openCard(cardId)
        return
      }
      if (event.key.toLowerCase() === 'm' && canWrite) {
        event.preventDefault()
        setPaletteFor(cardId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [canWrite, openCard])

  // ⌘K on the board still opens "Move to status…" for the focused card — it is registered with the
  // frame's one owner (§D6) instead of being a second window binding. `m` and `o` are surface
  // shortcuts and stay exactly as they were.
  //
  // "Move to status…" is about a FOCUSED CARD, so with none focused (or mid-drag, or for a viewer)
  // this opener declines and the ambient issues palette answers instead. Swallowing ⌘K there would
  // make the deck's advertised binding do nothing on the board, which is the exact lie §D6 exists
  // to end.
  //
  // REGISTRATION ORDER IS LOAD-BEARING. The registry consults the most recently registered source
  // first, and effects run children before parents — so `CommandProvider`, which registers an
  // opener that never declines, is mounted BELOW this component (it wraps band 2 only) and this
  // opener gets first refusal. Hoisting the provider above `BoardBody` would silently hand ⌘K to
  // the issues palette and lose the card move.
  const openFromRegistry = useCallback(() => {
    if (draggingRef.current || !canWrite) return false
    const cardId = focusedCardId()
    if (cardId === undefined) return false
    setPaletteFor(cardId)
    return true
  }, [canWrite])
  useCommandSource(
    'board',
    useMemo(() => ({ open: openFromRegistry }), [openFromRegistry]),
  )

  const applySavedView = useCallback((view: { filter: unknown }) => {
    setFilter((view.filter as IssueFilter) ?? {})
  }, [])

  const activeCard = activeId ? cardById.get(activeId) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      {/* ONE live region, mounted empty before it ever has anything to say — a `role="status"` node
          inserted with its message already inside it is not reliably spoken. dnd-kit owns the
          announcements for a live drag; this carries what happens AFTER a move lands, which only
          this component knows: the card is no longer in the filtered set. */}
      <p className="sr-only" role="status" aria-live="polite" data-testid="board-announcement">
        {announcement}
      </p>
      {/* The UNFILTERED rows, as the list hands them over: the composer mints the new issue's
          rank after the current maximum in Todo, and a filter hiding that maximum would mint a
          key that lands the new card in the middle of a column the reader cannot see. */}
      <CommandProvider teamId={teamId} issues={cards}>
        <BoardMasthead
          count={count}
          filter={filter}
          setFilter={setFilter}
          memberOptions={memberOptions}
          labelOptions={labelOptions}
          cycleOptions={cycleOptions}
          cycleFilter={cycleFilter}
          setCycleFilter={setCycleFilter}
          projectOptions={projectOptions}
          projectFilter={projectFilter}
          setProjectFilter={setProjectFilter}
          savedViews={savedViews}
          applySavedView={applySavedView}
          teamId={teamId}
          {...(lens === undefined ? {} : { lens })}
        />
      </CommandProvider>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          draggingRef.current = false
          setActiveId(null)
          setLanding(null)
        }}
      >
        <section
          ref={containerRef}
          data-testid="board"
          // Six equal fractions inside the page gutter: every column is readable at 1440 and the
          // promise holds at any width without a breakpoint, so this region never scrolls sideways.
          className="flex min-h-0 flex-1 gap-3 px-5 pt-3 pb-4"
          aria-label={`${teamName} board`}
        >
          {columns.map((column) => (
            <Column
              key={column.status}
              column={column}
              teamKey={teamKey}
              readOnly={!canWrite}
              reducedMotion={reducedMotion}
              activeId={activeId}
              landing={landing !== null && landing.status === column.status ? landing : null}
              pendingFocusId={pendingFocus?.id ?? null}
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
              {...deliveryRender(activeCard).props}
              inFlight
              footer={<MoveKeys />}
            />
          ) : null}
        </DragOverlay>
      </DndContext>

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
    </div>
  )
}

// Band 2, shared with the List lens down to the accessible name of every axis. What this lens adds
// is the trailing statement in the place the list states Group and Sort: a board's vertical order
// is the manual rank and its horizontal grouping is the status enum, so neither control has
// anything to act on. `New issue` reaches the ambient composer, which is why this sits inside
// `CommandProvider`.
function BoardMasthead({
  count,
  lens,
  ...rest
}: Omit<Parameters<typeof FilterBar>[0], 'grouping' | 'sort' | 'trailing' | 'onNewIssue'>) {
  const command = useCommand()
  return (
    <FilterBar
      count={count}
      {...(lens === undefined ? {} : { lens })}
      {...rest}
      grouping={DEFAULT_GROUPING}
      sort={DEFAULT_SORT}
      onNewIssue={() => command.openCreate()}
      trailing={
        <span>
          Order <span className="font-medium text-text-2">Manual</span>
        </span>
      }
    />
  )
}

function MoveKeys() {
  return (
    <>
      <span>space drop</span>
      <span aria-hidden="true">·</span>
      <span>esc cancel</span>
      <span aria-hidden="true">·</span>
      <span>← → column</span>
    </>
  )
}

function assigneeProps(card: BoardCardData): { assignee?: { name: string; src?: string } } {
  if (!card.assignee) return {}
  const name = card.assignee.name ?? card.assignee.email ?? card.assignee.id
  return card.assignee.image
    ? { assignee: { name, src: card.assignee.image } }
    : { assignee: { name } }
}

// The card's delivery register, derived from the same seam the list row derives it from — one
// `deliveryView` per card, never two. A silent phrase is OMITTED rather than passed as an element
// that renders nothing: an element would reserve the line the register has nothing to put in.
//
// `spoken` exists because the card is a `role="button"` carrying an EXPLICIT `aria-label`, and an
// explicit name suppresses everything inside it — the phrase and the track's own `role="img"`
// label included. The list row has no such label and is read whole; here the register has to be
// composed back into the name, from this same derivation and the same dictionaries.
function deliveryRender(card: BoardCardData): {
  props: { phrase?: ReactNode; realityTrack: ReactNode }
  spoken: string
} {
  const view = deliveryView(card, card.linked ?? {})
  const divergence = view.divergence ? DIVERGENCE_LABEL[view.divergence] : null
  const track = (
    <RealityTrack
      shape={buildRealityShape(view.strip, { divergence: view.divergence })}
      width={CARD_TRACK_WIDTH}
      label={realityTrackLabel(view.strip, divergence)}
    />
  )
  const spoken = [view.phrase.text, divergence].filter((part) => part !== null).join(', ')
  return {
    props:
      view.phrase.text === null
        ? { realityTrack: track }
        : { phrase: <RestPhraseText phrase={view.phrase} />, realityTrack: track },
    spoken,
  }
}

// The drawing of an absence, in the two places the board draws one: the slot an empty column rests
// at, and the slot a cross-column hover opens. Neither carries a word — the column's accessible
// name already states its count. The resting border is `--text-2`, not the mock's
// `--border-strong`: that token measures 1.3-1.4 against the column ground in every theme, and an
// outline that IS the drawing answers to 3:1.
function ReservedSlot({ height, drop = false }: { height: number; drop?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-slot={drop ? 'board-drop-slot' : 'board-rest-slot'}
      style={{ height: `${height}px` }}
      className={
        drop
          ? 'block flex-none rounded-card border-[1.5px] border-accent border-dashed bg-accent-soft'
          : 'block flex-none rounded-card border-[1.5px] border-text-2 border-dashed'
      }
    />
  )
}

interface ColumnProps {
  column: BoardColumn
  teamKey: string
  readOnly: boolean
  reducedMotion: boolean
  activeId: string | null
  landing: Landing | null
  pendingFocusId: string | null
  onFocusRestored: () => void
  onOpenCard: (id: string) => void
}

function Column({
  column,
  teamKey,
  readOnly,
  reducedMotion,
  activeId,
  landing,
  pendingFocusId,
  onFocusRestored,
  onOpenCard,
}: ColumnProps) {
  const { setNodeRef } = useDroppable({
    id: columnDroppableId(column.status),
    data: { status: column.status, type: 'column' },
  })
  const ids = column.cards.map((card) => card.id)
  const virtualize = shouldVirtualize(column.cards.length)
  const landingBefore =
    landing !== null && column.cards.some((card) => card.id === landing.beforeId)
      ? landing.beforeId
      : null
  // A virtualized column's append position sits a hundred cards below the rendered window, so a
  // slot drawn there would be a landing site the reader cannot see.
  const landingAtEnd = landing !== null && landingBefore === null && !virtualize

  return (
    <section
      // Focusable only programmatically, never in the tab order: it is where focus lands when a
      // move takes its card out of the filtered set and there is no card left to return to.
      tabIndex={-1}
      data-column-status={column.status}
      className="flex min-w-0 flex-1 flex-col rounded-card border border-border bg-bg-sidebar/50 outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
      aria-label={`${column.label}, ${column.cards.length} issues`}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <StatusGlyph status={STATUS_TO_KIND[column.status]} />
        <span className="text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
          {column.label}
        </span>
        <span className="ml-auto font-mono text-[11px] text-text-2">{column.cards.length}</span>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-3"
        >
          {virtualize ? (
            <VirtualColumnList
              cards={column.cards}
              teamKey={teamKey}
              readOnly={readOnly}
              reducedMotion={reducedMotion}
              activeId={activeId}
              pendingFocusId={pendingFocusId}
              onFocusRestored={onFocusRestored}
              onOpenCard={onOpenCard}
            />
          ) : (
            column.cards.map((card) => (
              <Fragment key={card.id}>
                {landingBefore === card.id ? <ReservedSlot height={DROP_SLOT_HEIGHT} drop /> : null}
                <SortableCard
                  card={card}
                  teamKey={teamKey}
                  readOnly={readOnly}
                  reducedMotion={reducedMotion}
                  dimmed={activeId === card.id}
                  onOpenCard={onOpenCard}
                />
              </Fragment>
            ))
          )}
          {landingAtEnd ? <ReservedSlot height={DROP_SLOT_HEIGHT} drop /> : null}
          {column.cards.length === 0 && landing === null ? (
            <ReservedSlot height={REST_SLOT_HEIGHT} />
          ) : null}
        </div>
      </SortableContext>
    </section>
  )
}

export interface SortableCardProps {
  card: BoardCardData
  teamKey: string
  readOnly: boolean
  reducedMotion: boolean
  dimmed: boolean
  onOpenCard: (id: string) => void
}

export function SortableCard({
  card,
  teamKey,
  readOnly,
  reducedMotion,
  dimmed,
  onOpenCard,
}: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { status: card.status, rank: card.rank, type: 'card' },
    disabled: readOnly,
    animateLayoutChanges: () => !reducedMotion,
  })

  // dnd-kit reports a read-only card as aria-disabled/draggable because dragging is off, but the
  // card is still an operable button (click and the `o` shortcut open the issue). Strip those
  // states for viewers so AT announces an actionable button rather than a dead/dimmed one — and
  // drop the pick-up instructions (aria-describedby), which cannot apply when dragging is off.
  const dragA11y = readOnly
    ? {
        ...attributes,
        'aria-disabled': undefined,
        'aria-roledescription': undefined,
        'aria-describedby': undefined,
      }
    : attributes

  // For viewers dnd-kit's listeners are absent, so the role=button card would be keyboard-dead.
  // Give it a real Enter/Space activation that opens the issue. Writers keep Enter/Space owned by
  // dnd-kit's KeyboardSensor for pick-up/drop, so this handler is attached only when read-only.
  const keyboardOpen = readOnly
    ? {
        onKeyDown: (event: ReactKeyboardEvent) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpenCard(card.id)
          }
        },
      }
    : undefined

  const delivery = deliveryRender(card)

  return (
    <BoardCard
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: reducedMotion ? undefined : transition,
      }}
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
      {...delivery.props}
      aria-label={`${issueKey(teamKey, card)}: ${card.title}, ${STATUS_LABEL[card.status]}, ${PRIORITY_LABEL[card.priority]}${delivery.spoken === '' ? '' : `, ${delivery.spoken}`}`}
      aria-keyshortcuts="o"
      onClick={() => onOpenCard(card.id)}
      {...dragA11y}
      {...listeners}
      {...keyboardOpen}
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
