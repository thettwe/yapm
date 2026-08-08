import type { CiConclusion, CycleStatus, IssueStatus, ReviewState } from '../context.js'
import { compareCycles } from '../cycles.js'
import {
  assembleLinkedEntities,
  buildDeploymentIndex,
  computeDeliverySignal,
  computeDivergence,
  type DeliverySignal,
  type DeliveryStrip,
  type PrState,
} from '../delivery.js'
import { sayRestPhrase } from '../phrases.js'
import type { DeliveryMetric, DeliveryUnit } from './descriptors.js'
import {
  type DeliveryCycleInput,
  type DeliveryIssueInput,
  type DeliveryPrInput,
  HOUR_MS,
  plural,
  prCycleHours,
  prFirstReviewHours,
  pullRequests,
  round,
  scopeOfCycles,
} from './scope.js'
import { buildDeliveryWindow, clampDeliveryWindowSize } from './window.js'

// The WHOLE Delivery page as one model, computed in one place over rows the page already syncs, with
// the view left to draw it and format nothing. The `buildTeamHome` precedent, for the same reason: a
// page whose subject is honesty has to be able to PROVE its guarantees, and a guarantee proven
// against a model is structural where one proven against rendered HTML is a lint.
//
// Three properties are structural here rather than editorial:
//   1. No identity dimension at any depth. `review.author` is a real provider login sitting in a
//      synced table and nothing below reaches it; the tests walk the built object to assert that.
//   2. Every number comes from `scope.ts`/`window.ts`. This module decides WHICH scope, WHERE a mark
//      falls and WHAT the sentence says — never what a metric means.
//   3. Blank means blank. Every section is null when its data does not exist, so the view can render
//      nothing at all rather than an empty axis, which would be a claim that there is a shape to see.

// ---------------------------------------------------------------------------
// Input rows — structural, satisfied by the four queries the page already reads
// (`cycles.byTeam`, `issues.byTeam` with its linked-delivery subtree,
// `deployments.byTeam`, `retros.byTeam`).
// ---------------------------------------------------------------------------

export interface DeliveryPageCycleRow {
  readonly id: string
  readonly number?: number | null
  readonly name: string
  readonly status: CycleStatus
  readonly startDate: number
  readonly endDate: number
}

export interface DeliveryPagePullRequestRow {
  readonly id?: string | null
  readonly state: PrState
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly repo?: string | null
  readonly mergeCommitSha?: string | null
  readonly ciChecks?: readonly { readonly conclusion: CiConclusion }[]
  readonly reviews?: readonly { readonly state: ReviewState; readonly submittedAt: number }[]
}

export interface DeliveryPageIssueLinkRow {
  readonly pullRequest?: DeliveryPagePullRequestRow | null
}

export interface DeliveryPageIssueRow {
  readonly id: string
  readonly number?: number | null
  readonly title: string
  readonly status: IssueStatus
  readonly cycleId?: string | null
  readonly rolledOverFromCycleId?: string | null
  readonly carryoverCount?: number | null
  readonly cycleAssignedAt?: number | null
  readonly issueLinks?: readonly DeliveryPageIssueLinkRow[]
}

export interface DeliveryPageDeploymentRow {
  readonly repo: string
  readonly sha?: string | null
  readonly ref?: string | null
  readonly environment?: string | null
  readonly deployedAt?: number | null
}

export interface DeliveryPageRetroRow {
  readonly cycleId?: string | null
  readonly title: string
  readonly closedAt?: number | null
}

export interface DeliveryPageInput {
  readonly teamKey: string
  readonly cycles: readonly DeliveryPageCycleRow[]
  readonly issues: readonly DeliveryPageIssueRow[]
  readonly deployments: readonly DeliveryPageDeploymentRow[]
  readonly retros: readonly DeliveryPageRetroRow[]
  // The window, in COMPLETED CYCLES — never days. Four Delivered metrics are defined relative to a
  // cycle boundary, so "carried out of the last 30 days" is not a thing.
  readonly size: number
}

// ---------------------------------------------------------------------------
// Output model — identity-free by construction.
// ---------------------------------------------------------------------------

// The one place in the entire product this sentence appears (`ia.html` §"The word diet"): chrome, so
// it stays a label rather than becoming a paragraph, and it lives here rather than in the view
// because "appears exactly once" is only checkable when there is one place it is written.
export const BINDING_TEAM_LEVEL_RULE = 'team-level only — never a per-person number'

// The review rhythm's published cap and drawn axis. Both are model constants rather than magic
// numbers in a drawing or a test: the section states how many of how many it drew, and a row longer
// than the axis states its own duration instead of being silently clipped.
export const REVIEW_RHYTHM_CAP = 24
export const REVIEW_RHYTHM_AXIS_HOURS = 96

// A change that took this many times the median is an outlier — a stated multiple, so the callout is
// a rule over the data rather than a hand-picked pair of dots.
export const DISTRIBUTION_OUTLIER_MULTIPLE = 4

// The derivation of one number, in the two registers `ia.html` draws: a sentence saying how it was
// computed, and a mono line naming the constraints it was computed within.
export interface DeliveryPageHow {
  readonly label: string
  readonly body: string
  readonly constraint: string
}

export interface DeliveryPageStandfirst {
  // The cycle IN PROGRESS — a different scope from the window below it, which is why the page says
  // both. Null when no cycle is running.
  readonly cycleInProgress: string | null
  readonly window: string
  readonly rule: string
}

export interface DeliveryTimelineDeploy {
  readonly atMs: number
  readonly position: number
  readonly repo: string
  readonly ref: string | null
  readonly environment: string | null
}

export interface DeliveryTimelineRetroMark {
  readonly atMs: number
  readonly position: number
  readonly title: string
  readonly dayLabel: string
  readonly deploysBefore: number
  readonly deploysAfter: number
  // The two counts and the date, and NOTHING joining them: whether the retro caused the difference
  // is not a thing this product knows, and a page whose own subject is honesty does not get to guess.
  readonly counts: string
}

export interface DeliveryTimelineCallout {
  readonly atMs: number
  readonly position: number
  readonly headline: string
  readonly subline: string
  readonly weekCount: number
}

export interface DeliveryTimelineSection {
  readonly cycleId: string
  readonly title: string
  readonly startMs: number
  readonly endMs: number
  readonly startLabel: string
  readonly endLabel: string
  readonly dayIndex: number
  readonly dayCount: number
  readonly daysLeft: number
  readonly todayPosition: number
  readonly todayLabel: string
  readonly daysLeftLabel: string
  readonly deploys: readonly DeliveryTimelineDeploy[]
  readonly retros: readonly DeliveryTimelineRetroMark[]
  readonly callout: DeliveryTimelineCallout | null
  readonly markUnit: string
  readonly label: string
  readonly how: DeliveryPageHow
}

export type DeliveryStatKey = 'shipped' | 'pr_cycle_time' | 'ci_failing_rate' | 'issues_without_pr'

export type DeliveryStatMini = 'sparkline' | 'distribution' | 'ticks' | 'trend'

export interface DeliveryPageDelta {
  readonly value: number
  readonly magnitude: number
  readonly direction: 'up' | 'down' | 'flat'
  // The direction in WORDS, because a glyph and a colour are reinforcement and never the carrier.
  readonly words: string
  readonly sense: 'better' | 'worse' | 'neither'
  readonly spoken: string
}

export interface DeliveryStatReading {
  readonly key: DeliveryStatKey
  readonly label: string
  readonly value: number
  readonly unit: DeliveryUnit
  readonly unitSuffix: string
  // One entry per cycle in the window, oldest first, `undefined` where that cycle had nothing to
  // measure — the gap stays a gap so the drawing cannot re-space the survivors.
  readonly series: readonly (number | undefined)[]
  readonly delta: DeliveryPageDelta | null
  readonly betterWhen: 'lower' | 'higher' | null
  readonly mini: DeliveryStatMini
  readonly how: DeliveryPageHow
}

export interface DeliveryDistributionEntry {
  readonly changeId: string | null
  readonly hours: number
  readonly position: number
  readonly outlier: boolean
}

export interface DeliveryDistributionAnnotation {
  readonly kind: 'crowd' | 'outlier'
  readonly count: number
  readonly position: number
  readonly text: string
}

export interface DeliveryDistributionSection {
  readonly standfirst: string
  readonly entries: readonly DeliveryDistributionEntry[]
  readonly axisMaxHours: number
  readonly ticks: readonly number[]
  // The median as the page's OWN number, positioned by this axis — never a second computation, and
  // never a figure quoted from a summary while the dots come from another population.
  readonly medianHours: number
  readonly medianPosition: number
  readonly medianLabel: string
  readonly annotations: readonly DeliveryDistributionAnnotation[]
  readonly markUnit: string
  readonly label: string
  readonly how: DeliveryPageHow
}

export interface DeliveryFlowCycle {
  readonly cycleId: string
  readonly title: string
  readonly label: string
  readonly shipped: number
  readonly addedMidCycle: number
  readonly addedLabel: string | null
}

export interface DeliveryFlowCarry {
  readonly fromIndex: number
  readonly toIndex: number
  readonly count: number
  readonly label: string
}

export interface DeliveryFlowSection {
  readonly standfirst: string
  readonly cycles: readonly DeliveryFlowCycle[]
  readonly carries: readonly DeliveryFlowCarry[]
  readonly maxShipped: number
  readonly markUnit: string
  readonly label: string
  readonly how: DeliveryPageHow
}

export interface DeliveryRhythmChange {
  readonly changeId: string | null
  readonly openedAt: number
  readonly mergedAt: number
  readonly spanHours: number
  readonly spanLabel: string
  // Hours from open, oldest first. A review is a moment on this row and nothing else — there is no
  // reviewer field on this type, at any depth.
  readonly reviewOffsetsHours: readonly number[]
  readonly firstReviewHours: number | null
  readonly rounds: number
  readonly overAxis: boolean
}

export interface DeliveryRhythmSection {
  readonly standfirst: string | null
  readonly changes: readonly DeliveryRhythmChange[]
  readonly drawnCount: number
  readonly totalCount: number
  readonly cap: number
  readonly capLabel: string | null
  readonly axisMaxHours: number
  readonly markUnit: string
  readonly label: string
  readonly how: DeliveryPageHow
}

export interface DeliveryPeekSubject {
  readonly issueId: string
  readonly issueKey: string
  readonly title: string
  readonly status: IssueStatus
  readonly cycleName: string | null
  readonly phrase: string
  readonly urgent: boolean
  readonly strip: DeliveryStrip
  readonly mergedAt: number | null
  // Where the chip sits on the timeline, or null when the merge happened outside the cycle in
  // progress (or there is no cycle in progress to sit on).
  readonly position: number | null
  readonly classCount: number
  readonly classLabel: string
}

export interface DeliveryPageHonesty {
  readonly line: string
  readonly more: readonly string[]
}

export type DeliveryPageSection =
  | 'stats'
  | 'stats_how'
  | 'distribution'
  | 'flow'
  | 'rhythm'
  | 'timeline'

export interface DeliveryMetricPlacement {
  readonly metricKey: string
  readonly section: DeliveryPageSection
  readonly place: string
  // Whether that section rendered for THIS input. The mapping is total either way — a definition
  // that has a home is not the same claim as a definition that was drawn today.
  readonly drawn: boolean
}

export interface DeliveryPageModel {
  readonly teamKey: string
  readonly windowLabel: string
  readonly cycleCount: number
  readonly standfirst: DeliveryPageStandfirst
  readonly timeline: DeliveryTimelineSection | null
  readonly stats: readonly DeliveryStatReading[]
  // Said ONCE when a whole family of readings is missing because no connector has fed anything in —
  // never once per absent drawing, and never instead of a section that does have data. It is the
  // measurement scope's OWN empty-state sentence, so this page and the retrospective's panel name
  // the same thing in the same words.
  readonly flowAbsence: string | null
  readonly distribution: DeliveryDistributionSection | null
  readonly flow: DeliveryFlowSection | null
  readonly rhythm: DeliveryRhythmSection | null
  readonly peek: DeliveryPeekSubject | null
  readonly honesty: DeliveryPageHonesty
  readonly metricMap: readonly DeliveryMetricPlacement[]
}

// ---------------------------------------------------------------------------
// Calendar and axis helpers. Declared here rather than imported from
// `team-home.ts`: the same Zero rows satisfy both modules and neither imports
// the other, which is what keeps the two page models independent.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000

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

// Monday-based UTC week start (epoch day 0 was a Thursday, three days after a Monday) — the same
// week boundary Home's cadence chart buckets by, so "that week" means one thing in this product.
function utcWeekStart(ms: number): number {
  const day = utcDayIndex(ms)
  return (day - ((day + 3) % 7)) * DAY_MS
}

function dayLabel(ms: number): string {
  const date = new Date(ms)
  return `${MONTHS[date.getUTCMonth()] as string} ${date.getUTCDate()}`
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

const UNIT_SUFFIX: Record<DeliveryUnit, string> = { count: '', hours: 'h', percent: '%' }

// A readable linear axis: the smallest step from a fixed ladder that covers the data in at most five
// intervals, so the ticks are round numbers and the largest observed value is INSIDE the axis. No
// log scale, no clipping, no "other" bucket — each would hide the shape the section exists to show.
const AXIS_STEPS = [1, 2, 3, 6, 12, 24, 48, 96, 168, 336, 720, 1680] as const
const AXIS_INTERVALS = 5

function linearAxis(maxValue: number): { readonly max: number; readonly ticks: readonly number[] } {
  const step =
    AXIS_STEPS.find((candidate) => Math.ceil(maxValue / candidate) <= AXIS_INTERVALS) ??
    Math.max(1, Math.ceil(maxValue / AXIS_INTERVALS))
  const intervals = Math.max(1, Math.ceil(maxValue / step))
  const max = step * intervals
  const ticks: number[] = []
  for (let tick = 0; tick <= max; tick += step) ticks.push(tick)
  return { max, ticks }
}

function windowClause(cycleCount: number): string {
  return `last ${cycleCount} completed ${plural(cycleCount, 'cycle', 'cycles')}`
}

function issueKeyOf(teamKey: string, issue: DeliveryPageIssueRow): string {
  return issue.number == null ? `${teamKey}‑…` : `${teamKey}-${issue.number}`
}

function cycleTitle(cycle: DeliveryPageCycleRow): string {
  if (cycle.name.trim() !== '') return cycle.name
  return cycle.number == null ? 'Cycle …' : `Cycle ${cycle.number}`
}

// ---------------------------------------------------------------------------
// The projection: synced rows -> the measurement scope's inputs. The web app
// keeps its own projection for the retrospective's panel; the POPULATION rule
// (one entry per change) lives once, in `pullRequests(scope)`, so two
// projections can never produce two populations.
// ---------------------------------------------------------------------------

function linkedPrs(issue: DeliveryPageIssueRow): readonly DeliveryPagePullRequestRow[] {
  return (issue.issueLinks ?? []).flatMap((link) => (link.pullRequest ? [link.pullRequest] : []))
}

function prInputOf(pr: DeliveryPagePullRequestRow): DeliveryPrInput {
  return {
    id: pr.id ?? undefined,
    openedAt: pr.openedAt,
    mergedAt: pr.mergedAt ?? null,
    reviewSubmittedAt: (pr.reviews ?? []).map((review) => review.submittedAt),
    ciConclusions: (pr.ciChecks ?? []).map((check) => check.conclusion),
  }
}

function deliveryIssueOf(issue: DeliveryPageIssueRow): DeliveryIssueInput {
  return {
    id: issue.id,
    status: issue.status,
    cycleId: issue.cycleId ?? null,
    rolledOverFromCycleId: issue.rolledOverFromCycleId ?? null,
    carryoverCount: issue.carryoverCount ?? 0,
    cycleAssignedAt: issue.cycleAssignedAt ?? null,
    pullRequests: linkedPrs(issue).map(prInputOf),
  }
}

// Every issue that TOUCHED a cycle: the ones still pointing at it plus the ones the rollover carried
// out of it, which no longer point at it but kept the origin marker.
function deliveryCycleOf(
  cycle: DeliveryPageCycleRow,
  issues: readonly DeliveryPageIssueRow[],
): DeliveryCycleInput {
  return {
    id: cycle.id,
    name: cycle.name,
    startDate: cycle.startDate,
    issues: issues
      .filter(
        (issue) =>
          (issue.cycleId ?? null) === cycle.id ||
          (issue.rolledOverFromCycleId ?? null) === cycle.id,
      )
      .map(deliveryIssueOf),
  }
}

// Exported so one caller can build the EXACT scope the page's numbers are read from — which is how a
// test proves the median drawn on the distribution is the measure's own and not a second computation.
export function deliveryCyclesOf(
  cycles: readonly DeliveryPageCycleRow[],
  issues: readonly DeliveryPageIssueRow[],
): readonly DeliveryCycleInput[] {
  return cycles.map((cycle) => deliveryCycleOf(cycle, issues))
}

// ---------------------------------------------------------------------------
// The model.
// ---------------------------------------------------------------------------

export function buildDeliveryPage(input: DeliveryPageInput, now: number): DeliveryPageModel | null {
  const ordered = [...input.cycles].sort(compareCycles)
  const completed = ordered.filter((cycle) => cycle.status === 'completed')
  const size = clampDeliveryWindowSize(input.size)
  const windowRows = completed.slice(-size)
  const priorRows = completed.slice(-(size * 2), -size)

  // Projected once: the window's numbers and the page's drawings read the SAME cycle inputs, so
  // neither can end up measuring a population the other did not.
  const windowCycles = deliveryCyclesOf(windowRows, input.issues)
  const window = buildDeliveryWindow({
    cycles: windowCycles,
    priorCycles: deliveryCyclesOf(priorRows, input.issues),
    size,
  })
  // No completed cycle at all: the page has nothing to read, and the view keeps its one whole-page
  // empty state rather than being handed a model of nulls to draw around.
  if (window === null) return null

  const metrics = new Map<string, DeliveryMetric>()
  for (const section of window.sections) {
    for (const metric of section.metrics) metrics.set(metric.key, metric)
  }

  const flowSection = window.sections.find((section) => section.key === 'flow')
  const flowAbsence =
    flowSection?.state === 'empty' ? (flowSection.emptyState?.detail ?? null) : null

  const cycleCount = window.cycleCount
  const clause = windowClause(cycleCount)
  const activeCycle = ordered.find((cycle) => cycle.status === 'active') ?? null

  const population = pullRequests(scopeOfCycles(windowCycles))
  const merged = population.filter((pr) => prCycleHours(pr) !== undefined)

  const timeline = activeCycle === null ? null : buildTimeline(activeCycle, input, now, cycleCount)
  const stats = buildStats(metrics, clause, merged.length)
  const distribution = buildDistribution(metrics, merged, clause)
  const flow = buildFlow(metrics, windowRows, input.issues, clause)
  const rhythm = buildRhythm(metrics, merged, clause)
  const peek = buildPeek(input, now, activeCycle)

  return {
    teamKey: input.teamKey,
    windowLabel: window.label,
    cycleCount,
    standfirst: {
      cycleInProgress: activeCycle === null ? null : cycleTitle(activeCycle),
      window: clause,
      rule: BINDING_TEAM_LEVEL_RULE,
    },
    timeline,
    stats,
    flowAbsence,
    distribution,
    flow,
    rhythm,
    peek,
    honesty: HONESTY,
    metricMap: metricMap({
      statsDrawn: stats.length > 0,
      distributionDrawn: distribution !== null,
      flowDrawn: flow !== null,
      rhythmDrawn: rhythm !== null,
    }),
  }
}

// ---------------------------------------------------------------------------
// The annotated timeline — the CYCLE IN PROGRESS, which is the one drawing on
// the page not scoped to the completed-cycle window.
// ---------------------------------------------------------------------------

function buildTimeline(
  cycle: DeliveryPageCycleRow,
  input: DeliveryPageInput,
  now: number,
  cycleCount: number,
): DeliveryTimelineSection {
  const startMs = cycle.startDate
  const endMs = Math.max(cycle.endDate, cycle.startDate)
  const span = Math.max(1, endMs - startMs)
  const position = (atMs: number) => clamp01((atMs - startMs) / span)

  // A deployment that never reached production is not a deployment of anything: `deployed_at` is
  // written once, the moment it first succeeded, so its presence IS the success test.
  const deploys: DeliveryTimelineDeploy[] = input.deployments
    .filter(
      (deploy) =>
        deploy.deployedAt != null && deploy.deployedAt >= startMs && deploy.deployedAt <= endMs,
    )
    .map((deploy) => ({
      atMs: deploy.deployedAt as number,
      position: position(deploy.deployedAt as number),
      repo: deploy.repo,
      ref: deploy.ref ?? null,
      environment: deploy.environment ?? null,
    }))
    .sort(
      (a, b) =>
        a.atMs - b.atMs || a.repo.localeCompare(b.repo) || (a.ref ?? '').localeCompare(b.ref ?? ''),
    )

  const retros: DeliveryTimelineRetroMark[] = input.retros
    .filter(
      (retro) => retro.closedAt != null && retro.closedAt >= startMs && retro.closedAt <= endMs,
    )
    .map((retro) => {
      const closedAt = retro.closedAt as number
      const before = deploys.filter((deploy) => deploy.atMs < closedAt).length
      const after = deploys.length - before
      return {
        atMs: closedAt,
        position: position(closedAt),
        title: retro.title,
        dayLabel: dayLabel(closedAt),
        deploysBefore: before,
        deploysAfter: after,
        counts: `${before} before ${dayLabel(closedAt)} · ${after} after`,
      }
    })
    .sort((a, b) => a.atMs - b.atMs || a.title.localeCompare(b.title))

  const startDay = utcDayIndex(startMs)
  const dayCount = Math.max(1, utcDayIndex(endMs) - startDay + 1)
  const dayIndex = Math.min(dayCount, Math.max(1, utcDayIndex(now) - startDay + 1))
  const daysLeft = dayCount - dayIndex

  return {
    cycleId: cycle.id,
    title: cycleTitle(cycle),
    startMs,
    endMs,
    startLabel: dayLabel(startMs),
    endLabel: dayLabel(endMs),
    dayIndex,
    dayCount,
    daysLeft,
    todayPosition: position(now),
    todayLabel: `today · day ${dayIndex} of ${dayCount}`,
    daysLeftLabel: `${daysLeft} ${plural(daysLeft, 'day', 'days')} left`,
    deploys,
    retros,
    callout: calloutOf(deploys),
    markUnit: 'one dot is one deployment that reached production',
    label: `${cycleTitle(cycle)}, ${dayLabel(startMs)} to ${dayLabel(endMs)}: ${deploys.length} ${plural(deploys.length, 'deployment', 'deployments')} reached production and ${retros.length} ${plural(retros.length, 'retrospective closed', 'retrospectives closed')}; one dot is one deployment; today is day ${dayIndex} of ${dayCount}`,
    how: {
      label: 'the cycle in progress',
      body: `One dot per deployment that reached production inside ${cycleTitle(cycle)}, at the moment it reached it, and a mark where a retrospective closed. The counts either side of that date are counts either side of a date, not a claim that one caused the other. The numbers below read the ${windowClause(cycleCount)} instead.`,
      constraint: 'the cycle in progress · successful deployments only · team-level only',
    },
  }
}

// The called-out deployment: the FIRST successful deployment of the ISO week, inside the cycle, that
// carried the most successful deployments; ties break to the earliest week. "Interesting" has to
// become a rule or it becomes a hand-authored string — and a rule is stable across renders and
// testable. The headline names what the row actually carries and invents nothing when it carries
// nothing.
function calloutOf(deploys: readonly DeliveryTimelineDeploy[]): DeliveryTimelineCallout | null {
  if (deploys.length === 0) return null
  const weeks = new Map<number, DeliveryTimelineDeploy[]>()
  for (const deploy of deploys) {
    const week = utcWeekStart(deploy.atMs)
    const entries = weeks.get(week)
    if (entries === undefined) weeks.set(week, [deploy])
    else entries.push(deploy)
  }

  let best: { readonly week: number; readonly entries: readonly DeliveryTimelineDeploy[] } | null =
    null
  for (const [week, entries] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
    if (best === null || entries.length > best.entries.length) best = { week, entries }
  }
  if (best === null) return null

  const first = best.entries[0] as DeliveryTimelineDeploy
  const count = best.entries.length
  return {
    atMs: first.atMs,
    position: first.position,
    headline: first.ref === null ? 'A deployment went out here' : `${first.ref} went out here`,
    subline: `${dayLabel(first.atMs)} · first of ${count} that week`,
    weekCount: count,
  }
}

// ---------------------------------------------------------------------------
// The four stat readings. Every value, series and delta is the metric's own —
// this decides only which four are stated, which mini is drawn beside each, and
// how each derivation reads.
// ---------------------------------------------------------------------------

const STAT_MINIS: Record<DeliveryStatKey, DeliveryStatMini> = {
  shipped: 'sparkline',
  pr_cycle_time: 'distribution',
  ci_failing_rate: 'ticks',
  issues_without_pr: 'trend',
}

const STAT_LABELS: Record<DeliveryStatKey, string> = {
  shipped: 'Shipped',
  pr_cycle_time: 'Open to merged',
  ci_failing_rate: 'Checks failing',
  issues_without_pr: 'Not linked to a change',
}

const STAT_ORDER: readonly DeliveryStatKey[] = [
  'shipped',
  'pr_cycle_time',
  'ci_failing_rate',
  'issues_without_pr',
]

function deltaOf(metric: DeliveryMetric, clause: string): DeliveryPageDelta | null {
  if (metric.delta === null) return null
  const magnitude = Math.abs(metric.delta)
  const direction = metric.delta === 0 ? 'flat' : metric.delta > 0 ? 'up' : 'down'
  const suffix = UNIT_SUFFIX[metric.unit]
  const words = direction === 'flat' ? 'no change' : `${direction} ${magnitude}${suffix}`
  const sense =
    metric.betterWhen === null || direction === 'flat'
      ? 'neither'
      : (metric.betterWhen === 'lower') === (direction === 'down')
        ? 'better'
        : 'worse'
  const against = `against the previous ${clause.replace('last ', '')}`
  return {
    value: metric.delta,
    magnitude,
    direction,
    words,
    sense,
    spoken: sense === 'neither' ? `${words} ${against}` : `${words} ${against} — ${sense}`,
  }
}

function statHow(
  key: DeliveryStatKey,
  metrics: ReadonlyMap<string, DeliveryMetric>,
  clause: string,
  mergedCount: number,
): DeliveryPageHow {
  switch (key) {
    case 'shipped': {
      // `total` and `canceled` have no tile of their own and this is their home: the number a reader
      // needs to know what "52 shipped" is 52 OF.
      const total = metrics.get('total')?.value
      const canceled = metrics.get('canceled')?.value
      const scopeClause =
        total === undefined
          ? `Issues that reached done across the ${clause}`
          : `Of the ${total} distinct ${plural(total, 'issue', 'issues')} that touched the ${clause}, carried work included, the ones that reached done`
      const canceledClause =
        canceled === undefined
          ? ''
          : ` ${canceled} ${plural(canceled, 'was', 'were')} canceled instead.`
      return {
        label: STAT_LABELS.shipped,
        body: `${scopeClause}.${canceledClause}`,
        constraint: 'completed cycles only · one issue counted once · team-level only',
      }
    }
    case 'pr_cycle_time':
      return {
        label: STAT_LABELS.pr_cycle_time,
        body: `Median of the ${mergedCount} merged ${plural(mergedCount, 'change', 'changes')} in the ${clause}, opened → merged, drawn where it falls — not quoted from a summary.`,
        constraint: 'linear scale · giants included · team-level only',
      }
    case 'ci_failing_rate':
      return {
        label: STAT_LABELS.ci_failing_rate,
        body: `The share of changes carrying at least one check that had a failing one, across the ${clause}. A change with no checks at all is not in the denominator, and one change linked to two issues is counted once.`,
        constraint: 'checks rolled up per change · one change counted once · team-level only',
      }
    default:
      return {
        label: STAT_LABELS.issues_without_pr,
        body: `Issues in the ${clause} with no linked pull request. The change may exist and simply not be linked — a pull request reaches this page only through an issue.`,
        constraint: 'issues in scope · linked through the issue subtree · team-level only',
      }
  }
}

function buildStats(
  metrics: ReadonlyMap<string, DeliveryMetric>,
  clause: string,
  mergedCount: number,
): readonly DeliveryStatReading[] {
  const readings: DeliveryStatReading[] = []
  for (const key of STAT_ORDER) {
    const metric = metrics.get(key)
    // A metric with nothing behind it is omitted rather than reported as a zero.
    if (metric === undefined) continue
    readings.push({
      key,
      label: STAT_LABELS[key],
      value: metric.value,
      unit: metric.unit,
      unitSuffix: UNIT_SUFFIX[metric.unit],
      series: metric.trend,
      delta: deltaOf(metric, clause),
      betterWhen: metric.betterWhen,
      mini: STAT_MINIS[key],
      how: statHow(key, metrics, clause, mergedCount),
    })
  }
  return readings
}

// ---------------------------------------------------------------------------
// OPEN TO MERGED — one dot per distinct merged change, the median where it
// falls, and the giants named rather than hidden.
// ---------------------------------------------------------------------------

function buildDistribution(
  metrics: ReadonlyMap<string, DeliveryMetric>,
  merged: readonly DeliveryPrInput[],
  clause: string,
): DeliveryDistributionSection | null {
  const medianHours = metrics.get('pr_cycle_time')?.value
  if (merged.length === 0 || medianHours === undefined) return null

  // Positions and counts are read off the EXACT duration; only the stated number is rounded, so a
  // dot never sits at a place its own label contradicts.
  const exact = merged
    .map((pr) => ({ changeId: pr.id ?? null, exact: prCycleHours(pr) as number }))
    .sort((a, b) => a.exact - b.exact || (a.changeId ?? '').localeCompare(b.changeId ?? ''))
  const maxHours = exact.reduce((max, entry) => Math.max(max, entry.exact), 0)
  const axis = linearAxis(Math.max(maxHours, medianHours))
  const outlierFrom = medianHours * DISTRIBUTION_OUTLIER_MULTIPLE

  const entries: DeliveryDistributionEntry[] = exact.map((entry) => ({
    changeId: entry.changeId,
    hours: round(entry.exact),
    position: clamp01(entry.exact / axis.max),
    outlier: entry.exact >= outlierFrom && entry.exact > medianHours,
  }))

  const inside = exact.filter((entry) => entry.exact <= medianHours)
  const outliers = exact.filter((entry) => entry.exact >= outlierFrom && entry.exact > medianHours)
  const annotations: DeliveryDistributionAnnotation[] = [
    {
      kind: 'crowd',
      count: inside.length,
      position: clamp01(medianHours / axis.max),
      text: `${inside.length} of ${entries.length} merged inside ${medianHours}h`,
    },
  ]
  if (outliers.length > 0) {
    const slowest = outliers.reduce((min, entry) => Math.min(min, entry.exact), Number.MAX_VALUE)
    annotations.push({
      kind: 'outlier',
      count: outliers.length,
      position: clamp01(slowest / axis.max),
      text: `${outliers.length} ${plural(outliers.length, 'change', 'changes')} waited ${round(slowest)}h or more`,
    })
  }

  const outlierClause =
    outliers.length === 0
      ? ''
      : ` — ${outliers.length} ${plural(outliers.length, 'change', 'changes')} waited ${DISTRIBUTION_OUTLIER_MULTIPLE} times that or longer`
  return {
    standfirst: `${inside.length} of the ${entries.length} merged ${plural(entries.length, 'change', 'changes')} in the ${clause} went from open to merged inside ${medianHours} ${plural(medianHours, 'hour', 'hours')}${outlierClause}.`,
    entries,
    axisMaxHours: axis.max,
    ticks: axis.ticks,
    medianHours,
    medianPosition: clamp01(medianHours / axis.max),
    medianLabel: `median ${medianHours}h`,
    annotations,
    markUnit: 'one dot is one merged pull request',
    label: `${entries.length} merged ${plural(entries.length, 'change', 'changes')} by hours from open to merged, on a linear axis to ${axis.max} hours; one dot is one merged pull request; median ${medianHours} hours`,
    how: {
      label: 'open to merged',
      body: `Median of the ${entries.length} merged ${plural(entries.length, 'change', 'changes')} in the ${clause}, opened → merged, drawn where it falls — not quoted from a summary.`,
      constraint: 'linear scale · giants included · team-level only',
    },
  }
}

// ---------------------------------------------------------------------------
// CYCLE FLOW — bars per cycle, the carried work drawn between them.
// ---------------------------------------------------------------------------

// One cycle's entry of a per-cycle series. Falling back to zero is only ever reached for a Delivered
// count, which is defined for every cycle in the window — a cycle that shipped nothing shipped zero,
// where a FLOW measure with nothing behind it is `undefined` and is never read through here.
function seriesAt(metric: DeliveryMetric | undefined, index: number): number {
  return metric?.trend[index] ?? 0
}

function buildFlow(
  metrics: ReadonlyMap<string, DeliveryMetric>,
  windowRows: readonly DeliveryPageCycleRow[],
  issues: readonly DeliveryPageIssueRow[],
  clause: string,
): DeliveryFlowSection | null {
  if (windowRows.length === 0) return null
  const shippedMetric = metrics.get('shipped')
  const addedMetric = metrics.get('added_mid_cycle')

  const cycles: DeliveryFlowCycle[] = windowRows.map((cycle, index) => {
    const ago = windowRows.length - 1 - index
    const added = seriesAt(addedMetric, index)
    return {
      cycleId: cycle.id,
      title: cycleTitle(cycle),
      label: ago === 0 ? 'last' : `${ago} ago`,
      shipped: seriesAt(shippedMetric, index),
      addedMidCycle: added,
      addedLabel: added === 0 ? null : `+${added} added`,
    }
  })

  // The carry a ribbon draws is the per-cycle carry-out NARROWED to the successor cycle in the
  // window: which cycle the work landed in is a fact no aggregate carries, and a carry that left the
  // window has no second bar to reach, so it draws no ribbon and is stated in the derivation instead.
  const carries: DeliveryFlowCarry[] = []
  for (let index = 0; index + 1 < windowRows.length; index += 1) {
    const from = windowRows[index] as DeliveryPageCycleRow
    const to = windowRows[index + 1] as DeliveryPageCycleRow
    const count = issues.filter(
      (issue) =>
        (issue.rolledOverFromCycleId ?? null) === from.id && (issue.cycleId ?? null) === to.id,
    ).length
    if (count === 0) continue
    carries.push({
      fromIndex: index,
      toIndex: index + 1,
      count,
      label: `${count} carried`,
    })
  }

  const twicePlus = metrics.get('carried_twice_plus')?.value ?? 0
  const twiceClause =
    twicePlus === 0
      ? ''
      : ` ${twicePlus} ${plural(twicePlus, 'item has', 'items have')} carried twice or more.`

  const last = carries.at(-1)
  const previous = carries.at(-2)
  let standfirst: string
  if (last === undefined) {
    standfirst = `Nothing carried from one of these ${windowRows.length} ${plural(windowRows.length, 'cycle', 'cycles')} into the next.${twiceClause}`
  } else if (previous === undefined) {
    const fromTitle = (cycles[last.fromIndex] as DeliveryFlowCycle).title
    const toTitle = (cycles[last.toIndex] as DeliveryFlowCycle).title
    standfirst = `${last.count} ${plural(last.count, 'item', 'items')} carried from ${fromTitle} into ${toTitle}.${twiceClause}`
  } else {
    const trend =
      last.count < previous.count
        ? 'Carryover is shrinking'
        : last.count > previous.count
          ? 'Carryover is growing'
          : 'Carryover is holding steady'
    standfirst = `${trend} — ${last.count} ${plural(last.count, 'item', 'items')} carried out of the last cycle where ${previous.count} carried out of the one before.${twiceClause}`
  }

  const carriedIn = metrics.get('carried_in')?.value ?? 0
  const carriedOut = metrics.get('carried_out')?.value ?? 0
  const maxShipped = cycles.reduce((max, cycle) => Math.max(max, cycle.shipped), 0)

  return {
    standfirst,
    cycles,
    carries,
    maxShipped,
    markUnit: 'one bar is one completed cycle; a ribbon is work the rollover carried into the next',
    label: `Shipped per cycle across the ${clause}: ${cycles.map((cycle) => `${cycle.title} ${cycle.shipped}`).join(', ')}; one bar is one cycle, a ribbon is work carried into the next cycle, a cap is work added after that cycle started`,
    how: {
      label: 'cycle flow',
      body: `One bar per completed cycle showing what it shipped; a ribbon is work the rollover carried from one of these cycles into the next; a cap is work added after that cycle had started. Across the ${clause}, ${carriedIn} ${plural(carriedIn, 'item', 'items')} carried in from before the window and ${carriedOut} carried out past its end.${twiceClause}`,
      constraint: 'completed cycles only · one issue counted once · team-level only',
    },
  }
}

// ---------------------------------------------------------------------------
// REVIEW RHYTHM — one small multiple per merged change, and no reviewer.
// ---------------------------------------------------------------------------

function buildRhythm(
  metrics: ReadonlyMap<string, DeliveryMetric>,
  merged: readonly DeliveryPrInput[],
  clause: string,
): DeliveryRhythmSection | null {
  if (merged.length === 0) return null

  const changes: DeliveryRhythmChange[] = [...merged]
    .sort(
      (a, b) =>
        (b.mergedAt as number) - (a.mergedAt as number) || (a.id ?? '').localeCompare(b.id ?? ''),
    )
    .slice(0, REVIEW_RHYTHM_CAP)
    .map((pr) => {
      const spanHours = round(prCycleHours(pr) as number)
      const offsets = [...(pr.reviewSubmittedAt ?? [])]
        .sort((a, b) => a - b)
        .map((submittedAt) => round((submittedAt - pr.openedAt) / HOUR_MS))
        .filter((offset) => offset >= 0)
      const first = prFirstReviewHours(pr)
      return {
        changeId: pr.id ?? null,
        openedAt: pr.openedAt,
        mergedAt: pr.mergedAt as number,
        spanHours,
        spanLabel: `${spanHours}h`,
        reviewOffsetsHours: offsets,
        firstReviewHours: first === undefined ? null : round(first),
        rounds: offsets.length,
        overAxis: spanHours > REVIEW_RHYTHM_AXIS_HOURS,
      }
    })

  const firstReview = metrics.get('time_to_first_review')?.value
  const rounds = metrics.get('review_rounds')?.value
  let standfirst: string | null = null
  if (firstReview !== undefined && rounds !== undefined) {
    standfirst = `A first review arrived a median of ${firstReview}h after a change opened, and reviews came back a median of ${rounds} ${plural(rounds, 'time', 'times')} per change.`
  } else if (firstReview !== undefined) {
    standfirst = `A first review arrived a median of ${firstReview}h after a change opened.`
  } else if (rounds !== undefined) {
    standfirst = `Reviews came back a median of ${rounds} ${plural(rounds, 'time', 'times')} per change.`
  }

  return {
    standfirst,
    changes,
    drawnCount: changes.length,
    totalCount: merged.length,
    cap: REVIEW_RHYTHM_CAP,
    capLabel:
      merged.length > changes.length ? `showing ${changes.length} of ${merged.length}` : null,
    axisMaxHours: REVIEW_RHYTHM_AXIS_HOURS,
    markUnit: 'one row is one merged pull request, from its open to its merge',
    label: `Review rhythm for ${changes.length} of ${merged.length} merged ${plural(merged.length, 'change', 'changes')} in the ${clause}; one row is one merged pull request from open to merge, with a mark for each review that came back`,
    how: {
      label: 'review rhythm',
      body: `Each row is one merged change: where it opened, when a review came back, and when it merged, on an axis of ${REVIEW_RHYTHM_AXIS_HOURS} hours — a change that ran longer states its own duration rather than being clipped. The medians are over the ${merged.length} merged ${plural(merged.length, 'change', 'changes')} in the ${clause}.`,
      constraint: `newest ${REVIEW_RHYTHM_CAP} changes · no reviewer is named · team-level only`,
    },
  }
}

// ---------------------------------------------------------------------------
// The one peek — the divergence class this product already computes.
// ---------------------------------------------------------------------------

function buildPeek(
  input: DeliveryPageInput,
  now: number,
  activeCycle: DeliveryPageCycleRow | null,
): DeliveryPeekSubject | null {
  const deployIndex = buildDeploymentIndex(input.deployments)
  const diverged: {
    readonly issue: DeliveryPageIssueRow
    readonly signal: DeliverySignal
    readonly mergedAt: number | null
  }[] = []

  for (const issue of input.issues) {
    // The deploy fact comes from the §D3 merge-commit join, built once for the whole team here rather
    // than re-derived per row.
    const linked = assembleLinkedEntities(issue.issueLinks ?? [], deployIndex)
    const signal = computeDeliverySignal(issue, linked, now)
    if (signal === null) continue
    if (computeDivergence(issue.status, signal) !== 'status_behind_merge') continue
    const mergedAt = linkedPrs(issue)
      .filter((pr) => pr.state === 'merged' && pr.mergedAt != null)
      .reduce<number | null>(
        (newest, pr) =>
          newest === null || (pr.mergedAt as number) > newest ? (pr.mergedAt as number) : newest,
        null,
      )
    diverged.push({ issue, signal, mergedAt })
  }
  if (diverged.length === 0) return null

  // The newest merge is the one worth asking about; ties break by id so the chip is the same chip on
  // every render.
  const subject = [...diverged].sort(
    (a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0) || a.issue.id.localeCompare(b.issue.id),
  )[0] as (typeof diverged)[number]
  const issue = subject.issue
  const signal = subject.signal
  const strip: DeliveryStrip = {
    pr: signal.pr,
    ci: signal.ciHealth,
    reviewAgeMs: signal.reviewAgeMs,
    reviewAgeFrom: signal.reviewAgeFrom,
    deployedAt: signal.deployedAt,
  }
  // The shared dictionary, neutral register: the peek answers "what is this?" in the words the rest
  // of the product already uses for this predicate, and writes no sentence of its own.
  const phrase = sayRestPhrase(issue.status, signal, 'status_behind_merge', 'neutral')
  const cycle = input.cycles.find((row) => row.id === (issue.cycleId ?? null)) ?? null
  const insideCycle =
    activeCycle !== null &&
    subject.mergedAt !== null &&
    subject.mergedAt >= activeCycle.startDate &&
    subject.mergedAt <= activeCycle.endDate

  return {
    issueId: issue.id,
    issueKey: issueKeyOf(input.teamKey, issue),
    title: issue.title,
    status: issue.status,
    cycleName: cycle === null ? null : cycleTitle(cycle),
    phrase: phrase.text ?? '',
    urgent: phrase.urgent,
    strip,
    mergedAt: subject.mergedAt,
    position:
      insideCycle && activeCycle !== null
        ? clamp01(
            ((subject.mergedAt as number) - activeCycle.startDate) /
              Math.max(1, activeCycle.endDate - activeCycle.startDate),
          )
        : null,
    classCount: diverged.length,
    classLabel: `${diverged.length} ${plural(diverged.length, 'change is', 'changes are')} done in git, not on the board`,
  }
}

// ---------------------------------------------------------------------------
// The honesty statement — data, and CORRECTED rather than ported from the mock.
// ---------------------------------------------------------------------------

// What this page genuinely cannot say, and one thing it can. The mock's line said merged-to-live
// "isn't measured yet"; it IS measured — the exact merge-commit join against a deployment — and
// repeating the mock here would ship a new false statement on the page whose whole subject is not
// guessing. So the absences are the three that are real, and the derivable fact is pointed at
// instead.
const HONESTY: DeliveryPageHonesty = {
  line: "What this page won't guess: change failure rate, time to restore and deployment frequency as a rate are not measured here.",
  more: [
    'Change failure rate and time to restore both need an incident record, and yapm carries none.',
    'Deployments are drawn here as they happened, not normalised into a rate, so there is no deployment frequency on this page.',
    'A pull request reaches this page only through an issue, so a pull request linked to no issue is invisible in every reading and every drawing here.',
    "Whether a merged change reached production IS derived — its merge commit against a deployment's — and is stated per change on the issue's delivery rail.",
    'Where a section has no data it stays blank rather than drawing a zero.',
  ],
}

// ---------------------------------------------------------------------------
// The metric mapping — total over the twelve definitions, by construction.
// ---------------------------------------------------------------------------

// A redraw is exactly how a signal gets quietly deleted, and "we redistributed them" is a claim only
// a total mapping can keep. Every key in `DELIVERED_METRICS` + `FLOW_METRICS` appears below exactly
// once, and a unit test walks those two tables against this.
function metricMap(drawn: {
  readonly statsDrawn: boolean
  readonly distributionDrawn: boolean
  readonly flowDrawn: boolean
  readonly rhythmDrawn: boolean
}): readonly DeliveryMetricPlacement[] {
  return [
    {
      metricKey: 'shipped',
      section: 'stats',
      place: 'the Shipped reading, drawn again as the per-cycle bars in CYCLE FLOW',
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'pr_cycle_time',
      section: 'stats',
      place: 'the Open to merged reading, drawn again as the median rule in OPEN TO MERGED',
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'ci_failing_rate',
      section: 'stats',
      place: 'the Checks failing reading and its tick mini',
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'issues_without_pr',
      section: 'stats',
      place: 'the Not linked to a change reading',
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'total',
      section: 'stats_how',
      place: "the Shipped reading's how ·",
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'canceled',
      section: 'stats_how',
      place: "the Shipped reading's how ·",
      drawn: drawn.statsDrawn,
    },
    {
      metricKey: 'carried_out',
      section: 'flow',
      place: "CYCLE FLOW's ribbons, and its how · for the carries that left the window",
      drawn: drawn.flowDrawn,
    },
    {
      metricKey: 'carried_in',
      section: 'flow',
      place: "CYCLE FLOW's how ·",
      drawn: drawn.flowDrawn,
    },
    {
      metricKey: 'added_mid_cycle',
      section: 'flow',
      place: "CYCLE FLOW's added-after-start caps",
      drawn: drawn.flowDrawn,
    },
    {
      metricKey: 'carried_twice_plus',
      section: 'flow',
      place: "CYCLE FLOW's standfirst when non-zero, and its how ·",
      drawn: drawn.flowDrawn,
    },
    {
      metricKey: 'time_to_first_review',
      section: 'rhythm',
      place: "REVIEW RHYTHM's standfirst, and each row's first-review segment",
      drawn: drawn.rhythmDrawn,
    },
    {
      metricKey: 'review_rounds',
      section: 'rhythm',
      place: "REVIEW RHYTHM's standfirst, and each row's review marks",
      drawn: drawn.rhythmDrawn,
    },
  ]
}
