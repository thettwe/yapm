import {
  buildDeliveryWindow,
  compareCycles,
  type DeliveryWindow,
  MAX_DELIVERY_WINDOW,
} from '@yapm/schema'
import { type SeedCycleRow, type SeedIssueRow, toDeliveryCycles } from './rows'

// The team's rolling-window entry point, beside the retro's `buildRetroSeedFor` rather than a fork
// of it: the two differ only in WHICH cycles constitute the reading. Every formula, every caption
// and every empty state comes from `@yapm/schema`'s measurement scope.
//
// Zero has no aggregates, so this is a pure function over already-synced rows — `cycles.byTeam` and
// `issues.byTeam`, both of which the issue list already syncs. Nothing here waits on the network.

// An in-progress cycle is excluded: a half-finished cycle drags every count down and would make the
// trend report a decline that is only the calendar. The same filter the retro's sparkline uses.
export function completedCyclesFor(cycles: readonly SeedCycleRow[]): SeedCycleRow[] {
  return cycles.filter((cycle) => cycle.status === 'completed').sort(compareCycles)
}

export function buildTeamDeliveryFor(
  cycles: readonly SeedCycleRow[],
  issues: readonly SeedIssueRow[],
  size: number,
): DeliveryWindow | null {
  // The ceiling is the schema's, applied here too so the PRECEDING window is sliced against the
  // same length `buildDeliveryWindow` will use — otherwise an oversized request would compare a
  // 12-cycle window against a differently-sized one.
  const bounded = Math.min(size, MAX_DELIVERY_WINDOW)
  const completed = completedCyclesFor(cycles)
  const window = completed.slice(-bounded)
  // The window immediately before it: the delta's basis, and only a basis when it is full. A
  // partial preceding window is dropped inside `buildDeliveryWindow`, not here.
  const prior = completed.slice(-(bounded * 2), -bounded)

  return buildDeliveryWindow({
    cycles: toDeliveryCycles(window, issues),
    priorCycles: toDeliveryCycles(prior, issues),
    size: bounded,
  })
}
