import { describe, expect, it } from 'vitest'
import {
  buildRetroSeed,
  type RetroSeed,
  type RetroSeedCycleInput,
  type RetroSeedMetric,
} from './seed.js'

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000
const END = START + 14 * DAY

// A cycle with no connector data at all — every team on day one.
const cyclesOnly: RetroSeedCycleInput = {
  id: 'cycle-2',
  name: 'Cycle 2',
  startDate: START,
  issues: [
    { id: 'i-shipped-1', status: 'done', cycleId: 'cycle-2' },
    { id: 'i-shipped-2', status: 'done', cycleId: 'cycle-2' },
    { id: 'i-canceled', status: 'canceled', cycleId: 'cycle-2' },
    // Joined a week after the cycle opened.
    { id: 'i-late', status: 'in_progress', cycleId: 'cycle-2', cycleAssignedAt: START + 7 * DAY },
    // Rolled in from the previous cycle and still here.
    {
      id: 'i-carried-in',
      status: 'todo',
      cycleId: 'cycle-2',
      rolledOverFromCycleId: 'cycle-1',
      carryoverCount: 1,
      cycleAssignedAt: START,
    },
    // Carried OUT: the rollover re-pointed them at cycle-3, so they no longer point here.
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

const priorCycle: RetroSeedCycleInput = {
  id: 'cycle-1',
  name: 'Cycle 1',
  startDate: START - 14 * DAY,
  issues: [
    { id: 'p-shipped', status: 'done', cycleId: 'cycle-1' },
    {
      id: 'i-carried-in',
      status: 'todo',
      cycleId: 'cycle-2',
      rolledOverFromCycleId: 'cycle-1',
      carryoverCount: 1,
      cycleAssignedAt: START,
    },
  ],
}

function metric(seed: RetroSeed, section: string, key: string): RetroSeedMetric | undefined {
  return seed.sections
    .find((candidate) => candidate.key === section)
    ?.metrics.find((candidate) => candidate.key === key)
}

// Recursively collect every object key present in a value.
function allKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.add(key)
      allKeys(child, keys)
    }
  }
  return keys
}

describe('buildRetroSeed — Delivered, from cycles alone', () => {
  const seed = buildRetroSeed({ cycle: cyclesOnly, priorCycles: [priorCycle] })

  it('counts what shipped, what carried and what joined late', () => {
    expect(metric(seed, 'delivered', 'shipped')?.value).toBe(2)
    expect(metric(seed, 'delivered', 'canceled')?.value).toBe(1)
    expect(metric(seed, 'delivered', 'carried_out')?.value).toBe(2)
    expect(metric(seed, 'delivered', 'carried_in')?.value).toBe(1)
    expect(metric(seed, 'delivered', 'added_mid_cycle')?.value).toBe(1)
    // Five issues still pointing at the cycle plus the two the rollover carried out.
    expect(metric(seed, 'delivered', 'total')?.value).toBe(7)
  })

  it('distinguishes an item that has carried twice or more', () => {
    expect(metric(seed, 'delivered', 'carried_twice_plus')?.value).toBe(1)
  })

  it('does not read a carried-out issue’s new cycle stamp as this cycle’s scope creep', () => {
    // Both carried-out issues were stamped at rollover time, which is after this cycle started.
    expect(metric(seed, 'delivered', 'added_mid_cycle')?.value).toBe(1)
  })

  it('leads with the trend: prior cycles oldest-first, this cycle last', () => {
    expect(metric(seed, 'delivered', 'shipped')?.trend).toEqual([1, 2])
    expect(metric(seed, 'delivered', 'shipped')?.delta).toBe(1)
  })

  it('has no delta on the first cycle a team ever runs', () => {
    const first = buildRetroSeed({ cycle: cyclesOnly })
    expect(metric(first, 'delivered', 'shipped')?.delta).toBeNull()
    expect(metric(first, 'delivered', 'shipped')?.trend).toEqual([2])
  })

  it('keeps at most three prior cycles in the sparkline', () => {
    const priors = [1, 2, 3, 4].map((n) => ({ ...priorCycle, id: `old-${n}` }))
    const seeded = buildRetroSeed({ cycle: cyclesOnly, priorCycles: priors })
    expect(metric(seeded, 'delivered', 'shipped')?.trend).toHaveLength(4)
  })
})

describe('buildRetroSeed — Flow degrades to a named empty state', () => {
  it('renders one quiet empty state, not zeros, when no delivery data exists', () => {
    const seed = buildRetroSeed({ cycle: cyclesOnly })
    const flow = seed.sections.find((section) => section.key === 'flow')
    expect(flow?.state).toBe('empty')
    expect(flow?.metrics).toEqual([])
    expect(flow?.emptyState?.detail).toContain('GitHub')
  })

  it('lights up with median cycle time, review wait and CI health together', () => {
    const withPrs: RetroSeedCycleInput = {
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
    const seed = buildRetroSeed({ cycle: withPrs })
    const flow = seed.sections.find((section) => section.key === 'flow')
    expect(flow?.state).toBe('ready')
    expect(metric(seed, 'flow', 'pr_cycle_time')?.value).toBe(15)
    expect(metric(seed, 'flow', 'time_to_first_review')?.value).toBe(4)
    expect(metric(seed, 'flow', 'review_rounds')?.value).toBe(1.5)
    expect(metric(seed, 'flow', 'issues_without_pr')?.value).toBe(1)
    // Speed and stability ship as a pair.
    expect(metric(seed, 'flow', 'ci_failing_rate')?.value).toBe(50)
  })

  it('drops a flow metric with nothing behind it rather than reporting zero', () => {
    const unmerged: RetroSeedCycleInput = {
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
    const seed = buildRetroSeed({ cycle: unmerged })
    expect(metric(seed, 'flow', 'pr_cycle_time')).toBeUndefined()
    expect(metric(seed, 'flow', 'time_to_first_review')).toBeUndefined()
    expect(metric(seed, 'flow', 'issues_without_pr')?.value).toBe(0)
  })
})

describe('buildRetroSeed — the blameless guarantees', () => {
  const seed = buildRetroSeed({ cycle: cyclesOnly, priorCycles: [priorCycle] })

  it('carries NO identity dimension at any depth, so a per-person number is not renderable', () => {
    const keys = allKeys(seed)
    for (const forbidden of [
      'assignee',
      'assigneeId',
      'author',
      'authorId',
      'reviewer',
      'reviewerId',
      'creator',
      'creatorId',
      'voter',
      'voterId',
      'facilitator',
      'facilitatorId',
      'user',
      'userId',
      'user_id',
      'member',
    ]) {
      expect(keys.has(forbidden), forbidden).toBe(false)
    }
  })

  it('produces no health section — DORA and MTTR are a later phase, not a hollow one', () => {
    expect(seed.sections.map((section) => section.key)).toEqual(['delivered', 'flow'])
  })

  it('narrates the system in every caption, never a person', () => {
    const captions = seed.sections.flatMap((section) =>
      section.metrics.map((entry) => entry.caption),
    )
    expect(captions.length).toBeGreaterThan(0)
    for (const caption of captions) {
      expect(caption.length).toBeGreaterThan(0)
      expect(caption).not.toMatch(/\b(who|someone|they were|he |she )\b/iu)
    }
    expect(metric(seed, 'delivered', 'carried_twice_plus')?.caption).toContain('re-scoping')
  })

  it('is deterministic: the same input always produces the same panel', () => {
    expect(buildRetroSeed({ cycle: cyclesOnly, priorCycles: [priorCycle] })).toEqual(seed)
  })
})
