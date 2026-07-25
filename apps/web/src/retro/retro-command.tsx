import { RETRO_PHASES, type RetroSeed, type RetroSeedRef } from '@yapm/schema'
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
  ChartNoAxesColumnIcon,
  CircleDotIcon,
  GroupIcon,
  ListChecksIcon,
  PlusIcon,
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
  nextPhase,
  PHASE_LABEL,
  previousPhase,
  type RetroCardData,
  type RetroColumnData,
  type RetroGroupData,
  type RetroRowData,
  retroCan,
  TIMER_PRESETS_S,
} from '@/retro/model'
import { seedRefForMetric } from '@/retro/retro-seed-panel'

export interface RetroFocus {
  id: string
  type: 'card' | 'group' | 'draft'
  columnId: string
}

interface RetroCommandApi {
  open: () => void
  openGroupWith: (cardId: string) => void
  openFacilitator: () => void
  openTimer: () => void
  setFocused: (focus: RetroFocus | null) => void
}

const RetroCommandContext = createContext<RetroCommandApi | null>(null)

export function useRetroCommand(): RetroCommandApi {
  const value = useContext(RetroCommandContext)
  if (!value) throw new Error('useRetroCommand must be used within RetroCommandProvider')
  return value
}

type Page = 'root' | 'group' | 'facilitator' | 'timer' | 'seed'

export interface RetroCommandProviderProps {
  retro: RetroRowData
  columns: readonly RetroColumnData[]
  cards: readonly RetroCardData[]
  groups: readonly RetroGroupData[]
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

              {focused && retroCan(retro.phase, 'vote', { canWrite }) ? (
                <CommandGroup heading="Vote">
                  <CommandItem
                    value="cast a dot vote"
                    onSelect={() => {
                      void api.castVote(focused.type === 'group' ? 'group' : 'card', focused.id)
                      close()
                    }}
                  >
                    <CircleDotIcon />
                    Vote for the focused item
                    <CommandShortcut>V</CommandShortcut>
                  </CommandItem>
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
                {facilitator && retroCan(retro.phase, 'configure', { canWrite }) ? (
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
