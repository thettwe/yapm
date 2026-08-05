import { describe, expect, it } from 'vitest'
import { collectKeys, FORBIDDEN_IDENTITY_KEYS } from '../testing/blameless.js'
import type { DeliveryMetric, DeliverySection } from './descriptors.js'
import type { DeliveryCycleInput } from './scope.js'
import { buildDeliveryWindow, MAX_DELIVERY_WINDOW } from './window.js'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000

function cycleAt(n: number, issues: DeliveryCycleInput['issues'] = []): DeliveryCycleInput {
  return { id: `c-${n}`, name: `Cycle ${n}`, startDate: START + n * 14 * DAY, issues }
}

// One shipped issue per cycle, so the sparkline is a flat line of ones and the window value is the
// sum — which is exactly what makes the *carried* case below distinguishable.
function shipping(n: number, count: number): DeliveryCycleInput {
  return cycleAt(
    n,
    Array.from({ length: count }, (_, index) => ({
      id: `c-${n}-i-${index}`,
      status: 'done' as const,
      cycleId: `c-${n}`,
    })),
  )
}

function section(sections: readonly DeliverySection[], key: string): DeliverySection | undefined {
  return sections.find((candidate) => candidate.key === key)
}

function metric(
  sections: readonly DeliverySection[],
  sectionKey: string,
  key: string,
): DeliveryMetric | undefined {
  return section(sections, sectionKey)?.metrics.find((candidate) => candidate.key === key)
}

describe('buildDeliveryWindow — value, trend and delta are three different readings', () => {
  const cycles = [shipping(4, 3), shipping(5, 1), shipping(6, 5)]
  const priorCycles = [shipping(1, 2), shipping(2, 2), shipping(3, 2)]

  it('reports the window aggregate as the value and the per-cycle series as the sparkline', () => {
    const built = buildDeliveryWindow({ cycles, priorCycles, size: 3 })
    const shipped = metric(built?.sections ?? [], 'delivered', 'shipped')
    expect(shipped?.value).toBe(9)
    expect(shipped?.trend).toEqual([3, 1, 5])
  })

  it('compares against the preceding window of the same length, not the last sparkline point', () => {
    const built = buildDeliveryWindow({ cycles, priorCycles, size: 3 })
    // 9 shipped this window against 6 in the one before it — not 9 against the 5 of cycle 6.
    expect(metric(built?.sections ?? [], 'delivered', 'shipped')?.delta).toBe(3)
  })

  it('drops the delta when fewer than two full windows of completed cycles exist', () => {
    const short = buildDeliveryWindow({ cycles, priorCycles: [shipping(3, 2)], size: 3 })
    expect(metric(short?.sections ?? [], 'delivered', 'shipped')?.delta).toBeNull()

    const noPrior = buildDeliveryWindow({ cycles, size: 3 })
    expect(metric(noPrior?.sections ?? [], 'delivered', 'shipped')?.delta).toBeNull()
  })

  it('labels a partial window with what it actually contains, and drops its delta', () => {
    const partial = buildDeliveryWindow({ cycles: [shipping(6, 5)], priorCycles, size: 6 })
    expect(partial?.label).toBe('Last 1 completed cycle')
    expect(partial?.cycleCount).toBe(1)
    expect(metric(partial?.sections ?? [], 'delivered', 'shipped')?.delta).toBeNull()
  })

  it('names the window in the label and in every caption', () => {
    const built = buildDeliveryWindow({ cycles, priorCycles, size: 3 })
    expect(built?.label).toBe('Last 3 completed cycles')
    for (const entry of section(built?.sections ?? [], 'delivered')?.metrics ?? []) {
      expect(entry.caption).toContain('3 completed cycles')
    }
  })
})

describe('buildDeliveryWindow — the bound and the empty case', () => {
  it('clamps to twelve cycles inside the builder, whatever the caller asks for', () => {
    const many = Array.from({ length: 20 }, (_, index) => shipping(index, 1))
    const built = buildDeliveryWindow({ cycles: many, size: 40 })
    expect(built?.cycleCount).toBe(MAX_DELIVERY_WINDOW)
    expect(metric(built?.sections ?? [], 'delivered', 'shipped')?.trend).toHaveLength(
      MAX_DELIVERY_WINDOW,
    )
  })

  it('returns null when the window contains no cycle at all', () => {
    expect(buildDeliveryWindow({ cycles: [], size: 6 })).toBeNull()
  })

  it('takes the most recent cycles when more than the size are supplied', () => {
    const built = buildDeliveryWindow({
      cycles: [shipping(1, 1), shipping(2, 2), shipping(3, 3)],
      size: 2,
    })
    expect(metric(built?.sections ?? [], 'delivered', 'shipped')?.trend).toEqual([2, 3])
  })
})

describe('buildDeliveryWindow — Flow degrades to one named empty state', () => {
  it('renders the connector empty state, not zeros, when no window issue has a linked PR', () => {
    const built = buildDeliveryWindow({ cycles: [shipping(1, 2), shipping(2, 2)], size: 6 })
    const flow = section(built?.sections ?? [], 'flow')
    expect(flow?.state).toBe('empty')
    expect(flow?.metrics).toEqual([])
    expect(flow?.emptyState?.detail).toContain('GitHub')
    expect(flow?.emptyState?.detail).toContain('2 completed cycles')
  })

  it('pools pull requests across the window rather than taking a median of medians', () => {
    const linked: readonly DeliveryCycleInput[] = [
      cycleAt(1, [
        {
          id: 'p-1',
          status: 'done',
          cycleId: 'c-1',
          pullRequests: [
            {
              openedAt: START,
              mergedAt: START + 10 * HOUR,
              reviewSubmittedAt: [START + 6 * HOUR],
              ciConclusions: ['success'],
            },
          ],
        },
      ]),
      cycleAt(2, [
        {
          id: 'p-2',
          status: 'done',
          cycleId: 'c-2',
          pullRequests: [
            {
              openedAt: START,
              mergedAt: START + 20 * HOUR,
              reviewSubmittedAt: [START + 2 * HOUR],
              ciConclusions: ['failure', 'success'],
            },
          ],
        },
      ]),
    ]
    const built = buildDeliveryWindow({ cycles: linked, size: 6 })
    expect(section(built?.sections ?? [], 'flow')?.state).toBe('ready')
    expect(metric(built?.sections ?? [], 'flow', 'pr_cycle_time')?.value).toBe(15)
    expect(metric(built?.sections ?? [], 'flow', 'ci_failing_rate')?.value).toBe(50)
    // Per-cycle points, one each — the value is the pooled median, not their average.
    expect(metric(built?.sections ?? [], 'flow', 'pr_cycle_time')?.trend).toEqual([10, 20])
  })

  // A cycle nobody linked a pull request to is a HOLE in the series, not an absent slot. Dropping it
  // would re-space the surviving points as if they had been consecutive and make the sparkline's
  // own label claim a cycle count the window does not have.
  it('keeps one trend slot per cycle when a cycle has nothing to measure', () => {
    const gapped: readonly DeliveryCycleInput[] = [
      cycleAt(1, [
        {
          id: 'g-1',
          status: 'done',
          cycleId: 'c-1',
          pullRequests: [{ openedAt: START, mergedAt: START + 10 * HOUR }],
        },
      ]),
      // No linked pull request at all: every flow measure for this cycle is undefined.
      shipping(2, 2),
      cycleAt(3, [
        {
          id: 'g-3',
          status: 'done',
          cycleId: 'c-3',
          pullRequests: [{ openedAt: START, mergedAt: START + 20 * HOUR }],
        },
      ]),
    ]
    const built = buildDeliveryWindow({ cycles: gapped, size: 3 })
    const cycleTime = metric(built?.sections ?? [], 'flow', 'pr_cycle_time')
    expect(cycleTime?.trend).toHaveLength(built?.cycleCount as number)
    expect(cycleTime?.trend).toEqual([10, undefined, 20])
  })
})

describe('buildDeliveryWindow — the blameless guarantee at the window entry point', () => {
  it('carries NO identity dimension at any depth', () => {
    const built = buildDeliveryWindow({
      cycles: [shipping(1, 2), shipping(2, 3)],
      priorCycles: [shipping(-1, 1), shipping(0, 1)],
      size: 2,
    })
    const keys = collectKeys(built)
    // Proof the walk reached the window before anything is claimed about what it did not find.
    expect(keys.has('sections')).toBe(true)
    expect(keys.has('metrics')).toBe(true)
    expect(keys.has('caption')).toBe(true)

    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) {
      expect(keys.has(forbidden), forbidden).toBe(false)
    }
  })

  it('narrates the system in every caption, never a person', () => {
    const built = buildDeliveryWindow({ cycles: [shipping(1, 2)], size: 3 })
    const captions = (built?.sections ?? []).flatMap((entry) =>
      entry.metrics.map((candidate) => candidate.caption),
    )
    expect(captions.length).toBeGreaterThan(0)
    for (const caption of captions) {
      expect(caption).not.toMatch(/\b(who|someone|they were|he |she )\b/iu)
    }
  })

  it('is deterministic: the same input always produces the same window', () => {
    const input = { cycles: [shipping(1, 2), shipping(2, 3)], size: 3 }
    expect(buildDeliveryWindow(input)).toEqual(buildDeliveryWindow(input))
  })
})
