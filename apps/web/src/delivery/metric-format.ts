import type { DeliveryMetric } from '@yapm/schema'

// One formatter per reading, shared by the retro's single-cycle panel and the team's rolling
// window. Two copies of "how a metric reads" is how the same number ends up phrased two ways on two
// surfaces; there is one copy, and both callers import it.

export function formatSeedValue(metric: DeliveryMetric): string {
  switch (metric.unit) {
    case 'hours':
      return `${metric.value}h`
    case 'percent':
      return `${metric.value}%`
    default:
      return `${metric.value}`
  }
}

// Trends lead, absolutes follow — and a trend is only ever "better"/"worse" for the SYSTEM. A metric
// with no `betterWhen` (carried in, in scope, canceled) is reported as movement with no judgement.
export type SeedTrendTone = 'better' | 'worse' | 'neutral'

export function seedTrendTone(metric: DeliveryMetric): SeedTrendTone | null {
  if (metric.delta === null || metric.delta === 0) return null
  if (metric.betterWhen === null) return 'neutral'
  const improved = metric.betterWhen === 'lower' ? metric.delta < 0 : metric.delta > 0
  return improved ? 'better' : 'worse'
}

// `basis` names what the delta is measured against, because that is the one thing the two surfaces
// genuinely disagree on: a retro compares against the cycle before, a window against the window
// before. The default keeps the retro's wording character for character.
export function formatSeedDelta(metric: DeliveryMetric, basis = 'last cycle'): string | null {
  if (metric.delta === null) return null
  if (metric.delta === 0) return 'no change'
  const magnitude = Math.abs(metric.delta)
  const suffix = metric.unit === 'hours' ? 'h' : metric.unit === 'percent' ? '%' : ''
  // A true minus sign, not a hyphen, so a screen reader reads "minus" rather than a dash.
  return `${metric.delta > 0 ? '+' : '−'}${magnitude}${suffix} vs. ${basis}`
}

export interface SparklineGeometry {
  readonly points: string
  readonly last: { readonly x: number; readonly y: number }
}

// A flat series renders on the mid-line rather than collapsing to the floor, so "unchanged" reads as
// steady instead of as zero.
export function sparklineGeometry(
  trend: readonly number[],
  width: number,
  height: number,
): SparklineGeometry | null {
  if (trend.length < 2) return null
  const min = Math.min(...trend)
  const max = Math.max(...trend)
  const span = max - min
  const step = width / (trend.length - 1)
  const coords = trend.map((value, index) => ({
    x: Math.round(index * step * 100) / 100,
    y: span === 0 ? height / 2 : Math.round((height - ((value - min) / span) * height) * 100) / 100,
  }))
  const last = coords.at(-1)
  if (last === undefined) return null
  return { points: coords.map((point) => `${point.x},${point.y}`).join(' '), last }
}
