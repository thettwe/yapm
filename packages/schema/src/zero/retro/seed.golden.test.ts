import { describe, expect, it } from 'vitest'
import { buildRetroSeed, type RetroSeedCycleInput } from './seed.js'

// The tripwire for the scope generalization. `seed.test.ts` asserts the metrics a reader cares
// about; this asserts the WHOLE object — every key, every label, every unit, every trend point,
// every delta, every caption, both empty states — for three fixtures. The refactor that moves the
// formulas into `metrics/` is allowed to change none of it. If a snapshot below needs regenerating,
// the generalization is wrong, not the snapshot.

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const START = 1_700_000_000_000

function cycleAt(n: number, issues: RetroSeedCycleInput['issues']): RetroSeedCycleInput {
  return { id: `cycle-${n}`, name: `Cycle ${n}`, startDate: START + n * 14 * DAY, issues }
}

// One cycle plus three priors, every Delivered facet exercised and no connector data anywhere.
const priorA = cycleAt(1, [
  { id: 'a-1', status: 'done', cycleId: 'cycle-1' },
  { id: 'a-2', status: 'todo', cycleId: 'cycle-2', rolledOverFromCycleId: 'cycle-1' },
])
const priorB = cycleAt(2, [
  { id: 'a-2', status: 'todo', cycleId: 'cycle-2', rolledOverFromCycleId: 'cycle-1' },
  { id: 'b-1', status: 'done', cycleId: 'cycle-2' },
  { id: 'b-2', status: 'done', cycleId: 'cycle-2' },
  { id: 'b-3', status: 'canceled', cycleId: 'cycle-2' },
])
const priorC = cycleAt(3, [
  { id: 'c-1', status: 'done', cycleId: 'cycle-3' },
  {
    id: 'c-2',
    status: 'in_progress',
    cycleId: 'cycle-4',
    rolledOverFromCycleId: 'cycle-3',
    carryoverCount: 2,
  },
  {
    id: 'c-3',
    status: 'todo',
    cycleId: 'cycle-3',
    cycleAssignedAt: START + 3 * 14 * DAY + 5 * DAY,
  },
])
const current = cycleAt(4, [
  { id: 'd-1', status: 'done', cycleId: 'cycle-4' },
  { id: 'd-2', status: 'done', cycleId: 'cycle-4' },
  { id: 'd-3', status: 'canceled', cycleId: 'cycle-4' },
  {
    id: 'c-2',
    status: 'in_progress',
    cycleId: 'cycle-4',
    rolledOverFromCycleId: 'cycle-3',
    carryoverCount: 2,
  },
  {
    id: 'd-4',
    status: 'todo',
    cycleId: 'cycle-4',
    cycleAssignedAt: START + 4 * 14 * DAY + 6 * DAY,
  },
  {
    id: 'd-5',
    status: 'in_review',
    cycleId: 'cycle-5',
    rolledOverFromCycleId: 'cycle-4',
    carryoverCount: 3,
  },
])

// The same four cycles with connector-fed pull requests hung off them, so the Flow section is
// populated and carries a trend of its own.
function withPrs(cycle: RetroSeedCycleInput, offset: number): RetroSeedCycleInput {
  return {
    ...cycle,
    issues: cycle.issues.map((issue, index) =>
      index % 2 === 0
        ? {
            ...issue,
            pullRequests: [
              {
                openedAt: cycle.startDate,
                mergedAt: cycle.startDate + (8 + offset + index) * HOUR,
                reviewSubmittedAt: [
                  cycle.startDate + (2 + offset) * HOUR,
                  cycle.startDate + (5 + offset) * HOUR,
                ],
                ciConclusions:
                  index === 0 ? (['failure', 'success'] as const) : (['success'] as const),
              },
            ],
          }
        : issue,
    ),
  }
}

describe('buildRetroSeed — golden output', () => {
  it('one cycle plus three priors, cycles only', () => {
    expect(
      buildRetroSeed({ cycle: current, priorCycles: [priorA, priorB, priorC] }),
    ).toMatchInlineSnapshot(`
      {
        "cycleId": "cycle-4",
        "cycleName": "Cycle 4",
        "sections": [
          {
            "key": "delivered",
            "metrics": [
              {
                "betterWhen": "higher",
                "caption": "2 of 6 issues in scope shipped.",
                "delta": 1,
                "key": "shipped",
                "label": "Shipped",
                "trend": [
                  1,
                  2,
                  1,
                  2,
                ],
                "unit": "count",
                "value": 2,
              },
              {
                "betterWhen": "lower",
                "caption": "1 issue carried into the next cycle rather than being dropped.",
                "delta": 0,
                "key": "carried_out",
                "label": "Carried out",
                "trend": [
                  1,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "1 issue was already in flight when the cycle opened.",
                "delta": 1,
                "key": "carried_in",
                "label": "Carried in",
                "trend": [
                  0,
                  1,
                  0,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": "lower",
                "caption": "1 item has now carried twice or more, which usually means re-scoping rather than re-committing.",
                "delta": 0,
                "key": "carried_twice_plus",
                "label": "Carried twice or more",
                "trend": [
                  0,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": "lower",
                "caption": "1 item joined after the cycle started.",
                "delta": 0,
                "key": "added_mid_cycle",
                "label": "Added mid-cycle",
                "trend": [
                  0,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "1 issue was canceled during the cycle.",
                "delta": 1,
                "key": "canceled",
                "label": "Canceled",
                "trend": [
                  0,
                  1,
                  0,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "6 issues touched this cycle, carried work included.",
                "delta": 3,
                "key": "total",
                "label": "In scope",
                "trend": [
                  2,
                  4,
                  3,
                  6,
                ],
                "unit": "count",
                "value": 6,
              },
            ],
            "state": "ready",
            "title": "Delivered",
          },
          {
            "emptyState": {
              "detail": "Connect GitHub to see pull-request cycle time, review wait and CI health for this cycle. Until then the Delivered section above is computed from cycles alone.",
              "title": "No delivery data yet",
            },
            "key": "flow",
            "metrics": [],
            "state": "empty",
            "title": "Flow",
          },
        ],
      }
    `)
  })

  it('a connector-less team on its very first cycle', () => {
    expect(buildRetroSeed({ cycle: cycleAt(1, priorA.issues) })).toMatchInlineSnapshot(`
      {
        "cycleId": "cycle-1",
        "cycleName": "Cycle 1",
        "sections": [
          {
            "key": "delivered",
            "metrics": [
              {
                "betterWhen": "higher",
                "caption": "1 of 2 issues in scope shipped.",
                "delta": null,
                "key": "shipped",
                "label": "Shipped",
                "trend": [
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": "lower",
                "caption": "1 issue carried into the next cycle rather than being dropped.",
                "delta": null,
                "key": "carried_out",
                "label": "Carried out",
                "trend": [
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "0 issues were already in flight when the cycle opened.",
                "delta": null,
                "key": "carried_in",
                "label": "Carried in",
                "trend": [
                  0,
                ],
                "unit": "count",
                "value": 0,
              },
              {
                "betterWhen": "lower",
                "caption": "Nothing has carried twice or more — the plan is holding.",
                "delta": null,
                "key": "carried_twice_plus",
                "label": "Carried twice or more",
                "trend": [
                  0,
                ],
                "unit": "count",
                "value": 0,
              },
              {
                "betterWhen": "lower",
                "caption": "Nothing joined the cycle after it started.",
                "delta": null,
                "key": "added_mid_cycle",
                "label": "Added mid-cycle",
                "trend": [
                  0,
                ],
                "unit": "count",
                "value": 0,
              },
              {
                "betterWhen": null,
                "caption": "0 issues were canceled during the cycle.",
                "delta": null,
                "key": "canceled",
                "label": "Canceled",
                "trend": [
                  0,
                ],
                "unit": "count",
                "value": 0,
              },
              {
                "betterWhen": null,
                "caption": "2 issues touched this cycle, carried work included.",
                "delta": null,
                "key": "total",
                "label": "In scope",
                "trend": [
                  2,
                ],
                "unit": "count",
                "value": 2,
              },
            ],
            "state": "ready",
            "title": "Delivered",
          },
          {
            "emptyState": {
              "detail": "Connect GitHub to see pull-request cycle time, review wait and CI health for this cycle. Until then the Delivered section above is computed from cycles alone.",
              "title": "No delivery data yet",
            },
            "key": "flow",
            "metrics": [],
            "state": "empty",
            "title": "Flow",
          },
        ],
      }
    `)
  })

  it('a flow-populated cycle with three priors', () => {
    expect(
      buildRetroSeed({
        cycle: withPrs(current, 3),
        priorCycles: [withPrs(priorA, 0), withPrs(priorB, 1), withPrs(priorC, 2)],
      }),
    ).toMatchInlineSnapshot(`
      {
        "cycleId": "cycle-4",
        "cycleName": "Cycle 4",
        "sections": [
          {
            "key": "delivered",
            "metrics": [
              {
                "betterWhen": "higher",
                "caption": "2 of 6 issues in scope shipped.",
                "delta": 1,
                "key": "shipped",
                "label": "Shipped",
                "trend": [
                  1,
                  2,
                  1,
                  2,
                ],
                "unit": "count",
                "value": 2,
              },
              {
                "betterWhen": "lower",
                "caption": "1 issue carried into the next cycle rather than being dropped.",
                "delta": 0,
                "key": "carried_out",
                "label": "Carried out",
                "trend": [
                  1,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "1 issue was already in flight when the cycle opened.",
                "delta": 1,
                "key": "carried_in",
                "label": "Carried in",
                "trend": [
                  0,
                  1,
                  0,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": "lower",
                "caption": "1 item has now carried twice or more, which usually means re-scoping rather than re-committing.",
                "delta": 0,
                "key": "carried_twice_plus",
                "label": "Carried twice or more",
                "trend": [
                  0,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": "lower",
                "caption": "1 item joined after the cycle started.",
                "delta": 0,
                "key": "added_mid_cycle",
                "label": "Added mid-cycle",
                "trend": [
                  0,
                  0,
                  1,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "1 issue was canceled during the cycle.",
                "delta": 1,
                "key": "canceled",
                "label": "Canceled",
                "trend": [
                  0,
                  1,
                  0,
                  1,
                ],
                "unit": "count",
                "value": 1,
              },
              {
                "betterWhen": null,
                "caption": "6 issues touched this cycle, carried work included.",
                "delta": 3,
                "key": "total",
                "label": "In scope",
                "trend": [
                  2,
                  4,
                  3,
                  6,
                ],
                "unit": "count",
                "value": 6,
              },
            ],
            "state": "ready",
            "title": "Delivered",
          },
          {
            "key": "flow",
            "metrics": [
              {
                "betterWhen": "lower",
                "caption": "Pull requests took a median of 13h from open to merge.",
                "delta": 2,
                "key": "pr_cycle_time",
                "label": "PR cycle time",
                "trend": [
                  8,
                  10,
                  11,
                  13,
                ],
                "unit": "hours",
                "value": 13,
              },
              {
                "betterWhen": "lower",
                "caption": "Changes waited a median of 5h for their first review.",
                "delta": 1,
                "key": "time_to_first_review",
                "label": "Time to first review",
                "trend": [
                  2,
                  3,
                  4,
                  5,
                ],
                "unit": "hours",
                "value": 5,
              },
              {
                "betterWhen": "lower",
                "caption": "Reviews came back a median of 2 times per pull request.",
                "delta": 0,
                "key": "review_rounds",
                "label": "Review rounds",
                "trend": [
                  2,
                  2,
                  2,
                  2,
                ],
                "unit": "count",
                "value": 2,
              },
              {
                "betterWhen": "lower",
                "caption": "2 issues in scope have no linked pull request.",
                "delta": 2,
                "key": "issues_without_pr",
                "label": "No linked PR",
                "trend": [
                  0,
                  2,
                  0,
                  2,
                ],
                "unit": "count",
                "value": 2,
              },
              {
                "betterWhen": "lower",
                "caption": "33% of pull requests had a failing check — shown next to speed so neither is traded for the other.",
                "delta": -17,
                "key": "ci_failing_rate",
                "label": "CI failing",
                "trend": [
                  100,
                  50,
                  50,
                  33,
                ],
                "unit": "percent",
                "value": 33,
              },
            ],
            "state": "ready",
            "title": "Flow",
          },
        ],
      }
    `)
  })
})
