import type { RetroSeedMetric } from '@yapm/schema'
import { describe, expect, it } from 'vitest'
import {
  buildRetroSeedFor,
  formatSeedDelta,
  formatSeedValue,
  priorCyclesFor,
  type SeedCycleRow,
  type SeedIssueRow,
  seedTrendTone,
  sparklineGeometry,
} from './seed-model'

const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000

function cycle(over: Partial<SeedCycleRow> & { id: string }): SeedCycleRow {
  return {
    name: over.id,
    status: 'completed',
    number: null,
    startDate: START,
    ...over,
  }
}

function issue(over: Partial<SeedIssueRow> & { id: string }): SeedIssueRow {
  return { status: 'done', cycleId: null, ...over }
}

function metricOf(seed: ReturnType<typeof buildRetroSeedFor>, key: string): RetroSeedMetric {
  const found = (seed?.sections ?? [])
    .flatMap((section) => section.metrics)
    .find((m) => m.key === key)
  if (found === undefined) throw new Error(`no metric ${key}`)
  return found
}

describe('buildRetroSeedFor', () => {
  it('produces nothing when the retro has no cycle, or its cycle is outside the synced slice', () => {
    expect(buildRetroSeedFor(null, [cycle({ id: 'c1' })], [])).toBeNull()
    expect(buildRetroSeedFor('missing', [cycle({ id: 'c1' })], [])).toBeNull()
  })

  it('fills Delivered from cycles alone and names what would light up Flow', () => {
    const seed = buildRetroSeedFor(
      'c2',
      [
        cycle({ id: 'c1', number: 1 }),
        cycle({ id: 'c2', number: 2, startDate: START + 10 * HOUR, status: 'completed' }),
        cycle({ id: 'c3', number: 3, startDate: START + 20 * HOUR, status: 'upcoming' }),
      ],
      [
        issue({ id: 'i1', status: 'done', cycleId: 'c2' }),
        issue({ id: 'i2', status: 'done', cycleId: 'c2' }),
        // Carried OUT of c2: it points at c3 now but kept the origin marker, and it has carried
        // twice before.
        issue({
          id: 'i3',
          status: 'in_progress',
          cycleId: 'c3',
          rolledOverFromCycleId: 'c2',
          carryoverCount: 2,
        }),
        // Joined c2 after it started.
        issue({
          id: 'i4',
          status: 'todo',
          cycleId: 'c2',
          cycleAssignedAt: START + 15 * HOUR,
        }),
        issue({ id: 'i5', status: 'canceled', cycleId: 'c2' }),
        // Another team's cycle entirely — never counted.
        issue({ id: 'i6', status: 'done', cycleId: 'c1' }),
      ],
    )

    expect(seed).not.toBeNull()
    expect(metricOf(seed, 'shipped').value).toBe(2)
    expect(metricOf(seed, 'carried_out').value).toBe(1)
    expect(metricOf(seed, 'carried_twice_plus').value).toBe(1)
    expect(metricOf(seed, 'added_mid_cycle').value).toBe(1)
    expect(metricOf(seed, 'canceled').value).toBe(1)
    expect(metricOf(seed, 'total').value).toBe(5)

    const flow = seed?.sections.find((section) => section.key === 'flow')
    expect(flow?.state).toBe('empty')
    expect(flow?.metrics).toEqual([])
    expect(flow?.emptyState?.detail).toContain('Connect GitHub')
  })

  it('lights Flow up from the linked delivery subtree, speed beside stability', () => {
    const seed = buildRetroSeedFor(
      'c1',
      [cycle({ id: 'c1' })],
      [
        issue({
          id: 'i1',
          status: 'done',
          cycleId: 'c1',
          issueLinks: [
            {
              pullRequest: {
                openedAt: START,
                mergedAt: START + 10 * HOUR,
                reviews: [{ submittedAt: START + 6 * HOUR }],
                ciChecks: [{ conclusion: 'failure' }],
              },
            },
          ],
        }),
        issue({ id: 'i2', status: 'todo', cycleId: 'c1' }),
      ],
    )

    const flow = seed?.sections.find((section) => section.key === 'flow')
    expect(flow?.state).toBe('ready')
    expect(metricOf(seed, 'pr_cycle_time').value).toBe(10)
    expect(metricOf(seed, 'time_to_first_review').value).toBe(6)
    expect(metricOf(seed, 'ci_failing_rate').value).toBe(100)
    expect(metricOf(seed, 'issues_without_pr').value).toBe(1)
    // Review wait dominated the lead time, and the caption says so about the SYSTEM.
    expect(metricOf(seed, 'pr_cycle_time').caption).toContain('Review wait')
  })

  it('carries no identity dimension at any depth, whatever the synced rows hold', () => {
    const seed = buildRetroSeedFor(
      'c1',
      [cycle({ id: 'c1' })],
      [
        {
          ...issue({ id: 'i1', status: 'done', cycleId: 'c1' }),
          // Fields a synced issue really has and the panel must never carry through.
          ...({ assigneeId: 'u1', creatorId: 'u2' } as Record<string, unknown>),
          issueLinks: [
            {
              pullRequest: {
                openedAt: START,
                mergedAt: START + HOUR,
                reviews: [{ submittedAt: START + HOUR, ...({ author: 'u3' } as object) }],
              },
            },
          ],
        },
      ],
    )

    const identityish = /(assignee|author|reviewer|creator|user|member|owner|actor|login|email)/i
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const entry of value) walk(entry)
        return
      }
      if (value === null || typeof value !== 'object') return
      for (const [key, entry] of Object.entries(value)) {
        expect(key).not.toMatch(identityish)
        walk(entry)
      }
    }
    walk(seed)
  })
})

describe('priorCyclesFor', () => {
  const target = cycle({ id: 'target', number: 5 })

  it('keeps only completed cycles before this one, oldest first, at most three', () => {
    const priors = priorCyclesFor(target, [
      target,
      cycle({ id: 'a', number: 1 }),
      cycle({ id: 'b', number: 2 }),
      cycle({ id: 'c', number: 3 }),
      cycle({ id: 'd', number: 4 }),
      cycle({ id: 'active', number: 4.5, status: 'active' }),
      cycle({ id: 'later', number: 6 }),
    ])
    expect(priors.map((prior) => prior.id)).toEqual(['b', 'c', 'd'])
  })
})

describe('metric formatting', () => {
  const base: RetroSeedMetric = {
    key: 'k',
    label: 'Label',
    value: 4,
    unit: 'count',
    trend: [2, 4],
    delta: 2,
    betterWhen: 'higher',
    caption: 'caption',
  }

  it('renders a value in its own unit', () => {
    expect(formatSeedValue(base)).toBe('4')
    expect(formatSeedValue({ ...base, unit: 'hours' })).toBe('4h')
    expect(formatSeedValue({ ...base, unit: 'percent' })).toBe('4%')
  })

  it('states the movement in words, with the direction spelled out', () => {
    expect(formatSeedDelta(base)).toBe('+2 vs. last cycle')
    expect(formatSeedDelta({ ...base, delta: -1.5, unit: 'hours' })).toBe('−1.5h vs. last cycle')
    expect(formatSeedDelta({ ...base, delta: 0 })).toBe('no change')
    expect(formatSeedDelta({ ...base, delta: null })).toBeNull()
  })

  it('judges the trend only for a signal that has a better direction', () => {
    expect(seedTrendTone(base)).toBe('better')
    expect(seedTrendTone({ ...base, delta: -2 })).toBe('worse')
    expect(seedTrendTone({ ...base, betterWhen: 'lower', delta: -2 })).toBe('better')
    expect(seedTrendTone({ ...base, betterWhen: null })).toBe('neutral')
    expect(seedTrendTone({ ...base, delta: 0 })).toBeNull()
    expect(seedTrendTone({ ...base, delta: null })).toBeNull()
  })
})

describe('sparklineGeometry', () => {
  it('needs at least two points to be a trend', () => {
    expect(sparklineGeometry([], 60, 20)).toBeNull()
    expect(sparklineGeometry([3], 60, 20)).toBeNull()
  })

  it('draws a flat series on the mid-line rather than collapsing it to the floor', () => {
    const geometry = sparklineGeometry([4, 4, 4], 60, 20)
    expect(geometry?.segments).toEqual(['0,10 30,10 60,10'])
    expect(geometry?.last).toEqual({ x: 60, y: 10 })
  })

  it('maps the highest value to the top and the lowest to the bottom', () => {
    const geometry = sparklineGeometry([1, 5], 60, 20)
    expect(geometry?.segments).toEqual(['0,20 60,0'])
  })

  // A window cycle with nothing to measure keeps its x position and breaks the line, rather than
  // sliding its neighbours together as if they had been consecutive.
  it('spends the x position of an unmeasured cycle and breaks the line across it', () => {
    const geometry = sparklineGeometry([1, undefined, 5], 60, 20)
    expect(geometry?.segments).toEqual(['0,20 0,20', '60,0 60,0'])
    expect(geometry?.last).toEqual({ x: 60, y: 0 })
  })

  // A single-point polyline strokes nothing, so a window whose every measured cycle is isolated
  // would render an empty box. Each lone point carries its coordinate twice, which `linecap=round`
  // paints as a dot.
  it('renders an isolated measured cycle as a dot rather than as nothing', () => {
    const geometry = sparklineGeometry([2, undefined, 6, undefined, 4], 60, 20)
    expect(geometry?.segments).toEqual(['0,20 0,20', '30,0 30,0', '60,10 60,10'])
    expect(geometry?.last).toEqual({ x: 60, y: 10 })
  })

  it('needs two measured points, not two slots', () => {
    expect(sparklineGeometry([1, undefined, undefined], 60, 20)).toBeNull()
  })
})
