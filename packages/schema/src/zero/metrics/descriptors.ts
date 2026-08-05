import {
  type DeliveredCounts,
  type FlowMeasures,
  plural,
  reviewWaitDominates,
  round,
} from './scope.js'

// The presentation half of one metric definition: what a number is called, what it is measured in,
// which direction is better, how it is read out of the measures and how it is narrated. Both
// callers — the retro's single cycle and the team view's rolling window — walk the SAME two tables,
// so a metric cannot exist on one surface and not the other, and a caption cannot drift.

export type DeliveryUnit = 'count' | 'hours' | 'percent'

// `betterWhen` lets the UI color a trend without ranking anyone: it is a property of the SYSTEM
// signal, and `null` means the number is neither good nor bad on its own.
export interface DeliveryMetric {
  readonly key: string
  readonly label: string
  readonly value: number
  readonly unit: DeliveryUnit
  // The sparkline, oldest first, trends leading. For a cycle that is the prior cycles with this
  // one last; for a window it is one point per cycle in the window.
  readonly trend: readonly number[]
  readonly delta: number | null
  readonly betterWhen: 'lower' | 'higher' | null
  readonly caption: string
}

export interface DeliveryEmptyState {
  readonly title: string
  readonly detail: string
}

export interface DeliverySection {
  readonly key: 'delivered' | 'flow'
  readonly title: string
  readonly state: 'ready' | 'empty'
  readonly metrics: readonly DeliveryMetric[]
  readonly emptyState?: DeliveryEmptyState
}

// What "recently" means for this reading, and the only thing a caption branches on.
export type DeliveryPeriod =
  | { readonly kind: 'cycle' }
  | { readonly kind: 'window'; readonly cycleCount: number }

export const CYCLE_PERIOD: DeliveryPeriod = { kind: 'cycle' }

// The three numbers a tile needs, kept apart because for a window they are three DIFFERENT kinds of
// reading: `value` is the window aggregate, `trend` is one point per cycle, and `previous` is the
// preceding window. Deriving all three from one history array is only correct when they coincide,
// which they do for a retro and do not for a window.
export interface MetricSeries {
  readonly value: number | undefined
  readonly trend: readonly (number | undefined)[]
  readonly previous: number | undefined
}

// The retro's one call site: value and history are the same kind of number, so the sparkline is the
// history with the value appended and the comparison basis is the last defined history point.
export function fromHistory(
  value: number | undefined,
  history: readonly (number | undefined)[],
): MetricSeries {
  const defined = history.filter((entry): entry is number => entry !== undefined)
  return { value, trend: [...history, value], previous: defined.at(-1) }
}

export interface MetricSpec extends MetricSeries {
  readonly key: string
  readonly label: string
  readonly unit: DeliveryUnit
  readonly betterWhen: 'lower' | 'higher' | null
  // Evaluated only for a metric that has a value, so a missing signal never renders a caption.
  readonly caption: (value: number) => string
}

export function toMetric(spec: MetricSpec): DeliveryMetric | undefined {
  if (spec.value === undefined) return undefined
  return {
    key: spec.key,
    label: spec.label,
    value: spec.value,
    unit: spec.unit,
    trend: spec.trend.filter((entry): entry is number => entry !== undefined),
    delta: spec.previous === undefined ? null : round(spec.value - spec.previous, 2),
    betterWhen: spec.betterWhen,
    caption: spec.caption(spec.value),
  }
}

export interface MetricDescriptor<Measures, Context> {
  readonly key: string
  readonly label: string
  readonly unit: DeliveryUnit
  readonly betterWhen: 'lower' | 'higher' | null
  readonly read: (measures: Measures) => number | undefined
  readonly caption: (value: number, context: Context) => string
}

export function buildMetrics<Measures, Context>(
  descriptors: readonly MetricDescriptor<Measures, Context>[],
  seriesOf: (read: (measures: Measures) => number | undefined) => MetricSeries,
  context: Context,
): readonly DeliveryMetric[] {
  return descriptors
    .map((descriptor) =>
      toMetric({
        key: descriptor.key,
        label: descriptor.label,
        unit: descriptor.unit,
        betterWhen: descriptor.betterWhen,
        ...seriesOf(descriptor.read),
        caption: (value) => descriptor.caption(value, context),
      }),
    )
    .filter((metric): metric is DeliveryMetric => metric !== undefined)
}

function windowPhrase(cycleCount: number): string {
  return `the last ${cycleCount} completed ${plural(cycleCount, 'cycle', 'cycles')}`
}

export interface DeliveredContext {
  readonly period: DeliveryPeriod
  readonly counts: DeliveredCounts
}

export interface FlowContext {
  readonly period: DeliveryPeriod
  readonly measures: FlowMeasures
}

export const DELIVERED_METRICS: readonly MetricDescriptor<DeliveredCounts, DeliveredContext>[] = [
  {
    key: 'shipped',
    label: 'Shipped',
    unit: 'count',
    betterWhen: 'higher',
    read: (counts) => counts.shipped,
    caption: (value, { period, counts }) => {
      if (period.kind === 'cycle') {
        return counts.total === 0
          ? 'No issues were in scope for this cycle.'
          : `${value} of ${counts.total} ${plural(counts.total, 'issue', 'issues')} in scope shipped.`
      }
      return counts.total === 0
        ? `No issues were in scope across ${windowPhrase(period.cycleCount)}.`
        : `${value} of ${counts.total} ${plural(counts.total, 'issue', 'issues')} in scope shipped across ${windowPhrase(period.cycleCount)}.`
    },
  },
  {
    key: 'carried_out',
    label: 'Carried out',
    unit: 'count',
    betterWhen: 'lower',
    read: (counts) => counts.carriedOut,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value} ${plural(value, 'issue', 'issues')} carried into the next cycle rather than being dropped.`
        : `${value} ${plural(value, 'issue', 'issues')} carried out of ${windowPhrase(period.cycleCount)} — a carry from one cycle in the window to the next is not counted here.`,
  },
  {
    key: 'carried_in',
    label: 'Carried in',
    unit: 'count',
    betterWhen: null,
    read: (counts) => counts.carriedIn,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value} ${plural(value, 'issue was', 'issues were')} already in flight when the cycle opened.`
        : `${value} ${plural(value, 'issue', 'issues')} carried in from outside ${windowPhrase(period.cycleCount)}.`,
  },
  {
    key: 'carried_twice_plus',
    label: 'Carried twice or more',
    unit: 'count',
    betterWhen: 'lower',
    read: (counts) => counts.carriedTwicePlus,
    caption: (value, { period }) => {
      if (period.kind === 'cycle') {
        return value === 0
          ? 'Nothing has carried twice or more — the plan is holding.'
          : `${value} ${plural(value, 'item has', 'items have')} now carried twice or more, which usually means re-scoping rather than re-committing.`
      }
      return value === 0
        ? `Nothing carried twice or more across ${windowPhrase(period.cycleCount)} — the plan is holding.`
        : `${value} ${plural(value, 'item has', 'items have')} carried twice or more across ${windowPhrase(period.cycleCount)}, which usually means re-scoping rather than re-committing.`
    },
  },
  {
    key: 'added_mid_cycle',
    label: 'Added mid-cycle',
    unit: 'count',
    betterWhen: 'lower',
    read: (counts) => counts.addedMidCycle,
    caption: (value, { period }) => {
      if (period.kind === 'cycle') {
        return value === 0
          ? 'Nothing joined the cycle after it started.'
          : `${value} ${plural(value, 'item', 'items')} joined after the cycle started.`
      }
      return value === 0
        ? `Nothing joined a cycle after that cycle had started across ${windowPhrase(period.cycleCount)}.`
        : `${value} ${plural(value, 'item', 'items')} joined a cycle after that cycle had started, across ${windowPhrase(period.cycleCount)}.`
    },
  },
  {
    key: 'canceled',
    label: 'Canceled',
    unit: 'count',
    betterWhen: null,
    read: (counts) => counts.canceled,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value} ${plural(value, 'issue was', 'issues were')} canceled during the cycle.`
        : `${value} ${plural(value, 'issue was', 'issues were')} canceled across ${windowPhrase(period.cycleCount)}.`,
  },
  {
    key: 'total',
    label: 'In scope',
    unit: 'count',
    betterWhen: null,
    read: (counts) => counts.total,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value} ${plural(value, 'issue', 'issues')} touched this cycle, carried work included.`
        : `${value} distinct ${plural(value, 'issue', 'issues')} touched ${windowPhrase(period.cycleCount)}, carried work included.`,
  },
]

function reviewShare(measures: FlowMeasures): string {
  return reviewWaitDominates(measures) ? ' Review wait was the largest slice of that time.' : ''
}

export const FLOW_METRICS: readonly MetricDescriptor<FlowMeasures, FlowContext>[] = [
  {
    key: 'pr_cycle_time',
    label: 'PR cycle time',
    unit: 'hours',
    betterWhen: 'lower',
    read: (measures) => measures.prCycleTimeHours,
    caption: (value, { period, measures }) =>
      period.kind === 'cycle'
        ? `Pull requests took a median of ${value}h from open to merge.${reviewShare(measures)}`
        : `Pull requests took a median of ${value}h from open to merge across ${windowPhrase(period.cycleCount)}.${reviewShare(measures)}`,
  },
  {
    key: 'time_to_first_review',
    label: 'Time to first review',
    unit: 'hours',
    betterWhen: 'lower',
    read: (measures) => measures.timeToFirstReviewHours,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `Changes waited a median of ${value}h for their first review.`
        : `Changes waited a median of ${value}h for their first review across ${windowPhrase(period.cycleCount)}.`,
  },
  {
    key: 'review_rounds',
    label: 'Review rounds',
    unit: 'count',
    betterWhen: 'lower',
    read: (measures) => measures.reviewRounds,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `Reviews came back a median of ${value} ${plural(value, 'time', 'times')} per pull request.`
        : `Reviews came back a median of ${value} ${plural(value, 'time', 'times')} per pull request across ${windowPhrase(period.cycleCount)}.`,
  },
  {
    key: 'issues_without_pr',
    label: 'No linked PR',
    unit: 'count',
    betterWhen: 'lower',
    read: (measures) => measures.issuesWithoutPr,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value} ${plural(value, 'issue in scope has', 'issues in scope have')} no linked pull request.`
        : `${value} ${plural(value, 'issue in scope has', 'issues in scope have')} no linked pull request across ${windowPhrase(period.cycleCount)}.`,
  },
  {
    key: 'ci_failing_rate',
    label: 'CI failing',
    unit: 'percent',
    betterWhen: 'lower',
    read: (measures) => measures.ciFailingRate,
    caption: (value, { period }) =>
      period.kind === 'cycle'
        ? `${value}% of pull requests had a failing check — shown next to speed so neither is traded for the other.`
        : `${value}% of pull requests across ${windowPhrase(period.cycleCount)} had a failing check — shown next to speed so neither is traded for the other.`,
  },
]

// Never zeros, never a hollow chart: one quiet state naming what would light the section up.
export function flowEmptyState(period: DeliveryPeriod): DeliveryEmptyState {
  return {
    title: 'No delivery data yet',
    detail:
      period.kind === 'cycle'
        ? 'Connect GitHub to see pull-request cycle time, review wait and CI health for this cycle. Until then the Delivered section above is computed from cycles alone.'
        : `Connect GitHub to see pull-request cycle time, review wait and CI health across ${windowPhrase(period.cycleCount)}. Until then the Delivered section above is computed from cycles alone.`,
  }
}

export function deliverySections(input: {
  readonly period: DeliveryPeriod
  readonly delivered: readonly DeliveryMetric[]
  readonly flow: readonly DeliveryMetric[]
}): readonly DeliverySection[] {
  return [
    { key: 'delivered', title: 'Delivered', state: 'ready', metrics: input.delivered },
    input.flow.length === 0
      ? {
          key: 'flow',
          title: 'Flow',
          state: 'empty',
          metrics: [],
          emptyState: flowEmptyState(input.period),
        }
      : { key: 'flow', title: 'Flow', state: 'ready', metrics: input.flow },
  ]
}
