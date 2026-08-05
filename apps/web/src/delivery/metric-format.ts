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
  // One polyline per unbroken run of measured cycles. A series with nothing missing is exactly one
  // segment, which is what keeps the retro's rendered SVG unchanged.
  //
  // A run of ONE carries its coordinate twice. A single-point polyline has no length to stroke and
  // paints nothing at all, so a window whose measured cycles are each isolated by a gap would render
  // an empty box — several real readings, no ink. Repeated, the point is a zero-length segment,
  // which `stroke-linecap="round"` renders as a dot.
  readonly segments: readonly string[]
  readonly last: { readonly x: number; readonly y: number }
}

// A flat series renders on the mid-line rather than collapsing to the floor, so "unchanged" reads as
// steady instead of as zero.
//
// A cycle with nothing to measure is a HOLE, not an absent slot: its x position is still spent, so
// the surviving points keep their true spacing, and the line breaks across the hole rather than
// drawing through it as if the two neighbours were consecutive.
export function sparklineGeometry(
  trend: readonly (number | undefined)[],
  width: number,
  height: number,
): SparklineGeometry | null {
  const measured = trend.filter((entry): entry is number => entry !== undefined)
  if (trend.length < 2 || measured.length < 2) return null
  const min = Math.min(...measured)
  const max = Math.max(...measured)
  const span = max - min
  const step = width / (trend.length - 1)
  const coords = trend.map((value, index) =>
    value === undefined
      ? undefined
      : {
          x: Math.round(index * step * 100) / 100,
          y:
            span === 0
              ? height / 2
              : Math.round((height - ((value - min) / span) * height) * 100) / 100,
        },
  )

  const segments: string[] = []
  let run: string[] = []
  const closeRun = () => {
    if (run.length === 0) return
    segments.push(run.length === 1 ? `${run[0]} ${run[0]}` : run.join(' '))
    run = []
  }
  for (const point of coords) {
    if (point === undefined) {
      closeRun()
      continue
    }
    run.push(`${point.x},${point.y}`)
  }
  closeRun()

  const last = coords.findLast((point) => point !== undefined)
  if (last === undefined) return null
  return { segments, last }
}
