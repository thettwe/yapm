import {
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  RETRO_FORMATS,
  RETRO_PHASES,
  type RetroFormat,
  type RetroProposalCategory,
  type RetroProposalVerdict,
  type RetroReactionValue,
  type RetroSeed,
  type RetroSeedRef,
} from '@yapm/schema'
import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@yapm/ui/components/command-palette'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  ChartNoAxesColumnIcon,
  CircleDotIcon,
  CircleIcon,
  ColumnsIcon,
  GroupIcon,
  ListChecksIcon,
  PlusIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
  TimerIcon,
  TimerOffIcon,
  UserIcon,
  XIcon,
} from 'lucide-react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { RetroApi } from '@/retro/api'
import {
  appendRank,
  formatDuration,
  myVotesFor,
  nextPhase,
  PHASE_LABEL,
  previousPhase,
  RETRO_FORMAT_LABEL,
  type RetroActionData,
  type RetroCardData,
  type RetroColumnData,
  type RetroGroupData,
  type RetroRowData,
  type RetroVoteRowData,
  resolveVoteTarget,
  retroCan,
  TIMER_PRESETS_S,
} from '@/retro/model'
import { seedRefForMetric } from '@/retro/retro-seed-panel'

export interface RetroFocus {
  id: string
  type: 'card' | 'group' | 'draft'
  columnId: string
}

// The AI proposal the keyboard last held. A SNAPSHOT rather than an id, because the palette must not
// query the AI tables — a team that never opted in mounts no AI panel and therefore issues no AI
// query, and resolving an id here would put one in the always-mounted palette instead.
export interface RetroAiFocus {
  id: string
  body: string
  category: RetroProposalCategory
  verdict: RetroProposalVerdict | null
  // The caller's OWN reaction, and the only reaction value that exists anywhere on a client.
  mine: RetroReactionValue | null
}

interface RetroCommandApi {
  open: () => void
  openGroupWith: (cardId: string) => void
  openFacilitator: () => void
  openTimer: () => void
  setFocused: (focus: RetroFocus | null) => void
  setFocusedAction: (actionId: string | null) => void
  setFocusedAiProposal: (focus: RetroAiFocus | null) => void
}

const RetroCommandContext = createContext<RetroCommandApi | null>(null)

export function useRetroCommand(): RetroCommandApi {
  const value = useContext(RetroCommandContext)
  if (!value) throw new Error('useRetroCommand must be used within RetroCommandProvider')
  return value
}

type Page = 'root' | 'group' | 'facilitator' | 'timer' | 'seed' | 'format' | 'budget'

export interface RetroCommandProviderProps {
  retro: RetroRowData
  columns: readonly RetroColumnData[]
  cards: readonly RetroCardData[]
  groups: readonly RetroGroupData[]
  votes: readonly RetroVoteRowData[]
  actions: readonly RetroActionData[]
  members: readonly { id: string; name: string }[]
  canWrite: boolean
  facilitator: boolean
  api: RetroApi
  seed: RetroSeed | null
  onNewCard: () => void
  onNewAction: () => void
  onSeedCard: (ref: RetroSeedRef) => void
  children: ReactNode
}

// Every retro action also lives here, so nothing is pointer-only and nothing is shortcut-only.
// Affordances are gated by the SAME `isRetroWriteAllowed` predicate the server enforces, so the
// palette can never offer a write the authority will reject.
export function RetroCommandProvider({
  retro,
  columns,
  cards,
  groups,
  votes,
  actions,
  members,
  canWrite,
  facilitator,
  api,
  seed,
  onNewCard,
  onNewAction,
  onSeedCard,
  children,
}: RetroCommandProviderProps) {
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<Page>('root')
  const [search, setSearch] = useState('')
  const [groupCardId, setGroupCardId] = useState<string | null>(null)
  const focusRef = useRef<RetroFocus | null>(null)
  const focusedActionRef = useRef<string | null>(null)
  const focusedAiRef = useRef<RetroAiFocus | null>(null)

  const start = useCallback((next: Page) => {
    setPage(next)
    setSearch('')
    setOpen(true)
  }, [])

  const api2 = useMemo<RetroCommandApi>(
    () => ({
      open: () => start('root'),
      openGroupWith: (cardId) => {
        setGroupCardId(cardId)
        start('group')
      },
      openFacilitator: () => start('facilitator'),
      openTimer: () => start('timer'),
      setFocused: (focus) => {
        focusRef.current = focus
      },
      setFocusedAction: (actionId) => {
        focusedActionRef.current = actionId
      },
      setFocusedAiProposal: (focus) => {
        focusedAiRef.current = focus
      },
    }),
    [start],
  )

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        start('root')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start])

  const close = useCallback(() => setOpen(false), [])

  const forward = nextPhase(retro.phase)
  const back = previousPhase(retro.phase)
  const canFacilitate = canWrite && (facilitator || retro.facilitatorId === null)
  const focused = focusRef.current

  const groupCard = groupCardId === null ? null : (cards.find((c) => c.id === groupCardId) ?? null)
  const seedMetrics = (seed?.sections ?? []).flatMap((section) => section.metrics)

  // A dot follows the SAME target rule the mutator enforces, resolved from whatever holds focus —
  // a clustered card votes through its cluster, so the palette can never send a guaranteed refusal.
  const target =
    focused === null
      ? null
      : resolveVoteTarget(cards, focused.id, focused.type === 'group' ? 'group' : 'card')
  const myDots = target === null ? [] : myVotesFor(votes, target.targetId)
  const focusedAi = focusedAiRef.current
  const focusedAction =
    focusedActionRef.current === null
      ? null
      : (actions.find((action) => action.id === focusedActionRef.current) ?? null)
  // Anonymity, the format and the budget are all fixed before there is anything to attribute or
  // to re-column: `configure` is brainstorm-only AND the retro must still have no cards, which a
  // facilitator stepping back into `brainstorm` would otherwise defeat.
  const configurable =
    facilitator && retroCan(retro.phase, 'configure', { canWrite }) && cards.length === 0

  return (
    <RetroCommandContext.Provider value={api2}>
      {children}
      <CommandDialog open={open} onOpenChange={setOpen} label="Retro command palette">
        <CommandInput
          placeholder={
            page === 'group'
              ? 'Group this card with…'
              : page === 'seed'
                ? 'Add a card from which figure?'
                : page === 'format'
                  ? 'Which format?'
                  : page === 'budget'
                    ? 'How many dots each?'
                    : 'Type a retro command or search…'
          }
          value={search}
          onValueChange={setSearch}
        />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>

          {page === 'root' ? (
            <>
              <CommandGroup heading="Capture">
                {retroCan(retro.phase, 'draft', { canWrite }) ? (
                  <CommandItem
                    value="new card capture"
                    onSelect={() => {
                      onNewCard()
                      close()
                    }}
                  >
                    <PlusIcon />
                    New card
                    <CommandShortcut>C</CommandShortcut>
                  </CommandItem>
                ) : null}
                {seedMetrics.length > 0 && retroCan(retro.phase, 'draft', { canWrite }) ? (
                  <CommandItem
                    value="add a card from a cycle data widget figure"
                    onSelect={() => start('seed')}
                  >
                    <ChartNoAxesColumnIcon />
                    Add a card from a figure…
                  </CommandItem>
                ) : null}
                {retroCan(retro.phase, 'action', { canWrite }) ? (
                  <CommandItem
                    value="new action item"
                    onSelect={() => {
                      onNewAction()
                      close()
                    }}
                  >
                    <ListChecksIcon />
                    New action
                    <CommandShortcut>A</CommandShortcut>
                  </CommandItem>
                ) : null}
              </CommandGroup>

              {focused &&
              focused.type === 'card' &&
              retroCan(retro.phase, 'group', { canWrite }) ? (
                <CommandGroup heading="Card">
                  <CommandItem
                    value="group with another card"
                    onSelect={() => {
                      setGroupCardId(focused.id)
                      start('group')
                    }}
                  >
                    <GroupIcon />
                    Group with…
                    <CommandShortcut>G</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
              ) : null}

              {target && retroCan(retro.phase, 'vote', { canWrite }) ? (
                <CommandGroup heading="Vote">
                  <CommandItem
                    value="cast a dot vote"
                    onSelect={() => {
                      void api.castVote(target.targetType, target.targetId)
                      close()
                    }}
                  >
                    <CircleDotIcon />
                    Vote for the focused item
                    <CommandShortcut>V</CommandShortcut>
                  </CommandItem>
                  {myDots.length > 0 ? (
                    <CommandItem
                      value="retract a dot take a dot back"
                      onSelect={() => {
                        const last = myDots[myDots.length - 1]
                        if (last) void api.retractVote(last.id)
                        close()
                      }}
                    >
                      <CircleIcon />
                      Take a dot back
                      <CommandShortcut>⇧V</CommandShortcut>
                    </CommandItem>
                  ) : null}
                </CommandGroup>
              ) : null}

              {/* The keyboard half of the ratification surface. Gated by the SAME `react` predicate
                  the mutator enforces, so the palette can never offer a write the server refuses —
                  and absent entirely for a team with no AI panel, because nothing ever sets the
                  focus. */}
              {focusedAi && retroCan(retro.phase, 'react', { canWrite }) ? (
                <CommandGroup heading="AI proposal">
                  <CommandItem
                    value="agree with this ai proposal"
                    onSelect={() => {
                      void api.setAiReaction(focusedAi.id, 'agree')
                      close()
                    }}
                  >
                    <ThumbsUpIcon />
                    Agree with this AI proposal
                  </CommandItem>
                  <CommandItem
                    value="disagree with this ai proposal"
                    onSelect={() => {
                      void api.setAiReaction(focusedAi.id, 'disagree')
                      close()
                    }}
                  >
                    <ThumbsDownIcon />
                    Disagree with this AI proposal
                  </CommandItem>
                  {/* UNCONDITIONAL, and deliberately not gated on `focusedAi.mine`. The snapshot is
                      refreshed by a DOM focus event, and reacting with the inline toggle moves no
                      focus — so a `mine`-gated entry would be missing for exactly the member who
                      just reacted. `clearRetroAiReaction` reads then returns on a missing row, so a
                      stale snapshot costs a no-op rather than an error. */}
                  <CommandItem
                    value="clear my reaction to this ai proposal"
                    onSelect={() => {
                      void api.clearAiReaction(focusedAi.id)
                      close()
                    }}
                  >
                    <XIcon />
                    Clear my reaction
                  </CommandItem>
                </CommandGroup>
              ) : null}

              {/* An agreed improvement, and NO OWNER: `createAction` is called with provenance only.
                  The absence of an assignee here is the same hard line the mutator holds. */}
              {focusedAi &&
              focusedAi.category === 'improvement' &&
              focusedAi.verdict === 'agreed' &&
              retroCan(retro.phase, 'action', { canWrite }) ? (
                <CommandGroup heading="AI proposal">
                  <CommandItem
                    value="add this improvement as an action item"
                    onSelect={() => {
                      void api.createAction(focusedAi.body, { aiProposalId: focusedAi.id })
                      close()
                    }}
                  >
                    <ListChecksIcon />
                    Add this improvement as an action
                  </CommandItem>
                </CommandGroup>
              ) : null}

              {focusedAction && retroCan(retro.phase, 'convert', { canWrite }) ? (
                <CommandGroup heading="Action">
                  {focusedAction.issueId === null ? (
                    <CommandItem
                      value="convert this action to an issue"
                      onSelect={() => {
                        void api.convertAction(focusedAction.id)
                        close()
                      }}
                    >
                      <ArrowUpRightIcon />
                      Convert this action to an issue
                      <CommandShortcut>⌘↵</CommandShortcut>
                    </CommandItem>
                  ) : (
                    <CommandItem value="this action is already an issue" disabled>
                      <ArrowUpRightIcon />
                      Already tracked as an issue
                    </CommandItem>
                  )}
                </CommandGroup>
              ) : null}

              <CommandGroup heading="Facilitate">
                {canFacilitate && forward ? (
                  <CommandItem
                    value={`advance phase to ${PHASE_LABEL[forward]}`}
                    onSelect={() => {
                      void api.setPhase(forward)
                      close()
                    }}
                  >
                    <ArrowRightIcon />
                    Advance to {PHASE_LABEL[forward]}
                    <CommandShortcut>]</CommandShortcut>
                  </CommandItem>
                ) : null}
                {canFacilitate && back ? (
                  <CommandItem
                    value={`step back to ${PHASE_LABEL[back]}`}
                    onSelect={() => {
                      void api.setPhase(back)
                      close()
                    }}
                  >
                    <ArrowLeftIcon />
                    Step back to {PHASE_LABEL[back]}
                    <CommandShortcut>[</CommandShortcut>
                  </CommandItem>
                ) : null}
                {canWrite && retro.facilitatorId === null ? (
                  <CommandItem
                    value="claim facilitator run this retro"
                    onSelect={() => {
                      void api.claimFacilitator()
                      close()
                    }}
                  >
                    <UserIcon />
                    Run this retro
                  </CommandItem>
                ) : null}
                {facilitator ? (
                  <CommandItem value="hand off facilitation" onSelect={() => start('facilitator')}>
                    <UserIcon />
                    Hand off facilitation…
                  </CommandItem>
                ) : null}
                {configurable ? (
                  <>
                    <CommandItem
                      value={
                        retro.isAnonymous
                          ? 'attribute cards to their authors anonymity off'
                          : 'make this retro anonymous hide card authors'
                      }
                      onSelect={() => {
                        void api.setAnonymous(!retro.isAnonymous)
                        close()
                      }}
                    >
                      <UserIcon />
                      {retro.isAnonymous
                        ? 'Attribute cards to their authors'
                        : 'Make this retro anonymous'}
                    </CommandItem>
                    <CommandItem
                      value="change the retro format columns"
                      onSelect={() => start('format')}
                    >
                      <ColumnsIcon />
                      Change the format…
                    </CommandItem>
                    <CommandItem
                      value="set the dot budget votes per participant"
                      onSelect={() => start('budget')}
                    >
                      <CircleDotIcon />
                      Dots per person…
                    </CommandItem>
                  </>
                ) : null}
                {facilitator && retroCan(retro.phase, 'timer', { canWrite }) ? (
                  <>
                    <CommandItem value="start a timer" onSelect={() => start('timer')}>
                      <TimerIcon />
                      Start a timer…
                      <CommandShortcut>T</CommandShortcut>
                    </CommandItem>
                    {retro.timerEndsAt !== null ? (
                      <CommandItem
                        value="stop the timer"
                        onSelect={() => {
                          void api.stopTimer()
                          close()
                        }}
                      >
                        <TimerOffIcon />
                        Stop the timer
                      </CommandItem>
                    ) : null}
                  </>
                ) : null}
              </CommandGroup>

              <CommandGroup heading="Phases">
                {RETRO_PHASES.map((phase) => (
                  <CommandItem key={phase} value={`phase ${PHASE_LABEL[phase]}`} disabled>
                    {retro.phase === phase ? <CircleDotIcon /> : <XIcon className="opacity-0" />}
                    {PHASE_LABEL[phase]}
                    {retro.phase === phase ? <CommandShortcut>now</CommandShortcut> : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}

          {page === 'group' && groupCard ? (
            <GroupWithPage
              card={groupCard}
              columns={columns}
              cards={cards}
              groups={groups}
              onGroupWithCard={(other) => {
                void api.groupCards(other.columnId, [other.id, groupCard.id], other.rank)
                close()
              }}
              onJoinGroup={(group) => {
                void api.moveCard(groupCard.id, {
                  columnId: group.columnId,
                  groupId: group.id,
                  rank: appendRank(cards.filter((c) => c.groupId === group.id)),
                })
                close()
              }}
              onUngroup={() => {
                void api.moveCard(groupCard.id, {
                  groupId: null,
                  rank: appendRank(cards.filter((c) => c.columnId === groupCard.columnId)),
                })
                close()
              }}
            />
          ) : null}

          {page === 'facilitator' ? (
            <CommandGroup heading="Hand off facilitation">
              {members.map((member) => (
                <CommandItem
                  key={member.id}
                  value={`hand off to ${member.name}`}
                  onSelect={() => {
                    void api.setFacilitator(member.id)
                    close()
                  }}
                >
                  <UserIcon />
                  {member.name}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === 'seed' ? (
            <CommandGroup heading="Add a card from a figure">
              {seedMetrics.map((metric) => (
                <CommandItem
                  key={metric.key}
                  value={`add a card from ${metric.label} ${metric.caption}`}
                  onSelect={() => {
                    onSeedCard(seedRefForMetric(metric))
                    close()
                  }}
                >
                  <ChartNoAxesColumnIcon />
                  <span className="truncate">{metric.label}</span>
                  <CommandShortcut>{metric.value}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === 'format' ? (
            <CommandGroup heading="Change the format">
              {RETRO_FORMATS.map((format: RetroFormat) => (
                <CommandItem
                  key={format}
                  value={`use the ${RETRO_FORMAT_LABEL[format]} format`}
                  onSelect={() => {
                    if (format !== retro.format) void api.setFormat(format)
                    close()
                  }}
                >
                  <ColumnsIcon />
                  {RETRO_FORMAT_LABEL[format]}
                  {format === retro.format ? <CommandShortcut>now</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === 'budget' ? (
            <CommandGroup heading="Dots per person">
              {Array.from(
                { length: MAX_VOTES_PER_PARTICIPANT - MIN_VOTES_PER_PARTICIPANT + 1 },
                (_, index) => MIN_VOTES_PER_PARTICIPANT + index,
              ).map((dots) => (
                <CommandItem
                  key={dots}
                  value={`${dots} dots per person`}
                  onSelect={() => {
                    if (dots !== retro.votesPerParticipant) void api.setVoteBudget(dots)
                    close()
                  }}
                >
                  <CircleDotIcon />
                  {dots === 1 ? '1 dot' : `${dots} dots`}
                  {dots === retro.votesPerParticipant ? (
                    <CommandShortcut>now</CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {page === 'timer' ? (
            <CommandGroup heading="Start a timer">
              {TIMER_PRESETS_S.map((seconds) => (
                <CommandItem
                  key={seconds}
                  value={`start timer ${formatDuration(seconds)}`}
                  onSelect={() => {
                    void api.startTimer(seconds)
                    close()
                  }}
                >
                  <TimerIcon />
                  {formatDuration(seconds)}
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
        <CommandFooter>
          <span>↑↓ to navigate</span>
          <span>↵ to select</span>
          <span>esc to close</span>
          <span className="ml-auto font-bold text-text-3">yapm</span>
        </CommandFooter>
      </CommandDialog>
    </RetroCommandContext.Provider>
  )
}

function GroupWithPage({
  card,
  columns,
  cards,
  groups,
  onGroupWithCard,
  onJoinGroup,
  onUngroup,
}: {
  card: RetroCardData
  columns: readonly RetroColumnData[]
  cards: readonly RetroCardData[]
  groups: readonly RetroGroupData[]
  onGroupWithCard: (other: RetroCardData) => void
  onJoinGroup: (group: RetroGroupData) => void
  onUngroup: () => void
}) {
  const columnTitle = columns.find((column) => column.id === card.columnId)?.title ?? 'this column'
  const siblings = cards.filter(
    (other) => other.columnId === card.columnId && other.id !== card.id && other.groupId === null,
  )
  const columnGroups = groups.filter(
    (group) => group.columnId === card.columnId && group.id !== card.groupId,
  )

  return (
    <>
      {card.groupId !== null ? (
        <CommandGroup heading="Leave">
          <CommandItem value="ungroup this card" onSelect={onUngroup}>
            <XIcon />
            Ungroup this card
          </CommandItem>
        </CommandGroup>
      ) : null}
      {columnGroups.length > 0 ? (
        <CommandGroup heading="Join a cluster">
          {columnGroups.map((group) => (
            <CommandItem
              key={group.id}
              value={`join cluster ${group.label ?? 'unlabelled'}`}
              onSelect={() => onJoinGroup(group)}
            >
              <GroupIcon />
              {group.label ?? 'Unlabelled cluster'}
            </CommandItem>
          ))}
        </CommandGroup>
      ) : null}
      <CommandGroup heading={`Group with a card in ${columnTitle}`}>
        {siblings.map((other) => (
          <CommandItem
            key={other.id}
            value={`group with ${other.body}`}
            onSelect={() => onGroupWithCard(other)}
          >
            <GroupIcon />
            <span className="truncate">{other.body}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  )
}
