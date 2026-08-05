import { buildRetroSeed, compareCycles, type RetroSeed, type RetroSeedMetric } from '@yapm/schema'
import { type SeedCycleRow, type SeedIssueRow, toDeliveryCycle } from '@/delivery/rows'

// The retro's cycle-scoped entry point into the shared delivery measurement. The row shapes, the
// row→input projection and the formatters all live in `@/delivery` now, shared byte for byte with
// the team Delivery view; what stays here is the one thing that is retro-specific — which cycles
// constitute the reading.

export {
  formatSeedDelta,
  formatSeedValue,
  type SeedTrendTone,
  type SparklineGeometry,
  seedTrendTone,
  sparklineGeometry,
} from '@/delivery/metric-format'
export type { SeedCycleRow, SeedIssueRow, SeedPrRow } from '@/delivery/rows'

const MAX_PRIOR_CYCLES = 3

// The sparkline's history: up to three COMPLETED cycles of the same team that sort before this one,
// oldest first, by the same total order the cycles list uses.
export function priorCyclesFor(
  cycle: SeedCycleRow,
  cycles: readonly SeedCycleRow[],
): SeedCycleRow[] {
  return cycles
    .filter((candidate) => candidate.id !== cycle.id && candidate.status === 'completed')
    .filter((candidate) => compareCycles(candidate, cycle) < 0)
    .sort(compareCycles)
    .slice(-MAX_PRIOR_CYCLES)
}

// Null when the retro has no cycle to reflect on, or the cycle is not in the caller's synced slice —
// the panel then renders nothing rather than a board of zeros.
export function buildRetroSeedFor(
  cycleId: string | null,
  cycles: readonly SeedCycleRow[],
  issues: readonly SeedIssueRow[],
): RetroSeed | null {
  if (cycleId === null) return null
  const cycle = cycles.find((candidate) => candidate.id === cycleId)
  if (cycle === undefined) return null
  return buildRetroSeed({
    cycle: toDeliveryCycle(cycle, issues),
    priorCycles: priorCyclesFor(cycle, cycles).map((prior) => toDeliveryCycle(prior, issues)),
  })
}

// The lookup behind a cited metric key: an AI proposal points at a key and the surface renders THIS
// metric — yapm's own value, computed here — rather than any number the model typed.
export function findSeedMetric(seed: RetroSeed | null, key: string): RetroSeedMetric | null {
  if (seed === null) return null
  for (const section of seed.sections) {
    const metric = section.metrics.find((candidate) => candidate.key === key)
    if (metric !== undefined) return metric
  }
  return null
}
