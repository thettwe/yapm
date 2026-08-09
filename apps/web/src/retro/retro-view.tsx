import { useQuery } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import {
  isRetroWriteAllowed,
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  queries,
  RETRO_FORMATS,
  RETRO_PHASES,
  RETRO_PRESENCE_HEARTBEAT_MS,
  type RetroFormat,
  type RetroPhase,
  type RetroSeed,
  type RetroSeedRef,
} from '@yapm/schema'
import { Avatar, AvatarFallback } from '@yapm/ui/components/avatar'
import { Button } from '@yapm/ui/components/button'
import { AnonymityMark } from '@yapm/ui/components/drawn'
import { Select } from '@yapm/ui/components/select'
import { cn } from '@yapm/ui/lib/utils'
import { TimerIcon, TimerOffIcon, UserIcon } from 'lucide-react'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMembership } from '@/auth/use-membership'
import { Masthead } from '@/frame/masthead'
import { ownsKeyboard } from '@/lib/keyboard'
import { useRetroApi } from '@/retro/api'
import {
  countdownSeconds,
  formatCountdown,
  isFacilitator,
  livePresence,
  nextPhase,
  PHASE_HINT,
  PHASE_LABEL,
  previousPhase,
  RETRO_FORMAT_LABEL,
  type RetroActionData,
  type RetroCardData,
  type RetroColumnData,
  type RetroDraftData,
  type RetroGroupData,
  type RetroPresenceData,
  type RetroRowData,
  type RetroTallyData,
  type RetroVoteRowData,
  remainingVotes,
  retroCan,
} from '@/retro/model'
import { RetroActions } from '@/retro/retro-actions'
import { RetroAiPanel } from '@/retro/retro-ai-panel'
import { RetroBoard } from '@/retro/retro-board'
import { RetroCommandProvider, useRetroCommand } from '@/retro/retro-command'
import { RetroSeedPanel, seedWidgetSelector } from '@/retro/retro-seed-panel'
import { buildRetroSeedFor, type SeedCycleRow, type SeedIssueRow } from '@/retro/seed-model'

interface RelatedUser {
  id: string
  name?: string | null
  email?: string | null
  image?: string | null
}

export function RetroView({ teamId, retroId }: { teamId: string; retroId: string }) {
  const [detail, detailResult] = useQuery(queries.retros.detail({ id: retroId }))
  const [drafts] = useQuery(queries.retroDrafts.mine({ retroId }))
  const [votes] = useQuery(queries.retroVotes.mine({ retroId }))
  const [teams] = useQuery(queries.teams.all())
  const [users] = useQuery(queries.users.all())
  const [cycles] = useQuery(queries.cycles.byTeam({ teamId }))
  // The seed's substrate: the team's issues with their linked delivery subtree. Already the
  // issue list's query, so the panel costs no new sync surface.
  const [issues] = useQuery(queries.issues.byTeam({ teamId }))

  const team = teams.find((candidate) => candidate.id === teamId)

  const retro = useMemo<RetroRowData | null>(() => {
    if (!detail) return null
    return {
      id: detail.id,
      teamId: detail.teamId,
      cycleId: detail.cycleId ?? null,
      nextCycleId: detail.nextCycleId ?? null,
      title: detail.title,
      format: detail.format,
      phase: detail.phase,
      facilitatorId: detail.facilitatorId ?? null,
      isAnonymous: detail.isAnonymous,
      votesPerParticipant: detail.votesPerParticipant,
      timerEndsAt: detail.timerEndsAt ?? null,
      timerDurationS: detail.timerDurationS ?? null,
      closedAt: detail.closedAt ?? null,
      createdAt: detail.createdAt,
    }
  }, [detail])

  const columns = useMemo<RetroColumnData[]>(
    () =>
      ((detail?.columns ?? []) as readonly RetroColumnData[]).map((column) => ({
        id: column.id,
        key: column.key,
        title: column.title,
        accentToken: column.accentToken,
        rank: column.rank,
      })),
    [detail],
  )

  const cards = useMemo<RetroCardData[]>(
    () =>
      (
        (detail?.cards ?? []) as readonly (RetroCardData & {
          groupId?: string | null
          authorDisplayId?: string | null
          seedRef?: RetroSeedRef | null
        })[]
      ).map((card) => ({
        id: card.id,
        columnId: card.columnId,
        groupId: card.groupId ?? null,
        body: card.body,
        rank: card.rank,
        isAnonymous: card.isAnonymous,
        authorDisplayId: card.authorDisplayId ?? null,
        seedRef: card.seedRef ?? null,
        createdAt: card.createdAt,
      })),
    [detail],
  )

  const groups = useMemo<RetroGroupData[]>(
    () =>
      ((detail?.groups ?? []) as readonly (RetroGroupData & { label?: string | null })[]).map(
        (group) => ({
          id: group.id,
          columnId: group.columnId,
          label: group.label ?? null,
          rank: group.rank,
        }),
      ),
    [detail],
  )

  const tallies = useMemo<RetroTallyData[]>(
    () =>
      ((detail?.voteTallies ?? []) as readonly RetroTallyData[]).map((tally) => ({
        targetId: tally.targetId,
        count: tally.count,
      })),
    [detail],
  )

  const actions = useMemo<RetroActionData[]>(
    () =>
      (
        (detail?.actions ?? []) as readonly (RetroActionData & {
          issue?: { id: string; number?: number | null; title: string; status: string } | null
        })[]
      ).map((action) => ({
        id: action.id,
        body: action.body,
        assigneeId: action.assigneeId ?? null,
        targetCycleId: action.targetCycleId ?? null,
        issueId: action.issueId ?? null,
        groupId: action.groupId ?? null,
        cardId: action.cardId ?? null,
        createdAt: action.createdAt,
        issue: action.issue
          ? {
              id: action.issue.id,
              number: action.issue.number ?? null,
              title: action.issue.title,
              status: action.issue.status,
            }
          : null,
      })),
    [detail],
  )

  const presence = useMemo<RetroPresenceData[]>(
    () =>
      (
        (detail?.presence ?? []) as readonly {
          userId: string
          focusTarget?: string | null
          lastSeenAt: number
          user?: RelatedUser | null
        }[]
      ).map((row) => ({
        userId: row.userId,
        focusTarget: row.focusTarget ?? null,
        lastSeenAt: row.lastSeenAt,
        name: row.user?.name ?? row.user?.email ?? row.userId,
      })),
    [detail],
  )

  const myDrafts = useMemo<RetroDraftData[]>(
    () =>
      (
        drafts as readonly (RetroDraftData & {
          publishedAt?: number | null
          seedRef?: RetroSeedRef | null
        })[]
      )
        .filter((draft) => (draft.publishedAt ?? null) === null)
        .map((draft) => ({
          id: draft.id,
          columnId: draft.columnId,
          body: draft.body,
          rank: draft.rank,
          seedRef: draft.seedRef ?? null,
          publishedAt: draft.publishedAt ?? null,
        })),
    [drafts],
  )

  // The ids of the cards this caller wrote. A published card reuses its draft's id, and the draft
  // query is self-filtered — so this set is exactly "my cards", built WITHOUT ever learning anyone
  // else's authorship. It is what lets an author retract their own card, matching the mutator.
  const ownCardIds = useMemo<ReadonlySet<string>>(
    () => new Set((drafts as readonly { id: string }[]).map((draft) => draft.id)),
    [drafts],
  )

  const myVotes = useMemo<RetroVoteRowData[]>(
    () =>
      (votes as readonly RetroVoteRowData[]).map((vote) => ({
        id: vote.id,
        targetType: vote.targetType,
        targetId: vote.targetId,
        createdAt: vote.createdAt,
      })),
    [votes],
  )

  // The panel is a live client-side computation over rows the caller already has: sub-100ms, correct
  // offline, and identical on every client.
  const seed = useMemo<RetroSeed | null>(
    () =>
      buildRetroSeedFor(
        retro?.cycleId ?? null,
        cycles as readonly SeedCycleRow[],
        issues as readonly SeedIssueRow[],
      ),
    [cycles, issues, retro],
  )

  if (!retro || !team) {
    return (
      <p className="p-6 text-sm text-text-3" role="status">
        {detailResult.type === 'complete' ? 'No such retro.' : 'Loading…'}
      </p>
    )
  }

  return (
    <RetroShell
      teamId={teamId}
      teamKey={team.key}
      aiRetroDraftSince={team.aiRetroDraftSince ?? null}
      retro={retro}
      columns={columns}
      cards={cards}
      groups={groups}
      tallies={tallies}
      actions={actions}
      presence={presence}
      drafts={myDrafts}
      votes={myVotes}
      ownCardIds={ownCardIds}
      users={users as readonly RelatedUser[]}
      teamMemberIds={((team.members ?? []) as readonly { userId: string }[]).map((m) => m.userId)}
      cycles={(cycles as readonly { id: string; name: string }[]).map((cycle) => ({
        id: cycle.id,
        name: cycle.name,
      }))}
      seed={seed}
    />
  )
}

interface RetroShellProps {
  teamId: string
  teamKey: string
  // Read off the synced team row, threaded down rather than re-queried, so the AI section is not
  // mounted at all for a team that never opted in.
  aiRetroDraftSince: number | null
  retro: RetroRowData
  columns: readonly RetroColumnData[]
  cards: readonly RetroCardData[]
  groups: readonly RetroGroupData[]
  tallies: readonly RetroTallyData[]
  actions: readonly RetroActionData[]
  presence: readonly RetroPresenceData[]
  drafts: readonly RetroDraftData[]
  votes: readonly RetroVoteRowData[]
  ownCardIds: ReadonlySet<string>
  users: readonly RelatedUser[]
  teamMemberIds: readonly string[]
  cycles: readonly { id: string; name: string }[]
  seed: RetroSeed | null
}

function RetroShell(props: RetroShellProps) {
  const { retro, users, teamMemberIds } = props
  const { userId, canWrite, canManage } = useMembership()
  const { api, error, clearError } = useRetroApi(retro.id)
  const facilitator = isFacilitator(retro, userId, canManage)

  const members = useMemo(
    () =>
      teamMemberIds.map((id) => {
        const user = users.find((candidate) => candidate.id === id)
        return { id, name: user?.name ?? user?.email ?? id }
      }),
    [teamMemberIds, users],
  )

  const [composerColumnId, setComposerColumnId] = useState<string | null>(null)
  const [composerSeed, setComposerSeed] = useState<RetroSeedRef | null>(null)
  const [actionComposer, setActionComposer] = useState(false)
  // Expanded while a card can still be seeded from it, a door afterwards. The "add a card from this
  // widget" path is brainstorm-only, so from `group` the panel is a read-only wall of ten figures
  // over a room whose live business is elsewhere.
  //
  // DERIVED AT EVERY RENDER, not once at mount: the facilitator's advance reaches every client in
  // the room, and a mount-time initial value would leave everyone already here with the full panel
  // for the rest of the retro. The reader's own toggle wins WITHIN a phase and is dropped the
  // moment the phase changes. The role is deliberately not part of this — a viewer reads the same
  // room as everyone else.
  const phaseCanSeed = isRetroWriteAllowed(retro.phase, 'draft')
  const [seedOverride, setSeedOverride] = useState<boolean | null>(null)
  const seedPhase = useRef(retro.phase)
  if (seedPhase.current !== retro.phase) {
    seedPhase.current = retro.phase
    setSeedOverride(null)
  }
  const seedOpen = seedOverride ?? phaseCanSeed
  const focusColumnRef = useRef<string | null>(null)

  const openComposerIn = useCallback(
    (seedRef: RetroSeedRef | null) => {
      setComposerSeed(seedRef)
      setComposerColumnId(focusColumnRef.current ?? props.columns[0]?.id ?? null)
    },
    [props.columns],
  )

  const openCardComposer = useCallback(() => openComposerIn(null), [openComposerIn])

  // "Add a card from this widget": the composer opens in the column focus was last in, carrying the
  // widget's evidence ref, so the captured card links back to the number that prompted it.
  const seedCardFrom = useCallback(
    (seedRef: RetroSeedRef) => openComposerIn(seedRef),
    [openComposerIn],
  )

  const onComposerColumn = useCallback((columnId: string | null) => {
    setComposerColumnId(columnId)
    if (columnId === null) setComposerSeed(null)
  }, [])

  // The other half of the join: a card's chip reveals the panel and focuses the tile it came from.
  const openEvidence = useCallback((seedRef: RetroSeedRef) => {
    setSeedOverride(true)
    requestAnimationFrame(() => {
      const tile = document.querySelector<HTMLElement>(seedWidgetSelector(seedRef.id))
      tile?.scrollIntoView({ block: 'nearest' })
      tile?.focus()
    })
  }, [])

  return (
    <RetroCommandProvider
      retro={retro}
      columns={props.columns}
      cards={props.cards}
      groups={props.groups}
      votes={props.votes}
      actions={props.actions}
      members={members}
      canWrite={canWrite}
      facilitator={facilitator}
      api={api}
      seed={props.seed}
      onNewCard={openCardComposer}
      onNewAction={() => setActionComposer(true)}
      onSeedCard={seedCardFrom}
    >
      <RetroSurface
        {...props}
        api={api}
        error={error}
        clearError={clearError}
        canWrite={canWrite}
        facilitator={facilitator}
        members={members}
        composerColumnId={composerColumnId}
        composerSeed={composerSeed}
        onComposerColumn={onComposerColumn}
        onOpenCardComposer={openCardComposer}
        focusColumnRef={focusColumnRef}
        actionComposerOpen={actionComposer}
        onOpenActionComposer={() => setActionComposer(true)}
        onCloseActionComposer={() => setActionComposer(false)}
        seedOpen={seedOpen}
        onSeedOpenChange={setSeedOverride}
        onSeedCard={seedCardFrom}
        onOpenEvidence={openEvidence}
      />
    </RetroCommandProvider>
  )
}

interface RetroSurfaceProps extends RetroShellProps {
  api: ReturnType<typeof useRetroApi>['api']
  error: string | undefined
  clearError: () => void
  canWrite: boolean
  facilitator: boolean
  members: readonly { id: string; name: string }[]
  composerColumnId: string | null
  composerSeed: RetroSeedRef | null
  onComposerColumn: (columnId: string | null) => void
  onOpenCardComposer: () => void
  focusColumnRef: RefObject<string | null>
  actionComposerOpen: boolean
  onOpenActionComposer: () => void
  onCloseActionComposer: () => void
  seedOpen: boolean
  onSeedOpenChange: (open: boolean) => void
  onSeedCard: (ref: RetroSeedRef) => void
  onOpenEvidence: (ref: RetroSeedRef) => void
}

function RetroSurface({
  teamId,
  teamKey,
  aiRetroDraftSince,
  retro,
  columns,
  cards,
  groups,
  tallies,
  actions,
  presence,
  drafts,
  votes,
  ownCardIds,
  users,
  cycles,
  api,
  error,
  clearError,
  canWrite,
  facilitator,
  members,
  seed,
  composerColumnId,
  composerSeed,
  onComposerColumn,
  onOpenCardComposer,
  focusColumnRef,
  actionComposerOpen,
  onOpenActionComposer,
  onCloseActionComposer,
  seedOpen,
  onSeedOpenChange,
  onSeedCard,
  onOpenEvidence,
}: RetroSurfaceProps) {
  const navigate = useNavigate()
  const command = useRetroCommand()
  const [now, setNow] = useState(() => Date.now())

  const authorOf = useCallback(
    (id: string) => {
      const user = users.find((candidate) => candidate.id === id)
      return { name: user?.name ?? user?.email ?? id, image: user?.image ?? null }
    },
    [users],
  )

  // The timer never ticks over the wire: `timer_ends_at` is durable state and every client
  // renders `endsAt - now` from its own clock. The interval is local and stops with the timer.
  useEffect(() => {
    if (retro.timerEndsAt === null) return
    const handle = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(handle)
  }, [retro.timerEndsAt])

  // Presence is a coarse throttled heartbeat row, self-written from the verified ctx and pruned
  // by the existing maintenance pass — no sidecar service, no new job type.
  useEffect(() => {
    if (!canWrite) return
    void api.heartbeat(focusColumnRef.current)
    const handle = window.setInterval(() => {
      void api.heartbeat(focusColumnRef.current)
    }, RETRO_PRESENCE_HEARTBEAT_MS)
    return () => window.clearInterval(handle)
  }, [api, canWrite])

  const onFocusColumn = useCallback(
    (columnId: string | null) => {
      if (columnId === null || focusColumnRef.current === columnId) return
      focusColumnRef.current = columnId
      if (canWrite) void api.heartbeat(columnId)
    },
    [api, canWrite, focusColumnRef],
  )

  const forward = nextPhase(retro.phase)
  const back = previousPhase(retro.phase)
  const canFacilitate = facilitator && canWrite
  const canAct = retroCan(retro.phase, 'action', { canWrite })
  // Format, anonymity and the dot budget are all settable only while the retro still has nothing
  // to re-column or attribute. `configure` is brainstorm-only, but stepping BACK into brainstorm
  // after publish would otherwise re-open all three, so the card count is part of the gate — the
  // same pair of conditions `retro.configure` enforces authoritatively.
  const configurable =
    canFacilitate &&
    retroCan(retro.phase, 'configure', { canWrite, facilitator: true }) &&
    cards.length === 0

  // Retro-wide shortcuts. Card/vote/group keys belong to the focused card and live on the board;
  // these are the ones that act on the retro itself, so they are read at the window and ignored
  // while a field or dialog owns the keyboard.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (ownsKeyboard(event.target)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === ']' && canFacilitate && forward) {
        event.preventDefault()
        void api.setPhase(forward)
        return
      }
      if (event.key === '[' && canFacilitate && back) {
        event.preventDefault()
        void api.setPhase(back)
        return
      }
      if (event.key === 't' && canFacilitate && retroCan(retro.phase, 'timer', { canWrite })) {
        event.preventDefault()
        if (retro.timerEndsAt !== null) void api.stopTimer()
        else command.openTimer()
        return
      }
      if (event.key === 'a' && canAct) {
        event.preventDefault()
        onOpenActionComposer()
        return
      }
      // `c` opens the composer in the column focus was last in, so capture works from the moment
      // the retro loads — before anything on the board has been tabbed to.
      if (event.key === 'c' && retroCan(retro.phase, 'draft', { canWrite })) {
        event.preventDefault()
        onOpenCardComposer()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    api,
    back,
    canAct,
    canFacilitate,
    canWrite,
    command,
    forward,
    onOpenActionComposer,
    onOpenCardComposer,
    retro.phase,
    retro.timerEndsAt,
  ])

  // One handler for both the action list's issue link and the AI draft's evidence chips.
  const openIssue = useCallback(
    (issueId: string) => {
      void navigate({
        to: '/teams/$teamId/issues',
        params: { teamId },
        search: { open: issueId },
      })
    },
    [navigate, teamId],
  )

  const seconds = countdownSeconds(retro.timerEndsAt, now)
  const live = livePresence(presence, now)
  const remaining = remainingVotes(retro.votesPerParticipant, votes)
  // Band 1's deck already carries the team, so band 2 states the retro and the cycle it reflects
  // on and nothing else. The stored title is the fallback for a retro with no cycle behind it.
  const cycleName = cycles.find((cycle) => cycle.id === retro.cycleId)?.name ?? null
  const actionsVisible = canAct || actions.length > 0

  return (
    <>
      <Masthead
        className="border-b-0 pb-0"
        title={
          <>
            Retro
            <span className="ml-2.5 text-[14px] font-normal text-text-2">
              {cycleName ?? retro.title}
            </span>
          </>
        }
        {...(configurable
          ? {
              meta: (
                <>
                  <FormatControl
                    format={retro.format}
                    canConfigure={configurable}
                    onChange={(next) => void api.setFormat(next)}
                  />
                  <AnonymityControl
                    anonymous={retro.isAnonymous}
                    canConfigure={configurable}
                    onToggle={(next) => void api.setAnonymous(next)}
                  />
                  <BudgetControl
                    budget={retro.votesPerParticipant}
                    canConfigure={configurable}
                    onChange={(next) => void api.setVoteBudget(next)}
                  />
                </>
              ),
            }
          : {})}
        actions={
          <>
            <PresenceStrip presence={live} />
            <TimerControl
              seconds={seconds}
              running={retro.timerEndsAt !== null}
              canControl={canFacilitate && retroCan(retro.phase, 'timer', { canWrite })}
              onStart={() => command.openTimer()}
              onStop={() => void api.stopTimer()}
            />
            <FacilitatorControl
              retro={retro}
              members={members}
              facilitator={facilitator}
              canWrite={canWrite}
              onClaim={() => void api.claimFacilitator()}
              onHandOff={() => command.openFacilitator()}
            />
          </>
        }
      />

      {/* The phase machine is the retro's own furniture, not band 2: it moves the session on. */}
      <div className="flex flex-col gap-3.5 border-b border-border px-5 pb-3.5 pt-2">
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <PhaseStepper
            phase={retro.phase}
            canFacilitate={canFacilitate}
            onStep={(to) => void api.setPhase(to)}
          />

          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold text-text-1">{PHASE_HINT[retro.phase]}</p>
            {retro.phase === 'vote' ? (
              <p
                className="flex items-center gap-2 font-mono text-[11px] text-text-2"
                data-testid="retro-vote-budget"
              >
                <VoteBudgetDots spent={retro.votesPerParticipant - remaining} left={remaining} />
                {remaining}/{retro.votesPerParticipant} dots left
              </p>
            ) : null}
          </div>

          <AnonymityNote anonymous={retro.isAnonymous} />
        </div>

        {error !== undefined ? (
          <div className="flex items-center gap-2 text-xs text-status-urgent-ink" role="alert">
            {error}
            <Button size="xs" variant="ghost" onClick={clearError}>
              Dismiss
            </Button>
          </div>
        ) : null}
      </div>

      {/* The stacking below band 2 is the argument: the team's own cards on the tabletop, then the
          seeded figures, then the AI's draft, then what the room decided to do. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Content-height, not `flex-1`: the board scrolls SIDEWAYS for a fourth column, and a
            vertically constrained tabletop slices the last card in the tallest column instead. The
            page is the scroll container; the felt is as tall as the cards on it. */}
        <div className="flex shrink-0 flex-col border-b border-border bg-bg-sidebar">
          <RetroBoard
            retro={retro}
            columns={columns}
            cards={cards}
            groups={groups}
            tallies={tallies}
            drafts={drafts}
            votes={votes}
            ownCardIds={ownCardIds}
            authorOf={authorOf}
            canWrite={canWrite}
            facilitator={facilitator}
            api={api}
            composerColumnId={composerColumnId}
            composerSeed={composerSeed}
            onComposerColumn={onComposerColumn}
            onOpenEvidence={onOpenEvidence}
            onFocusColumn={onFocusColumn}
            onFocusChange={command.setFocused}
            onGroupWith={command.openGroupWith}
            onActionFrom={(item) => {
              if (!canAct) return
              const body =
                item.kind === 'group'
                  ? (item.label ?? item.cards[0]?.body ?? 'Cluster')
                  : item.card.body
              void api.createAction(
                body,
                item.kind === 'group' ? { groupId: item.id } : { cardId: item.id },
              )
            }}
          />
          <p className="px-5 pb-3 pt-3.5 text-center text-xs text-text-2">
            {ROOM_FOOT[retro.phase]}
          </p>
        </div>

        <RetroSeedPanel
          seed={seed}
          canDraft={retroCan(retro.phase, 'draft', { canWrite })}
          seedPathOpen={isRetroWriteAllowed(retro.phase, 'draft')}
          open={seedOpen}
          onOpenChange={onSeedOpenChange}
          onSeedCard={onSeedCard}
        />

        {/* Below the room's own cards and adjacent to the seeded panel, never inside the board: the
            AI's categories are Wins/Losses/Improvements and two of the four retro formats have no
            such columns. Draws nothing at all unless a draft row exists and has something to say —
            only the empty live region that has to predate the first thing it announces. */}
        <RetroAiPanel
          retroId={retro.id}
          teamId={teamId}
          aiRetroDraftSince={aiRetroDraftSince}
          seed={seed}
          phase={retro.phase}
          canWrite={canWrite}
          onOpenIssue={openIssue}
          onOpenMetric={onOpenEvidence}
          onReact={(proposalId, value) => void api.setAiReaction(proposalId, value)}
          onClearReaction={(proposalId) => void api.clearAiReaction(proposalId)}
          onAddAction={(proposal) => {
            if (!canAct) return
            void api.createAction(proposal.summary, { aiProposalId: proposal.id })
          }}
          onFocusProposal={command.setFocusedAiProposal}
        />

        {/* A phase that can neither hold nor write an action draws no rail — but a retro stepped
            BACK from `discuss` still holds the actions it recorded, and hiding those would lose
            data the mock's fixture simply never had. */}
        {actionsVisible ? (
          <RetroActions
            retro={retro}
            actions={actions}
            members={members}
            cycles={cycles}
            teamKey={teamKey}
            canWrite={canWrite}
            composerOpen={actionComposerOpen}
            onFocusAction={command.setFocusedAction}
            onOpenComposer={onOpenActionComposer}
            onCloseComposer={onCloseActionComposer}
            api={api}
            onOpenIssue={openIssue}
          />
        ) : null}
      </div>
    </>
  )
}

// What the state machine actually enforces in the phase being drawn, and nothing else. The mock's
// "dots close when the clock runs out" is not true of `phase.ts` — the timer is a shared clock, not
// an authority; it is the facilitator's step that closes voting — so the room says that instead.
const ROOM_FOOT: Record<RetroPhase, string> = {
  brainstorm: 'Cards stay private until the room moves on · dots open at Vote',
  group: 'Writing closed when the cards were revealed · dots open at Vote',
  vote: 'Writing closed when the cards were revealed · dots close when the room moves on',
  discuss: 'Cards and dots are settled · actions are written from here',
  actions: 'Cards and dots are settled · actions are written from here',
  closed: 'Closed · an action can still become a numbered issue',
}

// Spent and unspent, drawn — beside the reading, never instead of it. A budget carried by shape
// alone is a budget a reader who cannot see the shapes does not have.
function VoteBudgetDots({ spent, left }: { spent: number; left: number }) {
  const dots = [
    ...Array.from({ length: left }, (_, index) => ({ id: `left-${index}`, unspent: true })),
    ...Array.from({ length: spent }, (_, index) => ({ id: `spent-${index}`, unspent: false })),
  ]
  return (
    <span aria-hidden="true" className="flex items-center gap-[5px]">
      {dots.map((dot) => (
        <span
          key={dot.id}
          className={cn(
            'size-[9px] rounded-full',
            dot.unspent ? 'bg-accent' : 'border-[1.4px] border-border-strong',
          )}
        />
      ))}
    </span>
  )
}

// The warm sentence that is also a storage fact: `retro_card_author` is a server-only table the
// sync schema cannot name, so an anonymous retro's card has no author on any synced row. It renders
// only where it is TRUE — an attributed retro states the opposite truth in the same slot, because a
// warm lie is worse than no warmth. It is a statement, not a control, and carries no tooltip: the
// shipped tooltip text is now the visible text.
function AnonymityNote({ anonymous }: { anonymous: boolean }) {
  return (
    <p className="ml-auto flex items-center gap-2" data-testid="retro-anonymity-note">
      <AnonymityMark className="text-text-2" />
      <span className="font-mono text-[10.5px] text-text-2">
        {anonymous
          ? 'cards are anonymous by design — there is no author column'
          : 'cards carry their author'}
      </span>
    </p>
  )
}

function PhaseStepper({
  phase,
  canFacilitate,
  onStep,
}: {
  phase: RetroPhase
  canFacilitate: boolean
  onStep: (to: RetroPhase) => void
}) {
  const current = RETRO_PHASES.indexOf(phase)
  const forward = nextPhase(phase)
  const back = previousPhase(phase)

  // A retro's phases ARE its time passing, so they take the cycle surfaces' day-band grammar:
  // spent, now, to come. `packages/ui`'s `DayBand` itself is deliberately not reused — its segment
  // union is past/today/future and it stretches to fill, where the stepper needs six fixed-width
  // labelled columns, and widening a shared primitive's union for one caller is the thing
  // `reality-vocabulary` exists to prevent.
  //
  // NO SPENT PHASE CARRIES A DURATION. Nothing stores one: `retro` holds a single running-timer
  // pair and there is no per-phase transition log anywhere.
  return (
    <nav className="flex flex-none items-start gap-3" aria-label="Retro phase">
      <ol className="flex flex-none items-start gap-1.5">
        {RETRO_PHASES.map((entry, index) => (
          <li key={entry} className="w-[74px]">
            <span
              data-testid="retro-phase-step"
              data-phase={entry}
              aria-current={entry === phase ? 'step' : undefined}
              className="block"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'block h-2 rounded-[2.5px]',
                  entry === phase
                    ? 'bg-accent'
                    : index < current
                      ? 'bg-accent-soft'
                      : 'border border-border bg-bg-hover',
                )}
              />
              {/* The current phase is named in `--text-1` rather than the mock's accent ink, which
                  lands at 4.44 on the page ground in Editorial light — under AA at 11.5px. It is
                  told apart by weight, by the filled band above it and by the `now` reading, so
                  nothing here was ever carried by hue alone. */}
              <span
                className={cn(
                  'mt-1.5 block text-[11.5px]',
                  entry === phase ? 'font-semibold text-text-1' : 'text-text-2',
                )}
              >
                {PHASE_LABEL[entry]}
              </span>
              {entry === phase ? (
                <span className="block font-mono text-[10px] text-text-2">now</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
      {canFacilitate ? (
        <span className="flex flex-none items-center gap-1">
          <PhaseKey
            cap="["
            testId="retro-phase-back"
            label={back ? `Step back to ${PHASE_LABEL[back]}` : 'Step back'}
            unavailable={back === null}
            onStep={() => back && onStep(back)}
          />
          <PhaseKey
            cap="]"
            testId="retro-phase-forward"
            label={forward ? `Advance to ${PHASE_LABEL[forward]}` : 'Advance'}
            unavailable={forward === null}
            onStep={() => forward && onStep(forward)}
          />
        </span>
      ) : null}
    </nav>
  )
}

// The mock draws the two moves as keycaps. They are real focusable buttons with the keycap drawn
// INSIDE them: the accessible name stays the sentence and the key rides on `aria-keyshortcuts`, the
// `triage-daylight` B2 precedent.
//
// At either end of the machine one move stops being usable. Natively disabling it while it holds
// focus makes the browser blur it to <body>, stranding a keyboard user at the top of the document —
// so it stays focusable, states its unavailability with `aria-disabled`, and no-ops.
function PhaseKey({
  cap,
  testId,
  label,
  unavailable,
  onStep,
}: {
  cap: string
  testId: string
  label: string
  unavailable: boolean
  onStep: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      aria-keyshortcuts={cap}
      aria-disabled={unavailable}
      onClick={onStep}
      className="rounded-[4px] border border-border-strong bg-bg-elevated px-[5px] py-px font-mono text-[10px] text-text-2 outline-none transition-colors hover:text-text-1 focus-visible:ring-2 focus-visible:ring-accent aria-disabled:pointer-events-none aria-disabled:opacity-50"
    >
      <span aria-hidden="true">{cap}</span>
    </button>
  )
}

function PresenceStrip({ presence }: { presence: readonly RetroPresenceData[] }) {
  if (presence.length === 0) return null
  return (
    <span className="flex items-center gap-2" data-testid="retro-presence">
      <ul className="flex items-center" aria-label={`${presence.length} here`}>
        {presence.slice(0, 4).map((row) => (
          <li key={row.userId} className="-ml-[5px] first:ml-0">
            <Avatar size="xs" className="outline outline-[1.5px] outline-bg" title={row.name}>
              <AvatarFallback aria-label={row.name}>
                {row.name
                  .split(/\s+/u)
                  .slice(0, 2)
                  .map((part) => part.charAt(0).toUpperCase())
                  .join('')}
              </AvatarFallback>
            </Avatar>
          </li>
        ))}
      </ul>
      {/* The count is already the list's accessible name; the drawn reading is for the eye. */}
      <span aria-hidden="true" className="text-[12px] text-text-2">
        {presence.length} here
      </span>
    </span>
  )
}

function TimerControl({
  seconds,
  running,
  canControl,
  onStart,
  onStop,
}: {
  seconds: number | null
  running: boolean
  canControl: boolean
  onStart: () => void
  onStop: () => void
}) {
  if (running && seconds !== null) {
    return (
      <span className="flex items-center gap-1.5" data-testid="retro-timer">
        <span
          className="font-mono text-xs tabular-nums text-text-1"
          role="timer"
          aria-label={`${formatCountdown(seconds)} remaining`}
        >
          {formatCountdown(seconds)}
        </span>
        {canControl ? (
          <Button size="icon-xs" variant="ghost" aria-label="Stop the timer" onClick={onStop}>
            <TimerOffIcon />
          </Button>
        ) : null}
      </span>
    )
  }
  if (!canControl) return null
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label="Start a timer"
      aria-keyshortcuts="t"
      data-testid="retro-timer-start"
      onClick={onStart}
    >
      <TimerIcon />
    </Button>
  )
}

// The four starter formats, chosen while the retro is still empty. A format change replaces the
// columns, so the mutator refuses once any draft or card exists — including drafts this client
// cannot see, which is why the failure surfaces in the error line rather than being pre-empted.
function FormatControl({
  format,
  canConfigure,
  onChange,
}: {
  format: RetroFormat
  canConfigure: boolean
  onChange: (next: RetroFormat) => void
}) {
  // NO RESTING PILL. The format's own column headings already say what the format is, so a pill
  // repeating it is band 2 restating the body beneath it. The control itself survives untouched.
  if (!canConfigure) return null
  // `Select` fills its wrapper, so the header bounds it rather than letting it claim a whole row.
  return (
    <span className="w-52">
      <Select
        aria-label="Retro format"
        className="h-7 text-xs"
        data-testid="retro-format"
        value={format}
        onChange={(event) => onChange(event.target.value as RetroFormat)}
      >
        {RETRO_FORMATS.map((entry) => (
          <option key={entry} value={entry}>
            {RETRO_FORMAT_LABEL[entry]}
          </option>
        ))}
      </Select>
    </span>
  )
}

// One knob, one row: how many dots each participant may spend. Settable only while the retro is
// still empty, and enforced authoritatively per voter when a dot is cast.
function BudgetControl({
  budget,
  canConfigure,
  onChange,
}: {
  budget: number
  canConfigure: boolean
  onChange: (next: number) => void
}) {
  if (!canConfigure) return null
  return (
    <span className="w-32">
      <Select
        aria-label="Dots per person"
        className="h-7 text-xs"
        data-testid="retro-vote-budget-set"
        value={String(budget)}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {Array.from(
          { length: MAX_VOTES_PER_PARTICIPANT - MIN_VOTES_PER_PARTICIPANT + 1 },
          (_, index) => MIN_VOTES_PER_PARTICIPANT + index,
        ).map((dots) => (
          <option key={dots} value={dots}>
            {dots === 1 ? '1 dot each' : `${dots} dots each`}
          </option>
        ))}
      </Select>
    </span>
  )
}

// Anonymity is a storage fact, not a display option, and it is fixed BEFORE any card exists — so
// the control only exists while `configure` is allowed (brainstorm, nothing published yet) and only
// for the facilitator. The BARE PILL that used to remain afterwards is gone: `AnonymityNote` states
// the guarantee itself, in words, in every phase. The toggle keeps its place beside that sentence
// while the choice is still open, because it is the thing that makes the sentence true.
function AnonymityControl({
  anonymous,
  canConfigure,
  onToggle,
}: {
  anonymous: boolean
  canConfigure: boolean
  onToggle: (next: boolean) => void
}) {
  if (!canConfigure) return null
  return (
    <Button
      size="xs"
      variant={anonymous ? 'outline' : 'ghost'}
      data-testid="retro-anonymity-toggle"
      data-anonymous={anonymous}
      aria-pressed={anonymous}
      onClick={() => onToggle(!anonymous)}
    >
      {anonymous ? 'Anonymous' : 'Attributed'}
    </Button>
  )
}

function FacilitatorControl({
  retro,
  members,
  facilitator,
  canWrite,
  onClaim,
  onHandOff,
}: {
  retro: RetroRowData
  members: readonly { id: string; name: string }[]
  facilitator: boolean
  canWrite: boolean
  onClaim: () => void
  onHandOff: () => void
}) {
  if (retro.facilitatorId === null) {
    if (!canWrite) return <span className="text-[11.5px] text-text-3">No facilitator</span>
    return (
      <Button size="xs" variant="outline" data-testid="retro-claim-facilitator" onClick={onClaim}>
        <UserIcon />
        Run this retro
      </Button>
    )
  }
  const name = members.find((member) => member.id === retro.facilitatorId)?.name ?? 'another member'
  if (!facilitator) {
    return <span className="text-[11.5px] text-text-3">{name} is facilitating</span>
  }
  return (
    <Button size="xs" variant="ghost" data-testid="retro-hand-off" onClick={onHandOff}>
      <UserIcon />
      You are facilitating
    </Button>
  )
}
