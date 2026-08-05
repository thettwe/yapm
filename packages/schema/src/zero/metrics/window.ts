import {
  buildMetrics,
  DELIVERED_METRICS,
  type DeliveryPeriod,
  type DeliverySection,
  deliverySections,
  FLOW_METRICS,
} from './descriptors.js'
import {
  type DeliveryCycleInput,
  type DeliveryScope,
  deliveredCounts,
  flowMeasures,
  plural,
  scopeOfCycle,
  scopeOfCycles,
} from './scope.js'

// The rolling-window reading of the same metrics the retro shows for one cycle. Every number below
// comes from `scope.ts`; this module only decides WHICH scopes to evaluate.
//
// The unit is completed cycles, not days: four Delivered metrics are defined relative to a cycle
// boundary, so "carried out of the last 30 days" is not a thing (design §D1).

export const DELIVERY_WINDOW_SIZES = [3, 6, 12] as const

export type DeliveryWindowSize = (typeof DELIVERY_WINDOW_SIZES)[number]

// Zero has no aggregates, so this is a pure function over already-synced rows. The bound is what
// keeps that honest at scale: twelve completed cycles is ~6 months at a two-week cadence, and a team
// asking for more is asking a reporting question, not this one. Clamping lives here rather than at
// the call site so no caller can widen it (design §D4).
export const MAX_DELIVERY_WINDOW = 12

export interface DeliveryWindowInput {
  // The window's cycles, oldest first. Completed cycles only — an in-progress one drags every count
  // down and would make the trend report a decline that is only the calendar.
  readonly cycles: readonly DeliveryCycleInput[]
  // The window immediately preceding it, oldest first — the delta's basis, not a sparkline history.
  readonly priorCycles?: readonly DeliveryCycleInput[]
  readonly size: number
}

export interface DeliveryWindow {
  readonly label: string
  readonly cycleCount: number
  readonly sections: readonly DeliverySection[]
}

function clampSize(size: number): number {
  if (!Number.isFinite(size)) return MAX_DELIVERY_WINDOW
  return Math.min(Math.max(Math.trunc(size), 1), MAX_DELIVERY_WINDOW)
}

export function buildDeliveryWindow(input: DeliveryWindowInput): DeliveryWindow | null {
  const size = clampSize(input.size)
  const cycles = input.cycles.slice(-size)
  if (cycles.length === 0) return null

  const period: DeliveryPeriod = { kind: 'window', cycleCount: cycles.length }
  const scope = scopeOfCycles(cycles)
  const perCycle = cycles.map(scopeOfCycle)

  // A partial preceding window is not a comparison basis: three cycles against six is arithmetic on
  // incomparable things, so the delta is dropped instead (design §D3).
  const prior = (input.priorCycles ?? []).slice(-size)
  const previous: DeliveryScope | undefined =
    cycles.length === size && prior.length === size ? scopeOfCycles(prior) : undefined

  const counts = deliveredCounts(scope)
  const perCycleCounts = perCycle.map(deliveredCounts)
  const previousCounts = previous === undefined ? undefined : deliveredCounts(previous)
  const delivered = buildMetrics(
    DELIVERED_METRICS,
    (read) => ({
      value: read(counts),
      trend: perCycleCounts.map(read),
      previous: previousCounts === undefined ? undefined : read(previousCounts),
    }),
    { period, counts },
  )

  const measures = flowMeasures(scope)
  const perCycleMeasures = perCycle.map(flowMeasures)
  const previousMeasures = previous === undefined ? undefined : flowMeasures(previous)
  const flow = buildMetrics(
    FLOW_METRICS,
    (read) => ({
      value: read(measures),
      trend: perCycleMeasures.map(read),
      previous: previousMeasures === undefined ? undefined : read(previousMeasures),
    }),
    { period, measures },
  )

  return {
    label: `Last ${cycles.length} completed ${plural(cycles.length, 'cycle', 'cycles')}`,
    cycleCount: cycles.length,
    sections: deliverySections({ period, delivered, flow }),
  }
}
