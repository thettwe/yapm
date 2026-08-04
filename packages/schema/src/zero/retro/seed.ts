import * as z from 'zod'
import type { CiConclusion, IssueStatus } from '../context.js'
import { ciHealthFromConclusion } from '../delivery.js'

// The differentiator, as one pure function: the retro's "Gather data" phase, pre-filled from the
// work graph. Every other retro tool asks the team what happened; this computes it.
//
// Two guarantees are STRUCTURAL here, not editorial:
//   1. No identity dimension at any depth. Neither the input nor the output carries an assignee,
//      author, reviewer, creator or user id, so a per-person number is not renderable. A unit test
//      walks the produced object graph and fails on any identity-shaped key.
//   2. Degrades to the data that exists. Delivered is fully populated from CYCLES ALONE (day one,
//      no connectors). Flow appears only when linked delivery data exists and otherwise renders one
//      quiet empty state naming what would light it up — never zeros, never hollow charts.
// Health (DORA/MTTR) is Phase 3: this function produces no health section and `RetroSeed` carries
// no health field. The seam is the section list being open for extension.

// The evidence link a panel widget attaches to the draft it seeds — the join no whiteboard tool can
// make. A superset of `DigestEvidenceRef` (a digest ref is assignable here), plus `widget` for "this
// number itself", so the later AI change's cite-or-omit validator reuses one grounding contract.
// `retro_action` is the loop-closing kind: a proposal that points at an improvement the team agreed
// in its PREVIOUS retro. It costs no DDL — `refs` is jsonb with no CHECK — and `buildRetroSeed` never
// emits one; only the AI draft's proposals cite it.
export const RETRO_SEED_REF_KINDS = [
  'issue',
  'pull_request',
  'ci_check',
  'deployment',
  'widget',
  'retro_action',
] as const

export type RetroSeedRefKind = (typeof RETRO_SEED_REF_KINDS)[number]

// What the LIVE STATUS of the issue an agreed action became says about that action. A yapm-computed
// enum, never a phrase a model chose. `shipped` is `done` AND NOTHING ELSE: `canceled` is reported as
// its own outcome rather than folded into "not shipped", and `not_converted` ("we agreed it and never
// tracked it") is kept apart from `in_flight` ("we tracked it and it is still open") because those
// are different failures and a retro should be able to tell them apart.
export const RETRO_ACTION_OUTCOMES = ['shipped', 'canceled', 'in_flight', 'not_converted'] as const

export type RetroActionOutcome = (typeof RETRO_ACTION_OUTCOMES)[number]

export function retroActionOutcome(
  issueStatus: IssueStatus | null | undefined,
): RetroActionOutcome {
  if (issueStatus == null) return 'not_converted'
  if (issueStatus === 'done') return 'shipped'
  if (issueStatus === 'canceled') return 'canceled'
  return 'in_flight'
}

// Yapm's words for a yapm-computed outcome, in ONE place: the server bakes them into a reference's
// label, the panel marks the chip with them, and neither can drift from the other.
export const RETRO_ACTION_OUTCOME_LABEL: Readonly<Record<RetroActionOutcome, string>> = {
  shipped: 'shipped',
  canceled: 'canceled',
  in_flight: 'still open',
  not_converted: 'never tracked',
}

// The citable key a follow-up proposal points at instead of typing a count. One per outcome, in the
// `widget` namespace the seed metrics already occupy, so the cite-or-omit validator narrows an
// invented count exactly as it narrows an invented metric key.
export function retroActionOutcomeKey(outcome: RetroActionOutcome): string {
  return `prior_retro_${outcome}`
}

export type RetroActionOutcomeTotals = Readonly<Record<RetroActionOutcome, number>>

export function retroActionOutcomeTotals(
  outcomes: readonly RetroActionOutcome[],
): RetroActionOutcomeTotals {
  const totals: Record<RetroActionOutcome, number> = {
    shipped: 0,
    canceled: 0,
    in_flight: 0,
    not_converted: 0,
  }
  for (const outcome of outcomes) totals[outcome] += 1
  return totals
}

// `outcome` and `origin` are YAPM-BAKED and exist for the one reference kind the client cannot
// resolve from its own synced rows: the prior retro's actions are not in this retro's sync scope, and
// adding a cross-retro query for a caption would be a new permission surface for a string. The server
// overwrites both (and `label`) after validation and strips them from every other kind, so a model
// never writes any of the three. See `bakeRetroActionRefs`.
export const retroSeedRefSchema = z.object({
  kind: z.enum(RETRO_SEED_REF_KINDS),
  id: z.string().min(1),
  label: z.string().optional(),
  outcome: z.enum(RETRO_ACTION_OUTCOMES).optional(),
  origin: z.string().optional(),
})

export type RetroSeedRef = z.infer<typeof retroSeedRefSchema>

export interface RetroSeedPrInput {
  readonly openedAt: number
  readonly mergedAt?: number | null
  readonly reviewSubmittedAt?: readonly number[]
  readonly ciConclusions?: readonly CiConclusion[]
}

// An issue as the panel reads it: its cycle edges and the two carryover facts, and NOTHING about
// who touched it.
export interface RetroSeedIssueInput {
  readonly id: string
  readonly status: IssueStatus
  readonly cycleId: string | null
  readonly rolledOverFromCycleId?: string | null
  readonly carryoverCount?: number | null
  readonly cycleAssignedAt?: number | null
  readonly pullRequests?: readonly RetroSeedPrInput[]
}

export interface RetroSeedCycleInput {
  readonly id: string
  readonly name: string
  readonly startDate: number
  // Every issue that touched this cycle: the ones still pointing at it plus the ones the rollover
  // carried out of it (`rolledOverFromCycleId === cycle.id`), which no longer point at it.
  readonly issues: readonly RetroSeedIssueInput[]
}

export interface RetroSeedInput {
  readonly cycle: RetroSeedCycleInput
  // Up to three prior completed cycles of the same team, oldest first — the sparkline's history.
  readonly priorCycles?: readonly RetroSeedCycleInput[]
}

export type RetroSeedUnit = 'count' | 'hours' | 'percent'

// `betterWhen` lets the UI color a trend without ranking anyone: it is a property of the SYSTEM
// signal, and `null` means the number is neither good nor bad on its own.
export interface RetroSeedMetric {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly unit: RetroSeedUnit
  // Prior cycles oldest-first, with this cycle's value last — the sparkline, trends leading.
  readonly trend: readonly number[]
  readonly delta: number | null
  readonly betterWhen: 'lower' | 'higher' | null
  readonly caption: string
}

export interface RetroSeedEmptyState {
  readonly title: string
  readonly detail: string
}

export interface RetroSeedSection {
  readonly key: 'delivered' | 'flow'
  readonly title: string
  readonly state: 'ready' | 'empty'
  readonly metrics: readonly RetroSeedMetric[]
  readonly emptyState?: RetroSeedEmptyState
}

export interface RetroSeed {
  readonly cycleId: string
  readonly cycleName: string
  readonly sections: readonly RetroSeedSection[]
}

const MAX_PRIOR_CYCLES = 3

interface DeliveredCounts {
  readonly total: number
  readonly shipped: number
  readonly carriedOut: number
  readonly carriedIn: number
  readonly carriedTwicePlus: number
  readonly addedMidCycle: number
  readonly canceled: number
}

// Delivered, from cycles alone. `carriedOut` is reconstructed from `rolledOverFromCycleId` because a
// carried issue no longer points at the cycle it left; `carriedTwicePlus` and `addedMidCycle` are
// facts rather than guesses thanks to `carryover_count` and `cycle_assigned_at`.
function deliveredCounts(cycle: RetroSeedCycleInput): DeliveredCounts {
  const inCycle = cycle.issues.filter((issue) => issue.cycleId === cycle.id)
  const carriedOut = cycle.issues.filter(
    (issue) => issue.rolledOverFromCycleId === cycle.id && issue.cycleId !== cycle.id,
  )

  return {
    total: inCycle.length + carriedOut.length,
    shipped: inCycle.filter((issue) => issue.status === 'done').length,
    carriedOut: carriedOut.length,
    carriedIn: inCycle.filter(
      (issue) => issue.rolledOverFromCycleId != null && issue.rolledOverFromCycleId !== cycle.id,
    ).length,
    carriedTwicePlus: carriedOut.filter((issue) => (issue.carryoverCount ?? 0) >= 2).length,
    // Only issues STILL in the cycle: `cycle_assigned_at` records the last assignment, so for an
    // issue the rollover carried out it already describes the successor cycle, not this one.
    addedMidCycle: inCycle.filter(
      (issue) => issue.cycleAssignedAt != null && issue.cycleAssignedAt > cycle.startDate,
    ).length,
    canceled: inCycle.filter((issue) => issue.status === 'canceled').length,
  }
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] as number)
      : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
  return value
}

function round(value: number, places = 1): number {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

const HOUR_MS = 60 * 60 * 1000

function pullRequests(cycle: RetroSeedCycleInput): readonly RetroSeedPrInput[] {
  return cycle.issues.flatMap((issue) => issue.pullRequests ?? [])
}

interface FlowMeasures {
  readonly prCycleTimeHours: number | undefined
  readonly timeToFirstReviewHours: number | undefined
  readonly reviewRounds: number | undefined
  readonly issuesWithoutPr: number | undefined
  readonly ciFailingRate: number | undefined
}

const NO_FLOW: FlowMeasures = {
  prCycleTimeHours: undefined,
  timeToFirstReviewHours: undefined,
  reviewRounds: undefined,
  issuesWithoutPr: undefined,
  ciFailingRate: undefined,
}

// Flow, from connector-fed delivery data. Speed and stability are computed as a pair (cycle time
// next to the CI failing rate) so neither can be optimized at the other's expense.
function flowMeasures(cycle: RetroSeedCycleInput): FlowMeasures {
  const prs = pullRequests(cycle)
  if (prs.length === 0) return NO_FLOW

  const cycleTimes = prs
    .filter((pr) => pr.mergedAt != null)
    .map((pr) => ((pr.mergedAt as number) - pr.openedAt) / HOUR_MS)
    .filter((hours) => hours >= 0)

  const firstReviewWaits = prs
    .map((pr) => {
      const submitted = pr.reviewSubmittedAt ?? []
      if (submitted.length === 0) return undefined
      return (Math.min(...submitted) - pr.openedAt) / HOUR_MS
    })
    .filter((hours): hours is number => hours !== undefined && hours >= 0)

  const reviewCounts = prs
    .filter((pr) => (pr.reviewSubmittedAt ?? []).length > 0)
    .map((pr) => (pr.reviewSubmittedAt ?? []).length)

  const inCycle = cycle.issues.filter((issue) => issue.cycleId === cycle.id)
  const prsWithChecks = prs.filter((pr) => (pr.ciConclusions ?? []).length > 0)
  const failing = prsWithChecks.filter((pr) =>
    (pr.ciConclusions ?? []).some((conclusion) => ciHealthFromConclusion(conclusion) === 'failing'),
  )

  const prCycleTime = median(cycleTimes)
  const firstReview = median(firstReviewWaits)
  const rounds = median(reviewCounts)

  return {
    prCycleTimeHours: prCycleTime === undefined ? undefined : round(prCycleTime),
    timeToFirstReviewHours: firstReview === undefined ? undefined : round(firstReview),
    reviewRounds: rounds === undefined ? undefined : round(rounds),
    issuesWithoutPr:
      inCycle.length === 0
        ? undefined
        : inCycle.filter((issue) => (issue.pullRequests ?? []).length === 0).length,
    ciFailingRate:
      prsWithChecks.length === 0
        ? undefined
        : Math.round((failing.length / prsWithChecks.length) * 100),
  }
}

function priors(input: RetroSeedInput): readonly RetroSeedCycleInput[] {
  return (input.priorCycles ?? []).slice(-MAX_PRIOR_CYCLES)
}

interface MetricSpec {
  readonly key: string
  readonly label: string
  readonly unit: RetroSeedUnit
  readonly betterWhen: 'lower' | 'higher' | null
  readonly value: number | undefined
  readonly history: readonly (number | undefined)[]
  // Evaluated only for a metric that has a value, so a missing signal never renders a caption.
  readonly caption: (value: number) => string
}

function toMetric(spec: MetricSpec): RetroSeedMetric | undefined {
  if (spec.value === undefined) return undefined
  const history = spec.history.filter((value): value is number => value !== undefined)
  const previous = history.at(-1)
  return {
    key: spec.key,
    label: spec.label,
    value: spec.value,
    unit: spec.unit,
    trend: [...history, spec.value],
    delta: previous === undefined ? null : round(spec.value - previous, 2),
    betterWhen: spec.betterWhen,
    caption: spec.caption(spec.value),
  }
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many
}

// Whether review wait dominated lead time — the literature's highest-value retro topic, and a
// property of the system rather than of any reviewer.
function reviewWaitDominates(flow: FlowMeasures): boolean {
  if (flow.timeToFirstReviewHours === undefined) return false
  if (flow.prCycleTimeHours === undefined || flow.prCycleTimeHours <= 0) return false
  return flow.timeToFirstReviewHours / flow.prCycleTimeHours >= 0.5
}

const FLOW_EMPTY_STATE: RetroSeedEmptyState = {
  title: 'No delivery data yet',
  detail:
    'Connect GitHub to see pull-request cycle time, review wait and CI health for this cycle. Until then the Delivered section above is computed from cycles alone.',
}

export function buildRetroSeed(input: RetroSeedInput): RetroSeed {
  const history = priors(input)
  const counts = deliveredCounts(input.cycle)
  const priorCounts = history.map(deliveredCounts)

  const delivered: RetroSeedMetric[] = [
    toMetric({
      key: 'shipped',
      label: 'Shipped',
      unit: 'count',
      betterWhen: 'higher',
      value: counts.shipped,
      history: priorCounts.map((prior) => prior.shipped),
      caption: (value) =>
        counts.total === 0
          ? 'No issues were in scope for this cycle.'
          : `${value} of ${counts.total} ${plural(counts.total, 'issue', 'issues')} in scope shipped.`,
    }),
    toMetric({
      key: 'carried_out',
      label: 'Carried out',
      unit: 'count',
      betterWhen: 'lower',
      value: counts.carriedOut,
      history: priorCounts.map((prior) => prior.carriedOut),
      caption: (value) =>
        `${value} ${plural(value, 'issue', 'issues')} carried into the next cycle rather than being dropped.`,
    }),
    toMetric({
      key: 'carried_in',
      label: 'Carried in',
      unit: 'count',
      betterWhen: null,
      value: counts.carriedIn,
      history: priorCounts.map((prior) => prior.carriedIn),
      caption: (value) =>
        `${value} ${plural(value, 'issue was', 'issues were')} already in flight when the cycle opened.`,
    }),
    toMetric({
      key: 'carried_twice_plus',
      label: 'Carried twice or more',
      unit: 'count',
      betterWhen: 'lower',
      value: counts.carriedTwicePlus,
      history: priorCounts.map((prior) => prior.carriedTwicePlus),
      caption: (value) =>
        value === 0
          ? 'Nothing has carried twice or more — the plan is holding.'
          : `${value} ${plural(value, 'item has', 'items have')} now carried twice or more, which usually means re-scoping rather than re-committing.`,
    }),
    toMetric({
      key: 'added_mid_cycle',
      label: 'Added mid-cycle',
      unit: 'count',
      betterWhen: 'lower',
      value: counts.addedMidCycle,
      history: priorCounts.map((prior) => prior.addedMidCycle),
      caption: (value) =>
        value === 0
          ? 'Nothing joined the cycle after it started.'
          : `${value} ${plural(value, 'item', 'items')} joined after the cycle started.`,
    }),
    toMetric({
      key: 'canceled',
      label: 'Canceled',
      unit: 'count',
      betterWhen: null,
      value: counts.canceled,
      history: priorCounts.map((prior) => prior.canceled),
      caption: (value) =>
        `${value} ${plural(value, 'issue was', 'issues were')} canceled during the cycle.`,
    }),
    toMetric({
      key: 'total',
      label: 'In scope',
      unit: 'count',
      betterWhen: null,
      value: counts.total,
      history: priorCounts.map((prior) => prior.total),
      caption: (value) =>
        `${value} ${plural(value, 'issue', 'issues')} touched this cycle, carried work included.`,
    }),
  ].filter((metric): metric is RetroSeedMetric => metric !== undefined)

  const flow = flowMeasures(input.cycle)
  const priorFlow = history.map(flowMeasures)
  const reviewShare = reviewWaitDominates(flow)
    ? ' Review wait was the largest slice of that time.'
    : ''

  const flowMetrics: RetroSeedMetric[] = [
    toMetric({
      key: 'pr_cycle_time',
      label: 'PR cycle time',
      unit: 'hours',
      betterWhen: 'lower',
      value: flow.prCycleTimeHours,
      history: priorFlow.map((prior) => prior.prCycleTimeHours),
      caption: (value) =>
        `Pull requests took a median of ${value}h from open to merge.${reviewShare}`,
    }),
    toMetric({
      key: 'time_to_first_review',
      label: 'Time to first review',
      unit: 'hours',
      betterWhen: 'lower',
      value: flow.timeToFirstReviewHours,
      history: priorFlow.map((prior) => prior.timeToFirstReviewHours),
      caption: (value) => `Changes waited a median of ${value}h for their first review.`,
    }),
    toMetric({
      key: 'review_rounds',
      label: 'Review rounds',
      unit: 'count',
      betterWhen: 'lower',
      value: flow.reviewRounds,
      history: priorFlow.map((prior) => prior.reviewRounds),
      caption: (value) =>
        `Reviews came back a median of ${value} ${plural(value, 'time', 'times')} per pull request.`,
    }),
    toMetric({
      key: 'issues_without_pr',
      label: 'No linked PR',
      unit: 'count',
      betterWhen: 'lower',
      value: flow.issuesWithoutPr,
      history: priorFlow.map((prior) => prior.issuesWithoutPr),
      caption: (value) =>
        `${value} ${plural(value, 'issue in scope has', 'issues in scope have')} no linked pull request.`,
    }),
    toMetric({
      key: 'ci_failing_rate',
      label: 'CI failing',
      unit: 'percent',
      betterWhen: 'lower',
      value: flow.ciFailingRate,
      history: priorFlow.map((prior) => prior.ciFailingRate),
      caption: (value) =>
        `${value}% of pull requests had a failing check — shown next to speed so neither is traded for the other.`,
    }),
  ].filter((metric): metric is RetroSeedMetric => metric !== undefined)

  return {
    cycleId: input.cycle.id,
    cycleName: input.cycle.name,
    sections: [
      { key: 'delivered', title: 'Delivered', state: 'ready', metrics: delivered },
      flowMetrics.length === 0
        ? { key: 'flow', title: 'Flow', state: 'empty', metrics: [], emptyState: FLOW_EMPTY_STATE }
        : { key: 'flow', title: 'Flow', state: 'ready', metrics: flowMetrics },
    ],
  }
}
