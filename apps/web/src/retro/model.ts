import {
  initialRanks,
  isRetroWriteAllowed,
  newId,
  RETRO_FORMAT_COLUMNS,
  RETRO_PHASES,
  RETRO_PRESENCE_STALE_MS,
  type RetroColumnAccent,
  type RetroFormat,
  type RetroPhase,
  type RetroVoteTarget,
  type RetroWriteOp,
  rankBetween,
} from '@yapm/schema'
import type { RetroAccentKind } from '@yapm/ui/components/retro-card'

export interface RetroRowData {
  readonly id: string
  readonly teamId: string
  readonly cycleId: string | null
  readonly nextCycleId: string | null
  readonly title: string
  readonly format: RetroFormat
  readonly phase: RetroPhase
  readonly facilitatorId: string | null
  readonly isAnonymous: boolean
  readonly votesPerParticipant: number
  readonly timerEndsAt: number | null
  readonly timerDurationS: number | null
  readonly closedAt: number | null
  readonly createdAt: number
}

export interface RetroColumnData {
  readonly id: string
  readonly key: string
  readonly title: string
  readonly accentToken: RetroColumnAccent
  readonly rank: string
}

export interface RetroCardData {
  readonly id: string
  readonly columnId: string
  readonly groupId: string | null
  readonly body: string
  readonly rank: string
  readonly isAnonymous: boolean
  readonly authorDisplayId: string | null
  readonly createdAt: number
}

export interface RetroGroupData {
  readonly id: string
  readonly columnId: string
  readonly label: string | null
  readonly rank: string
}

export interface RetroDraftData {
  readonly id: string
  readonly columnId: string
  readonly body: string
  readonly rank: string
  readonly publishedAt: number | null
}

export interface RetroVoteRowData {
  readonly id: string
  readonly targetType: RetroVoteTarget
  readonly targetId: string
  readonly createdAt: number
}

export interface RetroTallyData {
  readonly targetId: string
  readonly count: number
}

export interface RetroPresenceData {
  readonly userId: string
  readonly focusTarget: string | null
  readonly lastSeenAt: number
  readonly name: string
}

export interface RetroActionData {
  readonly id: string
  readonly body: string
  readonly assigneeId: string | null
  readonly targetCycleId: string | null
  readonly issueId: string | null
  readonly groupId: string | null
  readonly cardId: string | null
  readonly createdAt: number
  readonly issue: {
    readonly id: string
    readonly number: number | null
    readonly title: string
    readonly status: string
  } | null
}

export const PHASE_LABEL: Record<RetroPhase, string> = {
  brainstorm: 'Brainstorm',
  group: 'Group',
  vote: 'Vote',
  discuss: 'Discuss',
  actions: 'Actions',
  closed: 'Closed',
}

// What each phase asks of the room, in the room's own words. Blameless throughout: the copy
// narrates the ceremony, never a person.
export const PHASE_HINT: Record<RetroPhase, string> = {
  brainstorm: 'Write privately. Nobody sees your cards until the room moves on.',
  group: 'Cluster cards that say the same thing. Drag one onto another to group them.',
  vote: 'Spend your dots on what the team should talk about.',
  discuss: 'Work through the most-voted clusters and capture what changes.',
  actions: 'Assign the actions and give each one a cycle.',
  closed: 'This retro is read-only. Its actions live on as issues.',
}

// A column's stored accent is a retro-SEMANTIC key (never a color, never a CSS variable name);
// the UI primitive owns the token behind each kind, so a token rename never touches Postgres.
export const ACCENT_TO_KIND: Record<RetroColumnAccent, RetroAccentKind> = {
  positive: 'positive',
  negative: 'negative',
  caution: 'caution',
  neutral: 'neutral',
  action: 'action',
}

export const RETRO_FORMAT_LABEL: Record<RetroFormat, string> = {
  wentwell_didnt_action: 'Went well / Didn’t / Actions',
  start_stop_continue: 'Start / Stop / Continue',
  mad_sad_glad: 'Mad / Sad / Glad',
  '4ls': '4Ls',
}

export function phaseIndex(phase: RetroPhase): number {
  return RETRO_PHASES.indexOf(phase)
}

export function nextPhase(phase: RetroPhase): RetroPhase | null {
  return RETRO_PHASES[phaseIndex(phase) + 1] ?? null
}

export function previousPhase(phase: RetroPhase): RetroPhase | null {
  const index = phaseIndex(phase)
  return index <= 0 ? null : (RETRO_PHASES[index - 1] ?? null)
}

// The UI's affordances come from the SAME predicate the server enforces, so a button can never
// offer a write the authority will reject. `canWrite` is the ordinary role ceiling.
export function retroCan(
  phase: RetroPhase,
  op: RetroWriteOp,
  options: { canWrite: boolean; facilitator?: boolean },
): boolean {
  if (!options.canWrite) return false
  if (options.facilitator === false) return false
  return isRetroWriteAllowed(phase, op)
}

export function isFacilitator(
  retro: { facilitatorId: string | null },
  userId: string | null,
  canManage: boolean,
): boolean {
  return canManage || (userId !== null && retro.facilitatorId === userId)
}

// Ranks are minted per author over rows only that author can see, so two authors can mint the
// same first key. Cards therefore sort by (rank, id) — deterministic and identical on every
// client (design.md D-1).
export function compareByRank(
  a: { rank: string; id: string },
  b: { rank: string; id: string },
): number {
  if (a.rank !== b.rank) return a.rank < b.rank ? -1 : 1
  return a.id.localeCompare(b.id)
}

export interface RetroBoardGroup {
  readonly kind: 'group'
  readonly id: string
  readonly rank: string
  readonly label: string | null
  readonly cards: readonly RetroCardData[]
}

export interface RetroBoardCard {
  readonly kind: 'card'
  readonly id: string
  readonly rank: string
  readonly card: RetroCardData
}

export type RetroBoardItem = RetroBoardGroup | RetroBoardCard

export interface RetroBoardColumn {
  readonly column: RetroColumnData
  readonly items: readonly RetroBoardItem[]
  readonly cardCount: number
}

// One column's display order: groups and ungrouped cards interleaved by rank, each group's own
// cards ordered by rank. A group takes the rank of its own row, so dissolving it returns its
// cards to their own positions rather than teleporting them.
export function buildRetroColumns(
  columns: readonly RetroColumnData[],
  cards: readonly RetroCardData[],
  groups: readonly RetroGroupData[],
): RetroBoardColumn[] {
  return [...columns].sort(compareByRank).map((column) => {
    const columnCards = cards.filter((card) => card.columnId === column.id)
    const items: RetroBoardItem[] = []
    for (const group of groups.filter((group) => group.columnId === column.id)) {
      items.push({
        kind: 'group',
        id: group.id,
        rank: group.rank,
        label: group.label,
        cards: columnCards.filter((card) => card.groupId === group.id).sort(compareByRank),
      })
    }
    for (const card of columnCards.filter((card) => card.groupId === null)) {
      items.push({ kind: 'card', id: card.id, rank: card.rank, card })
    }
    return {
      column,
      items: items.sort(compareByRank),
      cardCount: columnCards.length,
    }
  })
}

// A dot targets the GROUP once the card has been grouped, and the card itself otherwise — the
// same rule `retroVote.cast` enforces, so the UI never offers a target the server rejects.
export function voteTarget(item: RetroBoardItem): {
  targetType: RetroVoteTarget
  targetId: string
} {
  return item.kind === 'group'
    ? { targetType: 'group', targetId: item.id }
    : { targetType: 'card', targetId: item.id }
}

export function tallyFor(tallies: readonly RetroTallyData[], targetId: string): number {
  return tallies.find((tally) => tally.targetId === targetId)?.count ?? 0
}

export function myVotesFor(
  votes: readonly RetroVoteRowData[],
  targetId: string,
): readonly RetroVoteRowData[] {
  return votes.filter((vote) => vote.targetId === targetId)
}

export function remainingVotes(budget: number, votes: readonly RetroVoteRowData[]): number {
  return Math.max(budget - votes.length, 0)
}

// The append rank for a new row at the end of an ordered list, minted at the CALL SITE.
export function appendRank(rows: readonly { rank: string }[]): string {
  const last = rows.reduce<string | null>(
    (max, row) => (max === null || row.rank > max ? row.rank : max),
    null,
  )
  return rankBetween(last, null)
}

// Given the destination list in its FINAL order (the moved row included at `index`), mint the
// single new rank between its neighbours. Sibling ranks are never touched. Equal neighbours are
// an accepted concurrency state (ranks are not unique), and `rankBetween(r, r)` throws, so the
// collision falls back to a strict mint after the lower bound, self-healing on this move.
export function rankForSlot(finalOrder: readonly { rank: string }[], index: number): string {
  const before = index > 0 ? (finalOrder[index - 1]?.rank ?? null) : null
  const after = finalOrder[index + 1]?.rank ?? null
  if (before !== null && after !== null && before >= after) return rankBetween(before, null)
  return rankBetween(before, after)
}

export function livePresence(
  presence: readonly RetroPresenceData[],
  now: number,
): readonly RetroPresenceData[] {
  return presence.filter((row) => now - row.lastSeenAt < RETRO_PRESENCE_STALE_MS)
}

// The timer is durable state, never a tick: every client renders `endsAt - now` locally, so a
// five-minute timer costs exactly one row write.
export function countdownSeconds(endsAt: number | null, now: number): number | null {
  if (endsAt === null) return null
  return Math.max(Math.ceil((endsAt - now) / 1000), 0)
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export const TIMER_PRESETS_S = [180, 300, 600] as const

export function formatDuration(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60} min` : `${seconds}s`
}

// Opening a retro mints the retro AND its column ids at the CALL SITE, because a mutator may
// never mint an id — it re-runs on rebase. The columns are the named format's template, which
// `retro.openForCycle` re-validates, so a client cannot inject its own under a known name.
export function openRetroArgs(
  cycleId: string,
  nextCycleId: string | null,
  format: RetroFormat,
): {
  id: string
  cycleId: string
  nextCycleId: string | null
  format: RetroFormat
  columns: {
    id: string
    key: string
    title: string
    accentToken: RetroColumnAccent
    rank: string
  }[]
  createdAt: number
  updatedAt: number
} {
  const template = RETRO_FORMAT_COLUMNS[format]
  const ranks = initialRanks(template.length)
  const now = Date.now()
  return {
    id: newId(),
    cycleId,
    nextCycleId,
    format,
    columns: template.map((column, index) => ({
      id: newId(),
      key: column.key,
      title: column.title,
      accentToken: column.accentToken,
      rank: ranks[index] ?? '',
    })),
    createdAt: now,
    updatedAt: now,
  }
}

// The next cycle by start date — the default target for this retro's action items.
export function nextCycleIdAfter(
  cycles: readonly { id: string; startDate: number }[],
  cycleId: string,
): string | null {
  const ordered = [...cycles].sort((a, b) => a.startDate - b.startDate)
  const index = ordered.findIndex((candidate) => candidate.id === cycleId)
  return index === -1 ? null : (ordered[index + 1]?.id ?? null)
}
