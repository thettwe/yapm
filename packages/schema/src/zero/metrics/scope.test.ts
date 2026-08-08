import { describe, expect, it } from 'vitest'
import {
  type DeliveryCycleInput,
  type DeliveryPrInput,
  deliveredCounts,
  flowMeasures,
  pullRequests,
  scopeOfCycle,
  scopeOfCycles,
} from './scope.js'

// The reduction proof. `scope.ts` generalized four membership expressions from `=== cycle.id` to a
// lookup in a map of cycle starts; for a ONE-ENTRY map every one of them has to reduce to the
// expression it replaced, or the retro silently changed. The fixtures below are the ones
// `retro/seed.test.ts` asserts against, read through the generalized functions instead.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000
const END = START + 14 * DAY

const cyclesOnly: DeliveryCycleInput = {
  id: 'cycle-2',
  name: 'Cycle 2',
  startDate: START,
  issues: [
    { id: 'i-shipped-1', status: 'done', cycleId: 'cycle-2' },
    { id: 'i-shipped-2', status: 'done', cycleId: 'cycle-2' },
    { id: 'i-canceled', status: 'canceled', cycleId: 'cycle-2' },
    { id: 'i-late', status: 'in_progress', cycleId: 'cycle-2', cycleAssignedAt: START + 7 * DAY },
    {
      id: 'i-carried-in',
      status: 'todo',
      cycleId: 'cycle-2',
      rolledOverFromCycleId: 'cycle-1',
      carryoverCount: 1,
      cycleAssignedAt: START,
    },
    {
      id: 'i-carried-out-1',
      status: 'todo',
      cycleId: 'cycle-3',
      rolledOverFromCycleId: 'cycle-2',
      carryoverCount: 1,
      cycleAssignedAt: END,
    },
    {
      id: 'i-carried-out-twice',
      status: 'in_progress',
      cycleId: 'cycle-3',
      rolledOverFromCycleId: 'cycle-2',
      carryoverCount: 2,
      cycleAssignedAt: END,
    },
  ],
}

describe('scopeOfCycle — the one-cycle scope reduces to the retro’s reading', () => {
  const counts = deliveredCounts(scopeOfCycle(cyclesOnly))

  it('counts what shipped, what carried and what joined late', () => {
    expect(counts).toEqual({
      total: 7,
      shipped: 2,
      carriedOut: 2,
      carriedIn: 1,
      carriedTwicePlus: 1,
      addedMidCycle: 1,
      canceled: 1,
    })
  })

  it('does not read a carried-out issue’s new cycle stamp as this cycle’s scope creep', () => {
    expect(counts.addedMidCycle).toBe(1)
  })

  // An issue can be assigned back into the cycle it rolled out of, leaving `cycle_id` and
  // `rolled_over_from_cycle_id` naming the same cycle. The hop the marker records was undone, so it
  // is a carry of nothing — the reading the retro has always given, and the one input where reading
  // `carriedTwicePlus` off the raw marker would have changed the retro's number.
  it('does not count an issue re-assigned back into the cycle it rolled out of', () => {
    const undone: DeliveryCycleInput = {
      ...cyclesOnly,
      issues: [
        {
          id: 'i-back',
          status: 'in_progress',
          cycleId: 'cycle-2',
          rolledOverFromCycleId: 'cycle-2',
          carryoverCount: 2,
        },
      ],
    }
    const counts = deliveredCounts(scopeOfCycle(undone))
    expect(counts.carriedTwicePlus).toBe(0)
    expect(counts.carriedOut).toBe(0)
    expect(counts.carriedIn).toBe(0)
    expect(counts.total).toBe(1)
  })

  it('reports no flow measure at all rather than zeros when nothing is linked', () => {
    expect(flowMeasures(scopeOfCycle(cyclesOnly))).toEqual({
      prCycleTimeHours: undefined,
      timeToFirstReviewHours: undefined,
      reviewRounds: undefined,
      issuesWithoutPr: undefined,
      ciFailingRate: undefined,
    })
  })

  it('pools medians and the CI rate exactly as the retro asserts them', () => {
    const withPrs: DeliveryCycleInput = {
      ...cyclesOnly,
      issues: [
        {
          id: 'i-shipped-1',
          status: 'done',
          cycleId: 'cycle-2',
          pullRequests: [
            {
              openedAt: START,
              mergedAt: START + 10 * HOUR,
              reviewSubmittedAt: [START + 6 * HOUR, START + 8 * HOUR],
              ciConclusions: ['success'],
            },
          ],
        },
        {
          id: 'i-shipped-2',
          status: 'done',
          cycleId: 'cycle-2',
          pullRequests: [
            {
              openedAt: START,
              mergedAt: START + 20 * HOUR,
              reviewSubmittedAt: [START + 2 * HOUR],
              ciConclusions: ['failure', 'success'],
            },
          ],
        },
        { id: 'i-bare', status: 'todo', cycleId: 'cycle-2' },
      ],
    }
    expect(flowMeasures(scopeOfCycle(withPrs))).toEqual({
      prCycleTimeHours: 15,
      timeToFirstReviewHours: 4,
      reviewRounds: 1.5,
      issuesWithoutPr: 1,
      ciFailingRate: 50,
    })
  })

  it('drops a measure with nothing behind it rather than reporting zero', () => {
    const unmerged: DeliveryCycleInput = {
      ...cyclesOnly,
      issues: [
        {
          id: 'i-open',
          status: 'in_review',
          cycleId: 'cycle-2',
          pullRequests: [{ openedAt: START }],
        },
      ],
    }
    const measures = flowMeasures(scopeOfCycle(unmerged))
    expect(measures.prCycleTimeHours).toBeUndefined()
    expect(measures.timeToFirstReviewHours).toBeUndefined()
    expect(measures.issuesWithoutPr).toBe(0)
  })
})

// A three-cycle window where one issue has been carried twice and now sits in cycle 3, one is
// carried out of the window entirely, and one joins cycle 3 late.
//
// An issue is ONE row, so it appears in every cycle it touches with the SAME shape — `carryover_count`
// and `rolled_over_from_cycle_id` record the latest hop only, which is why the twice-carried issue
// below shows up under w-2 (the cycle it was last carried out of) and w-3 (the cycle it points at),
// and not under w-1. `issuesTouching` in the web app builds exactly these lists.
function windowCycle(n: number, issues: DeliveryCycleInput['issues']): DeliveryCycleInput {
  return { id: `w-${n}`, name: `Cycle ${n}`, startDate: START + n * 14 * DAY, issues }
}

const twiceCarried = {
  id: 'twice',
  status: 'in_progress',
  cycleId: 'w-3',
  rolledOverFromCycleId: 'w-2',
  carryoverCount: 2,
  cycleAssignedAt: START + 3 * 14 * DAY,
} as const

const leftTheWindow = {
  id: 'left',
  status: 'todo',
  cycleId: 'w-4',
  rolledOverFromCycleId: 'w-3',
  carryoverCount: 1,
  cycleAssignedAt: START + 4 * 14 * DAY,
} as const

const cameFromOutside = {
  id: 'outside',
  status: 'todo',
  cycleId: 'w-1',
  rolledOverFromCycleId: 'w-0',
  carryoverCount: 1,
  cycleAssignedAt: START + 14 * DAY,
} as const

const windowCycles: readonly DeliveryCycleInput[] = [
  windowCycle(1, [{ id: 'a', status: 'done', cycleId: 'w-1' }, cameFromOutside]),
  windowCycle(2, [{ id: 'b', status: 'done', cycleId: 'w-2' }, twiceCarried]),
  windowCycle(3, [
    { id: 'c', status: 'done', cycleId: 'w-3' },
    twiceCarried,
    leftTheWindow,
    {
      id: 'late',
      status: 'todo',
      cycleId: 'w-3',
      cycleAssignedAt: START + 3 * 14 * DAY + 4 * DAY,
    },
  ]),
]

describe('scopeOfCycles — the window reading is exact, not a sum of cycles', () => {
  const counts = deliveredCounts(scopeOfCycles(windowCycles))

  it('counts distinct issues, so a twice-carried issue is not counted twice', () => {
    // a, b, c, late, outside, twice (in w-3) and left (carried out) = 7.
    expect(counts.total).toBe(7)
    const perCycle = windowCycles.map((cycle) => deliveredCounts(scopeOfCycle(cycle)).total)
    expect(perCycle.reduce((sum, entry) => sum + entry, 0)).toBeGreaterThan(counts.total)
  })

  it('counts only the issues that carried out of the WINDOW, not between its cycles', () => {
    expect(counts.carriedOut).toBe(1)
    // Two carry-outs happened inside the window — one out of w-2 and one out of w-3 — and only the
    // second of them left the window at all.
    const perCycle = windowCycles.map((cycle) => deliveredCounts(scopeOfCycle(cycle)).carriedOut)
    expect(perCycle).toEqual([0, 1, 1])
  })

  // The one Delivered count that is NOT relative to the window's outer edge. `twice` was carried out
  // of w-2 for the second time and landed in w-3, so it never left the window — reading this off
  // `carriedOut` would report zero while the tile's own sparkline plots a one.
  it('counts a repeat rollover between two window cycles, not only one that left the window', () => {
    expect(counts.carriedTwicePlus).toBe(1)
    const perCycle = windowCycles.map(
      (cycle) => deliveredCounts(scopeOfCycle(cycle)).carriedTwicePlus,
    )
    expect(perCycle).toEqual([0, 1, 0])
  })

  it('still reads an undone carry as no carry when the scope is a window', () => {
    const undone = {
      id: 'undone',
      status: 'todo',
      cycleId: 'w-2',
      rolledOverFromCycleId: 'w-2',
      carryoverCount: 3,
    } as const
    const withUndone = windowCycles.map((cycle) =>
      cycle.id === 'w-2' ? { ...cycle, issues: [...cycle.issues, undone] } : cycle,
    )
    expect(deliveredCounts(scopeOfCycles(withUndone)).carriedTwicePlus).toBe(1)
  })

  it('counts only the issues that carried in from OUTSIDE the window', () => {
    expect(counts.carriedIn).toBe(1)
  })

  it('reads "added mid-cycle" against the issue’s own cycle start, not the window’s', () => {
    // `late` joined w-3 four days in. Every other in-scope issue was stamped at its own cycle start
    // or has no stamp — but the twice-carried issue was stamped at w-3's start, which is long after
    // the WINDOW opened, so a window-wide comparison would report it as scope creep too.
    expect(counts.addedMidCycle).toBe(1)
  })

  it('shipped and canceled pool across the window', () => {
    expect(counts.shipped).toBe(3)
    expect(counts.canceled).toBe(0)
  })
})

// The population fix. A pull request linked to two issues in scope reaches `pullRequests` through
// both of them, and counting it twice pulls every median and every rate towards whatever that one
// change happens to be — invisible in a stated number, and two dots for one change in a drawing.
describe('pullRequests — one change linked to two in-scope issues is one change', () => {
  const shared: DeliveryPrInput = {
    id: 'pr-shared',
    openedAt: START,
    mergedAt: START + 30 * HOUR,
    reviewSubmittedAt: [START + 4 * HOUR],
    ciConclusions: ['failure', 'success'],
  }
  const solo: DeliveryPrInput = {
    id: 'pr-solo',
    openedAt: START,
    mergedAt: START + 10 * HOUR,
    reviewSubmittedAt: [START + 2 * HOUR],
    ciConclusions: ['success'],
  }

  function cycleWith(prs: {
    readonly shared: DeliveryPrInput
    readonly solo: DeliveryPrInput
  }): DeliveryCycleInput {
    return {
      id: 'cycle-2',
      name: 'Cycle 2',
      startDate: START,
      issues: [
        { id: 'linked-a', status: 'done', cycleId: 'cycle-2', pullRequests: [prs.shared] },
        { id: 'linked-b', status: 'done', cycleId: 'cycle-2', pullRequests: [prs.shared] },
        { id: 'linked-c', status: 'done', cycleId: 'cycle-2', pullRequests: [prs.solo] },
      ],
    }
  }

  const scope = scopeOfCycle(cycleWith({ shared, solo }))

  it('appears once in the population', () => {
    expect(pullRequests(scope).map((pr) => pr.id)).toEqual(['pr-shared', 'pr-solo'])
  })

  it('contributes once to the median cycle time and once to the CI failing rate', () => {
    const measures = flowMeasures(scope)
    // Two changes, 30h and 10h: the median is 20. Counted twice it would be 30.
    expect(measures.prCycleTimeHours).toBe(20)
    // One of two changes had a failing check. Counted twice it would be 67%.
    expect(measures.ciFailingRate).toBe(50)
    expect(measures.timeToFirstReviewHours).toBe(3)
    expect(measures.reviewRounds).toBe(1)
  })

  it('leaves an id-less projection exactly as it was', () => {
    const anonymous = cycleWith({
      shared: { ...shared, id: undefined },
      solo: { ...solo, id: undefined },
    })
    const measures = flowMeasures(scopeOfCycle(anonymous))
    expect(pullRequests(scopeOfCycle(anonymous))).toHaveLength(3)
    expect(measures.prCycleTimeHours).toBe(30)
    expect(measures.ciFailingRate).toBe(67)
  })

  it('de-duplicates across the cycles of a window, not only within one', () => {
    const windowed = scopeOfCycles([
      { id: 'w-1', name: 'Cycle 1', startDate: START, issues: [] },
      cycleWith({ shared, solo }),
    ])
    expect(pullRequests(windowed)).toHaveLength(2)
  })
})
