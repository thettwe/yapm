import type {
  CiConclusion,
  CycleDigestStatus,
  CycleStatus,
  IssuePriority,
  IssueStatus,
  NotificationKind,
  RetroPhase,
  ReviewState,
} from './context.js'
import { compareCycles, isUnfinished } from './cycles.js'
import {
  assembleLinkedEntities,
  buildDeploymentIndex,
  ciHealthFromConclusion,
  computeDeliverySignal,
  computeDivergence,
  type DeliverySignal,
  type DeliveryStrip,
  type DivergenceKind,
  type PrState,
} from './delivery.js'
import { plural } from './metrics/scope.js'
import { sayRestPhrase } from './phrases.js'

// The team Home digest's whole page model, computed in ONE place over rows the page already syncs
// (design §D1). Pure and deterministic: `now` and `viewerId` are explicit arguments, no `Date.now()`
// anywhere in this file, and no identity dimension exists in any output type — personal fields are
// only ever the viewer's own rows, asserted structurally by the `blameless` walker in the tests.

export const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
export const CADENCE_WEEK_COUNT = 12
export const TRIAGE_DOT_CAP = 8

// ---------------------------------------------------------------------------
// Input rows — structural, satisfied by the existing named queries' results.
// ---------------------------------------------------------------------------

export interface TeamHomeTeamRow {
  readonly id: string
  readonly key: string
  readonly name: string
}

export interface TeamHomeCycleRow {
  readonly id: string
  readonly number?: number | null
  readonly name: string
  readonly status: CycleStatus
  readonly startDate: number
  readonly endDate: number
}

// A linked pull request as the `withLinkedDelivery` subtree returns it, widened with the check
// timestamps the attention evidence reads ("red 41m"). Structurally a `LinkedPullRequestRow`.
export interface TeamHomePullRequestRow {
  readonly state: PrState
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly repo?: string | null
  readonly mergeCommitSha?: string | null
  readonly ciChecks?: readonly { readonly conclusion: CiConclusion; readonly updatedAt?: number }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
}

export interface TeamHomeIssueLinkRow {
  readonly pullRequest?: TeamHomePullRequestRow | null
}

export interface TeamHomeIssueRow {
  readonly id: string
  readonly number?: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly priority: IssuePriority
  readonly assigneeId?: string | null
  readonly cycleId?: string | null
  readonly rolledOverFromCycleId?: string | null
  readonly cycleAssignedAt?: number | null
  readonly createdAt: number
  readonly updatedAt: number
  readonly issueLinks?: readonly TeamHomeIssueLinkRow[]
}

export interface TeamHomeTriageRow {
  readonly id: string
  readonly createdAt: number
}

export interface TeamHomeDeploymentRow {
  readonly repo: string
  readonly sha?: string | null
  readonly environment?: string | null
  readonly ref?: string | null
  readonly deployedAt?: number | null
}

export interface TeamHomeDigestRow {
  readonly status: CycleDigestStatus
  readonly content?: { readonly headline?: string } | null
}

export interface TeamHomeRetroRow {
  readonly id: string
  readonly cycleId?: string | null
  readonly title: string
  readonly phase: RetroPhase
  readonly closedAt?: number | null
}

export interface TeamHomeNotificationRow {
  readonly kind: NotificationKind
  readonly teamId: string
  readonly subjectKey?: string | null
  readonly subjectTitle: string
  readonly readAt?: number | null
  readonly createdAt: number
}

// The five reads the app FRAME needs — the subset of Home's eight that every authenticated page
// can afford to hold (design app-frame §D2). `retros` is optional here because it only sharpens
// the cadence chart's retro ticks, which the frame never draws.
export interface TeamFrameInput {
  readonly team: TeamHomeTeamRow
  readonly cycles: readonly TeamHomeCycleRow[]
  readonly issues: readonly TeamHomeIssueRow[]
  readonly triage: readonly TeamHomeTriageRow[]
  readonly deployments: readonly TeamHomeDeploymentRow[]
  readonly retros?: readonly TeamHomeRetroRow[]
}

export interface TeamHomeInput extends TeamFrameInput {
  readonly digest?: TeamHomeDigestRow | null
  readonly retros: readonly TeamHomeRetroRow[]
  readonly notifications: readonly TeamHomeNotificationRow[]
}

// ---------------------------------------------------------------------------
// Output model — identity-free by construction.
// ---------------------------------------------------------------------------

export interface AttentionDivergenceRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
}

export interface AttentionChecksRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  // Milliseconds the newest failing check has been red, or null when the check row carried no
  // usable timestamp — the age line folds rather than guesses.
  readonly redForMs: number | null
  // One tick per linked check, true = failing. Drawn by the tick-bar, capped visually there.
  readonly ticks: readonly boolean[]
}

export interface TeamHomeAttention {
  // THE one attention number: the sum of the four disjoint class counts, which is a
  // distinct-issue count by construction (design §D2). Every occurrence on the page renders this.
  readonly count: number
  readonly divergence: {
    readonly count: number
    readonly rows: readonly AttentionDivergenceRow[]
  } | null
  readonly checksFailing: {
    readonly count: number
    readonly rows: readonly AttentionChecksRow[]
  } | null
  readonly waitingReview: { readonly count: number; readonly agesMs: readonly number[] } | null
  readonly triage: { readonly count: number; readonly dotCount: number } | null
}

export interface TeamFrameCycle {
  readonly title: string
  readonly dayIndex: number
  readonly dayCount: number
}

// What band 1 and band 3 of the app frame render, on every authenticated page. Every field is
// nullable so a statusline segment folds rather than asserting a fact that does not exist.
export interface TeamFrameModel {
  readonly teamId: string
  readonly teamName: string
  readonly teamKey: string
  readonly attention: TeamHomeAttention | null
  readonly cycle: TeamFrameCycle | null
  readonly shipped: number | null
  readonly deploysThisWeek: number | null
}

export type DayBandSegment = 'past' | 'today' | 'future'

export interface TeamHomeScope {
  readonly committed: number
  readonly landed: number
  readonly added: number
  // One block per in-cycle issue: done → landed, else added-mid-cycle → added, else open.
  readonly band: readonly ('landed' | 'open' | 'added')[]
}

export interface TeamHomeHeroCycle {
  readonly cycleId: string
  readonly title: string
  readonly dayIndex: number
  readonly dayCount: number
  readonly endsWeekday: string
  readonly dayBand: readonly DayBandSegment[]
  readonly daysLeft: number
  readonly statusWords: {
    readonly shipped: number
    readonly inReview: number
    // Always equal to `attention.count` — assigned from the same computed value.
    readonly needAttention: number
  }
  readonly scope: TeamHomeScope
  readonly chips: { readonly cycleReport: boolean; readonly wrapped: boolean }
  // Only derivable rituals: open retros, with state and no invented times (design §D3).
  readonly next: readonly {
    readonly retroId: string
    readonly title: string
    readonly phase: RetroPhase
  }[]
}

export interface TeamHomeNarrative {
  readonly source: 'digest' | 'computed'
  readonly sentences: readonly string[]
}

export interface TeamHomeHero {
  // Null is the degraded no-active-cycle form: the page renders the team name, a quiet line and
  // a Cycles doorway; every cycle-dependent band folds.
  readonly cycle: TeamHomeHeroCycle | null
  readonly narrative: TeamHomeNarrative | null
}

export interface TeamHomeOvernight {
  readonly deployCount: number
  readonly lines: readonly { readonly text: string; readonly atMs: number }[]
  readonly provenance: string
}

export interface TeamHomeReviewFact {
  readonly issueId: string
  readonly issueKey: string
  readonly state: ReviewState
  readonly outcome: string
  readonly ageMs: number
}

export interface TeamHomeInboxFact {
  readonly kind: NotificationKind
  readonly title: string
  readonly subjectKey: string | null
  readonly ageMs: number
}

export interface TeamHomeSinceYesterday {
  readonly overnight: TeamHomeOvernight | null
  readonly yourReview: { readonly rows: readonly TeamHomeReviewFact[] } | null
  readonly inbox: { readonly count: number; readonly rows: readonly TeamHomeInboxFact[] } | null
  readonly cardCount: number
}

export interface TeamHomeYoursRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  readonly status: IssueStatus
  readonly strip: DeliveryStrip | null
  readonly divergence: DivergenceKind | null
  readonly say: string
  readonly sayUrgent: boolean
  readonly git: string
}

export interface TeamHomeYours {
  readonly count: number
  readonly rows: readonly TeamHomeYoursRow[]
  readonly waitingOnOthers: { readonly count: number; readonly agesMs: readonly number[] } | null
  // True ONLY under the team-level predicate: no open PR linked to this team's issues is awaiting
  // review at all (design §D5). Never a per-person claim — that mapping does not exist.
  readonly noReviewsOwed: boolean
  readonly footnote: string
}

export interface TeamHomeRunwayRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  readonly priority: IssuePriority
  readonly phrase: string
  readonly urgent: boolean
}

export interface TeamHomeRunway {
  readonly count: number
  readonly rows: readonly TeamHomeRunwayRow[]
}

export interface TeamHomeCadenceWeek {
  readonly startMs: number
  readonly deploys: number
  readonly retro: boolean
  readonly monthLabel: string | null
}

export interface TeamHomeCadence {
  readonly weeks: readonly TeamHomeCadenceWeek[]
  readonly todayIndex: number
}

export interface TeamHomeShippedRow {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  readonly live: boolean
}

export interface TeamHomeShipped {
  readonly count: number
  readonly rows: readonly TeamHomeShippedRow[]
}

export interface TeamHomeModel {
  readonly teamId: string
  readonly teamName: string
  readonly teamKey: string
  readonly hero: TeamHomeHero
  readonly attention: TeamHomeAttention | null
  readonly sinceYesterday: TeamHomeSinceYesterday | null
  readonly yours: TeamHomeYours
  readonly runway: TeamHomeRunway | null
  readonly cadence: TeamHomeCadence | null
  readonly shipped: TeamHomeShipped | null
  // The composed footline's clauses — only rules the render actually applied (design §D9).
  readonly footline: readonly string[]
}

// ---------------------------------------------------------------------------
// Shared formatting — the mock's mono vocabulary ("41m", "31h", "3d").
// ---------------------------------------------------------------------------

export function formatHomeAge(ms: number): string {
  if (ms < 60_000) return 'now'
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `${min}m`
  const hours = Math.floor(min / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

export const REVIEW_OUTCOME_LABEL: Record<ReviewState, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  commented: 'Commented',
  dismissed: 'Dismissed',
}

export const YOURS_FOOTNOTE =
  'yours = assignee you · status < done · ordered by last movement · your work only — never compared'

// The same rule as the web `issueKey` helper: pending server number renders as pending.
function issueKeyOf(teamKey: string, issue: { readonly number?: number | null }): string {
  return issue.number == null ? `${teamKey}‑…` : `${teamKey}-${issue.number}`
}

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

function utcDayIndex(ms: number): number {
  return Math.floor(ms / DAY_MS)
}

// Monday-based UTC week start (epoch day 0 was a Thursday, 3 days after a Monday).
function utcWeekStart(ms: number): number {
  const day = utcDayIndex(ms)
  return (day - ((day + 3) % 7)) * DAY_MS
}

// ---------------------------------------------------------------------------
// Per-issue delivery, computed once and shared by every band.
// ---------------------------------------------------------------------------

interface IssueDelivery {
  readonly issue: TeamHomeIssueRow
  readonly signal: DeliverySignal | null
  readonly divergence: DivergenceKind | null
}

function linkedPrs(issue: TeamHomeIssueRow): readonly TeamHomePullRequestRow[] {
  return (issue.issueLinks ?? []).flatMap((link) => (link.pullRequest ? [link.pullRequest] : []))
}

function latestReviewOf(
  pr: TeamHomePullRequestRow,
): { readonly state: ReviewState; readonly submittedAt: number } | undefined {
  return (pr.reviews ?? []).reduce<
    { readonly state: ReviewState; readonly submittedAt: number } | undefined
  >(
    (latest, r) => (latest === undefined || r.submittedAt > latest.submittedAt ? r : latest),
    undefined,
  )
}

function newestFailingCheckAt(issue: TeamHomeIssueRow): number | null {
  let newest: number | null = null
  for (const pr of linkedPrs(issue)) {
    for (const check of pr.ciChecks ?? []) {
      if (ciHealthFromConclusion(check.conclusion) !== 'failing') continue
      if (check.updatedAt === undefined) continue
      if (newest === null || check.updatedAt > newest) newest = check.updatedAt
    }
  }
  return newest
}

function checkTicks(issue: TeamHomeIssueRow): boolean[] {
  return linkedPrs(issue).flatMap((pr) =>
    (pr.ciChecks ?? []).map((check) => ciHealthFromConclusion(check.conclusion) === 'failing'),
  )
}

// ---------------------------------------------------------------------------
// The model.
// ---------------------------------------------------------------------------

function cycleTitle(cycle: TeamHomeCycleRow): string {
  if (cycle.name.trim() !== '') return cycle.name
  return cycle.number == null ? 'Cycle …' : `Cycle ${cycle.number}`
}

function cycleDays(cycle: TeamHomeCycleRow, now: number): { dayIndex: number; dayCount: number } {
  const startDay = utcDayIndex(cycle.startDate)
  const dayCount = Math.max(1, utcDayIndex(cycle.endDate) - startDay + 1)
  return { dayCount, dayIndex: Math.min(dayCount, Math.max(1, utcDayIndex(now) - startDay + 1)) }
}

// The frame model plus the intermediates the digest builds its bands on. One walk over the issues,
// one `buildAttention` call, one active-cycle selection — shared, so the deck, the statusline and
// Home's NEEDS ATTENTION cannot disagree because none of them computes anything twice.
interface TeamFrameCore {
  readonly frame: TeamFrameModel
  readonly deliveries: readonly IssueDelivery[]
  readonly activeCycle: TeamHomeCycleRow | null
  readonly cycleDeliveries: readonly IssueDelivery[]
  readonly cadence: TeamHomeCadence | null
}

function buildTeamFrameCore(input: TeamFrameInput, now: number): TeamFrameCore {
  const team = input.team
  const deployIndex = buildDeploymentIndex(input.deployments)

  const deliveries: readonly IssueDelivery[] = input.issues.map((issue) => {
    const linked = assembleLinkedEntities(issue.issueLinks ?? [], deployIndex)
    const signal = computeDeliverySignal(issue, linked, now)
    return { issue, signal, divergence: computeDivergence(issue.status, signal) }
  })

  const attention = buildAttention(deliveries, input.triage, team.key, now)
  const activeCycle =
    [...input.cycles].filter((cycle) => cycle.status === 'active').sort(compareCycles)[0] ?? null
  const cycleDeliveries =
    activeCycle === null ? [] : deliveries.filter((d) => d.issue.cycleId === activeCycle.id)
  const cadence = buildCadence(input.deployments, input.retros ?? [], now)
  const currentWeek = cadence === null ? undefined : cadence.weeks[cadence.todayIndex]

  return {
    frame: {
      teamId: team.id,
      teamName: team.name,
      teamKey: team.key,
      attention,
      cycle:
        activeCycle === null
          ? null
          : { title: cycleTitle(activeCycle), ...cycleDays(activeCycle, now) },
      shipped:
        activeCycle === null
          ? null
          : cycleDeliveries.filter(({ issue }) => issue.status === 'done').length,
      deploysThisWeek: currentWeek === undefined ? null : currentWeek.deploys,
    },
    deliveries,
    activeCycle,
    cycleDeliveries,
    cadence,
  }
}

// Bands 1 and 3 of the app frame, over the five reads every page already holds.
export function buildTeamFrame(input: TeamFrameInput, now: number): TeamFrameModel {
  return buildTeamFrameCore(input, now).frame
}

export function buildTeamHome(input: TeamHomeInput, now: number, viewerId: string): TeamHomeModel {
  const team = input.team
  const core = buildTeamFrameCore(input, now)
  const { deliveries, activeCycle, cycleDeliveries, cadence } = core
  // The identical object the frame renders — not a second derivation, and not a copy.
  const attention = core.frame.attention

  const heroCycle =
    activeCycle === null || core.frame.cycle === null
      ? null
      : buildHeroCycle(
          activeCycle,
          cycleDeliveries,
          input,
          core.frame.cycle,
          core.frame.shipped ?? 0,
          attention?.count ?? 0,
        )
  const narrative = buildNarrative(input.digest ?? null, heroCycle, cycleDeliveries, attention)
  const sinceYesterday = buildSinceYesterday(input, deliveries, now, viewerId, team.key)
  const yours = buildYours(deliveries, now, viewerId, team.key)
  const runway = activeCycle === null ? null : buildRunway(activeCycle, cycleDeliveries, team.key)
  const shipped = buildShipped(cycleDeliveries, team.key)

  const footline: string[] = []
  if (attention !== null) footline.push('attention first')
  if (yours.count > 0) footline.push('your lens — your work only')
  footline.push('empty bands fold away')

  return {
    teamId: team.id,
    teamName: team.name,
    teamKey: team.key,
    hero: { cycle: heroCycle, narrative },
    attention,
    sinceYesterday,
    yours,
    runway,
    cadence,
    shipped,
    footline,
  }
}

// §D2 — four DISJOINT classes assigned by precedence, so the sum is a distinct-issue count.
function buildAttention(
  deliveries: readonly IssueDelivery[],
  triage: readonly TeamHomeTriageRow[],
  teamKey: string,
  now: number,
): TeamHomeAttention | null {
  const divergenceRows: AttentionDivergenceRow[] = []
  const checksRows: AttentionChecksRow[] = []
  const waitingAges: number[] = []

  for (const { issue, signal, divergence } of deliveries) {
    if (divergence === 'status_behind_merge') {
      divergenceRows.push({
        issueId: issue.id,
        issueKey: issueKeyOf(teamKey, issue),
        title: issue.title,
      })
      continue
    }
    if (issue.status !== 'canceled' && signal?.ciHealth === 'failing') {
      const failedAt = newestFailingCheckAt(issue)
      checksRows.push({
        issueId: issue.id,
        issueKey: issueKeyOf(teamKey, issue),
        title: issue.title,
        redForMs: failedAt === null ? null : Math.max(0, now - failedAt),
        ticks: checkTicks(issue),
      })
      continue
    }
    if (signal?.pr === 'open' && signal.reviewAgeMs !== null && signal.reviewAgeMs > DAY_MS) {
      waitingAges.push(signal.reviewAgeMs)
    }
  }

  waitingAges.sort((a, b) => b - a)
  const triageCount = triage.length
  const count = divergenceRows.length + checksRows.length + waitingAges.length + triageCount
  if (count === 0) return null

  return {
    count,
    divergence:
      divergenceRows.length === 0 ? null : { count: divergenceRows.length, rows: divergenceRows },
    checksFailing: checksRows.length === 0 ? null : { count: checksRows.length, rows: checksRows },
    waitingReview:
      waitingAges.length === 0 ? null : { count: waitingAges.length, agesMs: waitingAges },
    triage:
      triageCount === 0
        ? null
        : { count: triageCount, dotCount: Math.min(triageCount, TRIAGE_DOT_CAP) },
  }
}

function buildHeroCycle(
  cycle: TeamHomeCycleRow,
  cycleDeliveries: readonly IssueDelivery[],
  input: TeamHomeInput,
  frame: TeamFrameCycle,
  shipped: number,
  attentionCount: number,
): TeamHomeHeroCycle {
  const { dayIndex, dayCount } = frame

  const dayBand: DayBandSegment[] = Array.from({ length: dayCount }, (_, i) =>
    i + 1 < dayIndex ? 'past' : i + 1 === dayIndex ? 'today' : 'future',
  )

  // §D3 scope, per `metrics/scope.ts` semantics: added = assigned after the cycle started
  // (carry-ins stay committed), landed = done. Each issue draws exactly one band block.
  let committed = 0
  let landed = 0
  let added = 0
  const landedBlocks: 'landed'[] = []
  const openBlocks: 'open'[] = []
  const addedBlocks: 'added'[] = []
  for (const { issue } of cycleDeliveries) {
    const isAdded = issue.cycleAssignedAt != null && issue.cycleAssignedAt > cycle.startDate
    if (isAdded) added += 1
    else committed += 1
    if (issue.status === 'done') {
      landed += 1
      landedBlocks.push('landed')
    } else if (isAdded) addedBlocks.push('added')
    else openBlocks.push('open')
  }

  const digest = input.digest ?? null
  const cycleReport = digest?.status === 'ready' && digest.content != null
  const wrapped = input.retros.some((r) => r.cycleId === cycle.id && r.closedAt != null)
  const next = input.retros
    .filter((r) => r.closedAt == null)
    .map((r) => ({ retroId: r.id, title: r.title, phase: r.phase }))

  return {
    cycleId: cycle.id,
    title: frame.title,
    dayIndex,
    dayCount,
    endsWeekday: WEEKDAYS[new Date(cycle.endDate).getUTCDay()] as string,
    dayBand,
    daysLeft: dayCount - dayIndex,
    statusWords: {
      // Assigned from the frame's numbers, never recomputed — the deck, the statusline and the
      // hero agree because there is one place each of them is derived.
      shipped,
      inReview: cycleDeliveries.filter((d) => d.issue.status === 'in_review').length,
      needAttention: attentionCount,
    },
    scope: { committed, landed, added, band: [...landedBlocks, ...openBlocks, ...addedBlocks] },
    chips: { cycleReport, wrapped },
    next,
  }
}

// §D3 narrative: stored digest passthrough when ready, else at most two deterministic sentences
// over real counts. Never filler, never invented, never a model call.
function buildNarrative(
  digest: TeamHomeDigestRow | null,
  heroCycle: TeamHomeHeroCycle | null,
  cycleDeliveries: readonly IssueDelivery[],
  attention: TeamHomeAttention | null,
): TeamHomeNarrative | null {
  if (heroCycle === null) return null

  const headline = digest?.status === 'ready' ? digest.content?.headline?.trim() : undefined
  if (headline) return { source: 'digest', sentences: [headline] }

  const shipped = heroCycle.statusWords.shipped
  const live = cycleDeliveries.filter(
    (d) => d.issue.status === 'done' && d.signal?.deployedAt != null,
  ).length
  const daysLeft = heroCycle.daysLeft

  const sentences: string[] = []
  if (shipped > 0) {
    const liveClause = live > 0 ? `, ${live} already live` : ''
    sentences.push(
      `Day ${heroCycle.dayIndex} of ${heroCycle.dayCount} — ${shipped} ${plural(shipped, 'issue', 'issues')} shipped${liveClause}.`,
    )
  } else {
    sentences.push(
      `Day ${heroCycle.dayIndex} of ${heroCycle.dayCount} — nothing shipped yet, ${daysLeft} ${plural(daysLeft, 'day', 'days')} left.`,
    )
  }

  // The single most severe attention fact, in class precedence order (§D2).
  if (attention !== null) {
    if (attention.divergence !== null) {
      const first = attention.divergence.rows[0] as AttentionDivergenceRow
      sentences.push(`${first.issueKey} is done in git, but the board hasn't noticed.`)
    } else if (attention.checksFailing !== null) {
      const n = attention.checksFailing.count
      sentences.push(`Checks are failing on ${n} ${plural(n, 'change', 'changes')}.`)
    } else if (attention.waitingReview !== null) {
      const n = attention.waitingReview.count
      sentences.push(
        `${n} ${plural(n, 'change has', 'changes have')} waited over a day for review.`,
      )
    } else if (attention.triage !== null) {
      const n = attention.triage.count
      sentences.push(`${n} new ${plural(n, 'issue sits', 'issues sit')} in triage.`)
    }
  }

  return { source: 'computed', sentences }
}

// §D4 — a literal trailing 24h window; each card folds independently, the band folds when all do.
function buildSinceYesterday(
  input: TeamHomeInput,
  deliveries: readonly IssueDelivery[],
  now: number,
  viewerId: string,
  teamKey: string,
): TeamHomeSinceYesterday | null {
  const windowStart = now - DAY_MS

  const windowDeploys = input.deployments.filter(
    (d) => d.deployedAt != null && d.deployedAt > windowStart && d.deployedAt <= now,
  )
  let overnight: TeamHomeOvernight | null = null
  if (windowDeploys.length > 0) {
    const bySha = new Map<string, TeamHomeDeploymentRow>()
    for (const deploy of windowDeploys) {
      if (deploy.sha) bySha.set(`${deploy.repo} ${deploy.sha}`, deploy)
    }
    // Matching is by repo+sha KEY, not row identity: two window deployments of the same commit
    // both matched a done issue, so neither may fall back to the bare repo/environment line.
    const matchedKeys = new Set<string>()
    const lines: { text: string; atMs: number }[] = []
    for (const { issue } of deliveries) {
      if (issue.status !== 'done') continue
      for (const pr of linkedPrs(issue)) {
        if (pr.state !== 'merged' || !pr.mergeCommitSha || !pr.repo) continue
        const key = `${pr.repo} ${pr.mergeCommitSha}`
        const deploy = bySha.get(key)
        if (!deploy || deploy.deployedAt == null) continue
        matchedKeys.add(key)
        lines.push({ text: issue.title, atMs: deploy.deployedAt })
      }
    }
    for (const deploy of windowDeploys) {
      if (deploy.deployedAt == null) continue
      if (deploy.sha && matchedKeys.has(`${deploy.repo} ${deploy.sha}`)) continue
      lines.push({
        text: deploy.environment ? `${deploy.repo} · ${deploy.environment}` : deploy.repo,
        atMs: deploy.deployedAt,
      })
    }
    lines.sort((a, b) => a.atMs - b.atMs)
    const places = [...new Set(windowDeploys.map((d) => d.environment ?? d.repo))]
    overnight = {
      deployCount: windowDeploys.length,
      lines,
      provenance: `${windowDeploys.length} ${plural(windowDeploys.length, 'release', 'releases')} went live · ${places.join(' · ')}`,
    }
  }

  // Review outcomes on PRs linked to the viewer's OWN issues — the honest approximation of
  // "your PRs" (§D4); the row names the issue key so the derivation is on-surface.
  const reviewRows: TeamHomeReviewFact[] = []
  for (const { issue } of deliveries) {
    if (issue.assigneeId !== viewerId) continue
    for (const pr of linkedPrs(issue)) {
      for (const review of pr.reviews ?? []) {
        if (review.submittedAt <= windowStart || review.submittedAt > now) continue
        reviewRows.push({
          issueId: issue.id,
          issueKey: issueKeyOf(teamKey, issue),
          state: review.state,
          outcome: REVIEW_OUTCOME_LABEL[review.state],
          ageMs: now - review.submittedAt,
        })
      }
    }
  }
  reviewRows.sort((a, b) => a.ageMs - b.ageMs)
  const yourReview = reviewRows.length === 0 ? null : { rows: reviewRows }

  const inboxRows: TeamHomeInboxFact[] = input.notifications
    .filter(
      (n) =>
        n.teamId === input.team.id &&
        n.readAt == null &&
        n.createdAt > windowStart &&
        n.createdAt <= now,
    )
    .map((n) => ({
      kind: n.kind,
      title: n.subjectTitle,
      subjectKey: n.subjectKey ?? null,
      ageMs: now - n.createdAt,
    }))
    .sort((a, b) => a.ageMs - b.ageMs)
  const inbox = inboxRows.length === 0 ? null : { count: inboxRows.length, rows: inboxRows }

  const cardCount = [overnight, yourReview, inbox].filter((card) => card !== null).length
  if (cardCount === 0) return null
  return { overnight, yourReview, inbox, cardCount }
}

// §D5 — the viewer's own unfinished rows; the say/git bifact from a fixed predicate-keyed
// dictionary; rows whose PR awaits review collapse into the one-line waiting row.
function buildYours(
  deliveries: readonly IssueDelivery[],
  now: number,
  viewerId: string,
  teamKey: string,
): TeamHomeYours {
  const mine = deliveries
    .filter((d) => d.issue.assigneeId === viewerId && isUnfinished(d.issue.status))
    .sort((a, b) => b.issue.updatedAt - a.issue.updatedAt)

  const rows: TeamHomeYoursRow[] = []
  const waitingAges: number[] = []
  for (const { issue, signal, divergence } of mine) {
    // Checks-before-waiting, mirroring buildAttention's class precedence: an open PR with red
    // checks is the viewer's to fix, not a reviewer's to unblock, so it keeps its own row.
    if (signal?.pr === 'open' && signal.ciHealth !== 'failing') {
      if (signal.reviewAgeMs !== null) waitingAges.push(signal.reviewAgeMs)
      continue
    }
    // The shared dictionary, personal register. YOURS holds no phrase table of its own — the
    // strings it speaks and the strings the issue list speaks resolve from one classifier, so the
    // two surfaces cannot drift.
    const phrase = sayRestPhrase(issue.status, signal, divergence, 'personal')
    rows.push({
      issueId: issue.id,
      issueKey: issueKeyOf(teamKey, issue),
      title: issue.title,
      status: issue.status,
      strip:
        signal === null
          ? null
          : {
              pr: signal.pr,
              ci: signal.ciHealth,
              reviewAgeMs: signal.reviewAgeMs,
              reviewAgeFrom: signal.reviewAgeFrom,
              deployedAt: signal.deployedAt,
            },
      divergence,
      say: phrase.text ?? '',
      sayUrgent: phrase.urgent,
      git: gitLine(issue, signal, now),
    })
  }
  waitingAges.sort((a, b) => b - a)

  // Team-level reciprocal predicate: NO open PR on any of this team's issues awaits review.
  const anyAwaitingReview = deliveries.some(({ issue }) =>
    linkedPrs(issue).some((pr) => pr.state === 'open' && latestReviewOf(pr)?.state !== 'approved'),
  )

  return {
    count: mine.length,
    rows,
    waitingOnOthers:
      waitingAges.length === 0 ? null : { count: waitingAges.length, agesMs: waitingAges },
    noReviewsOwed: !anyAwaitingReview,
    footnote: YOURS_FOOTNOTE,
  }
}

// The mono git line: only facts the signal carries (§D5) — check state + age, PR open/approved/
// merged since. Empty when the issue has no linked delivery at all.
function gitLine(issue: TeamHomeIssueRow, signal: DeliverySignal | null, now: number): string {
  if (signal === null) return ''
  const parts: string[] = []
  if (signal.ciHealth === 'failing') {
    const failedAt = newestFailingCheckAt(issue)
    parts.push(
      failedAt === null ? 'checks red' : `red ${formatHomeAge(Math.max(0, now - failedAt))}`,
    )
  } else if (signal.ciHealth === 'passing') parts.push('checks green')
  else if (signal.ciHealth === 'pending') parts.push('checks running')

  const prs = linkedPrs(issue)
  const latestPr = prs.reduce<TeamHomePullRequestRow | undefined>(
    (latest, pr) => (latest === undefined || pr.openedAt > latest.openedAt ? pr : latest),
    undefined,
  )
  if (latestPr !== undefined) {
    if (signal.pr === 'approved') {
      const approved = (latestPr.reviews ?? [])
        .filter((r) => r.state === 'approved')
        .reduce<number | null>(
          (at, r) => (at === null || r.submittedAt > at ? r.submittedAt : at),
          null,
        )
      parts.push(
        approved === null ? 'approved' : `approved ${formatHomeAge(Math.max(0, now - approved))}`,
      )
    } else if (signal.pr === 'merged') {
      const mergedAt = latestPr.mergedAt ?? latestPr.openedAt
      parts.push(`merged ${formatHomeAge(Math.max(0, now - mergedAt))}`)
    } else if (signal.pr === 'open') {
      parts.push(`open ${formatHomeAge(Math.max(0, now - latestPr.openedAt))}`)
    } else if (signal.pr === 'draft') {
      parts.push(`draft ${formatHomeAge(Math.max(0, now - latestPr.openedAt))}`)
    }
  }
  if (signal.deployedAt != null) parts.push('live')
  return parts.join(' · ')
}

const PRIORITY_ORDER: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  no_priority: 4,
}

// §D6 — Runway only: unassigned, unblocked-by-definition rows of the active cycle; every phrase
// is the output of a real predicate, applied in precedence order.
function buildRunway(
  cycle: TeamHomeCycleRow,
  cycleDeliveries: readonly IssueDelivery[],
  teamKey: string,
): TeamHomeRunway | null {
  const rows = cycleDeliveries
    .filter(
      ({ issue }) =>
        issue.assigneeId == null && (issue.status === 'todo' || issue.status === 'backlog'),
    )
    .sort(
      (a, b) =>
        PRIORITY_ORDER[a.issue.priority] - PRIORITY_ORDER[b.issue.priority] ||
        a.issue.createdAt - b.issue.createdAt ||
        a.issue.id.localeCompare(b.issue.id),
    )
    .map(({ issue }) => {
      const urgent = issue.priority === 'urgent'
      const phrase = urgent
        ? 'Urgent — nothing blocks a start'
        : issue.rolledOverFromCycleId != null
          ? 'Carried in — pick it back up'
          : issue.cycleAssignedAt != null && issue.cycleAssignedAt > cycle.startDate
            ? 'Added mid-cycle'
            : 'Committed at planning'
      return {
        issueId: issue.id,
        issueKey: issueKeyOf(teamKey, issue),
        title: issue.title,
        priority: issue.priority,
        phrase,
        urgent,
      }
    })
  if (rows.length === 0) return null
  return { count: rows.length, rows }
}

// §D7 — UTC weekly deployment buckets, newest week last, retro ticks from closed retros.
// Folds when no deployment carries a production timestamp — pending/failed rows alone must not
// keep an all-zero chart alive.
function buildCadence(
  deployments: readonly TeamHomeDeploymentRow[],
  retros: readonly TeamHomeRetroRow[],
  now: number,
): TeamHomeCadence | null {
  if (!deployments.some((d) => d.deployedAt != null)) return null
  const currentWeekStart = utcWeekStart(now)
  const weeks: TeamHomeCadenceWeek[] = []
  let previousMonth: number | null = null
  for (let i = 0; i < CADENCE_WEEK_COUNT; i += 1) {
    const startMs = currentWeekStart - (CADENCE_WEEK_COUNT - 1 - i) * WEEK_MS
    const endMs = startMs + WEEK_MS
    const deploys = deployments.filter(
      (d) => d.deployedAt != null && d.deployedAt >= startMs && d.deployedAt < endMs,
    ).length
    const retro = retros.some(
      (r) => r.closedAt != null && r.closedAt >= startMs && r.closedAt < endMs,
    )
    const month = new Date(startMs).getUTCMonth()
    weeks.push({
      startMs,
      deploys,
      retro,
      monthLabel: month === previousMonth ? null : (MONTHS[month] as string),
    })
    previousMonth = month
  }
  return { weeks, todayIndex: CADENCE_WEEK_COUNT - 1 }
}

// §D8 — Live is the deploy fact from the merge-commit join, never a guess.
function buildShipped(
  cycleDeliveries: readonly IssueDelivery[],
  teamKey: string,
): TeamHomeShipped | null {
  const rows = cycleDeliveries
    .filter(({ issue }) => issue.status === 'done')
    .sort((a, b) => b.issue.updatedAt - a.issue.updatedAt)
    .map(({ issue, signal }) => ({
      issueId: issue.id,
      issueKey: issueKeyOf(teamKey, issue),
      title: issue.title,
      live: signal?.deployedAt != null,
    }))
  if (rows.length === 0) return null
  return { count: rows.length, rows }
}
