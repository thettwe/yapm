import { describe, expect, it } from 'vitest'
import {
  AUTO_STATUS_MAX_LINKED_ISSUES,
  AUTO_STATUS_RANK,
  type AutoStatusInput,
  decideAutoStatus,
} from './auto-status.js'
import { ISSUE_STATUSES, type IssueStatus, PULL_REQUEST_STATES } from './context.js'

const OPT_IN_AT = 1_700_000_000_000
const EVENT_AT = OPT_IN_AT + 60_000

// The one input that MUST produce a transition. Every guard case below is this object with exactly
// one field changed, so a case that returns null proves that field is what stopped it — and the
// first test asserts the baseline fires, which is what stops the whole table passing vacuously.
function firing(over: Partial<AutoStatusInput> = {}): AutoStatusInput {
  return {
    autoStatusSince: OPT_IN_AT,
    currentStatus: 'todo',
    needsTriage: false,
    lastHumanStatusAt: null,
    previousPrState: null,
    prState: 'open',
    eventAt: EVENT_AT,
    ...over,
  }
}

describe('AUTO_STATUS_RANK', () => {
  it('is the five-rung forward ladder, in order', () => {
    expect(AUTO_STATUS_RANK).toEqual({
      backlog: 0,
      todo: 1,
      in_progress: 2,
      in_review: 3,
      done: 4,
    })
  })

  // `canceled` has no rung, which is what makes "never touch a canceled issue" a property of the
  // type rather than of a branch someone can delete. Asserting the key is absent (not merely that
  // some guard rejects it) is what fails if a later change gives it a number.
  it('has no rung for canceled', () => {
    expect(Object.keys(AUTO_STATUS_RANK)).not.toContain('canceled')
    expect(Object.keys(AUTO_STATUS_RANK)).toHaveLength(ISSUE_STATUSES.length - 1)
  })

  it('covers every issue status except canceled', () => {
    for (const status of ISSUE_STATUSES) {
      if (status === 'canceled') continue
      expect(AUTO_STATUS_RANK, status).toHaveProperty(status)
    }
  })
})

it('bounds one delivery to 25 linked issues', () => {
  expect(AUTO_STATUS_MAX_LINKED_ISSUES).toBe(25)
})

describe('decideAutoStatus — the baseline fires', () => {
  it('moves a todo issue to in_review when its pull request opens', () => {
    expect(decideAutoStatus(firing())).toBe('in_review')
  })
})

describe('decideAutoStatus — each guard, driven on its own', () => {
  it.each<[string, Partial<AutoStatusInput>]>([
    ['1: automation is off for the team', { autoStatusSince: null }],
    ['2: the event predates the opt-in', { eventAt: OPT_IN_AT - 1 }],
    ['3: there is no state edge', { previousPrState: 'open' }],
    ['4: the issue is awaiting triage', { needsTriage: true }],
    ['5: the issue is canceled', { currentStatus: 'canceled' }],
    ['6: human intent is newer than the event', { lastHumanStatusAt: EVENT_AT + 1 }],
    ['7: the pull-request state drives nothing', { prState: 'draft' }],
    ['8: the target is not above the current rung', { currentStatus: 'in_review' }],
  ])('guard %s returns null', (_label, over) => {
    expect(decideAutoStatus(firing(over))).toBeNull()
  })
})

describe('decideAutoStatus — the transitions that must fire', () => {
  it('moves todo to in_review on an opened pull request', () => {
    expect(decideAutoStatus(firing({ currentStatus: 'todo' }))).toBe('in_review')
  })

  it('moves in_progress to done on a merge', () => {
    expect(
      decideAutoStatus(
        firing({ currentStatus: 'in_progress', previousPrState: 'open', prState: 'merged' }),
      ),
    ).toBe('done')
  })

  // Two rungs at once: the ladder is a floor, not a step counter, so an issue nobody ever moved out
  // of backlog still lands on done when its pull request merges.
  it('moves backlog straight to done on a merge, skipping the rungs between', () => {
    expect(decideAutoStatus(firing({ currentStatus: 'backlog', prState: 'merged' }))).toBe('done')
  })

  it('treats a pull request that arrives already merged as one merge edge', () => {
    expect(decideAutoStatus(firing({ previousPrState: null, prState: 'merged' }))).toBe('done')
  })
})

describe('decideAutoStatus — the states that are declines, not deferrals', () => {
  it.each(['draft', 'closed'] as const)('%s drives nothing', (prState) => {
    expect(decideAutoStatus(firing({ prState }))).toBeNull()
    expect(decideAutoStatus(firing({ prState, currentStatus: 'backlog' }))).toBeNull()
  })

  // Closing without merging is the case a naive implementation regresses to todo or backlog.
  it('does not move an in_review issue anywhere when its pull request is closed unmerged', () => {
    expect(
      decideAutoStatus(
        firing({ currentStatus: 'in_review', previousPrState: 'open', prState: 'closed' }),
      ),
    ).toBeNull()
  })
})

describe('decideAutoStatus — never sideways and never backward', () => {
  it('leaves a done issue done when a newly linked pull request opens', () => {
    expect(decideAutoStatus(firing({ currentStatus: 'done' }))).toBeNull()
  })

  it('is a no-op when the issue is already on the target rung', () => {
    expect(decideAutoStatus(firing({ currentStatus: 'in_review' }))).toBeNull()
    expect(
      decideAutoStatus(
        firing({ currentStatus: 'done', previousPrState: 'open', prState: 'merged' }),
      ),
    ).toBeNull()
  })

  it('does not un-merge an issue when a merged pull request reopens', () => {
    expect(
      decideAutoStatus(
        firing({ currentStatus: 'done', previousPrState: 'merged', prState: 'open' }),
      ),
    ).toBeNull()
  })

  it('never writes over canceled, whatever the pull request did', () => {
    for (const prState of PULL_REQUEST_STATES) {
      expect(decideAutoStatus(firing({ currentStatus: 'canceled', prState })), prState).toBeNull()
    }
  })
})

describe('decideAutoStatus — the human-intent comparison', () => {
  it('is not blocked by a human stamp older than the event', () => {
    expect(decideAutoStatus(firing({ lastHumanStatusAt: EVENT_AT - 120_000 }))).toBe('in_review')
  })

  it('is not blocked by a null human stamp', () => {
    expect(decideAutoStatus(firing({ lastHumanStatusAt: null }))).toBe('in_review')
  })

  // The guard is `>`, not `>=`: a status written in the same millisecond as the event is not
  // evidence the person acted after it, and treating it as such would make the transition depend on
  // clock resolution.
  it('is not blocked by a human stamp exactly as old as the event', () => {
    expect(decideAutoStatus(firing({ lastHumanStatusAt: EVENT_AT }))).toBe('in_review')
  })

  it('is blocked one millisecond later', () => {
    expect(decideAutoStatus(firing({ lastHumanStatusAt: EVENT_AT + 1 }))).toBeNull()
  })

  // The healed-missed-event case in the spec: reconciliation surfaces a two-day-old merge under an
  // issue a person moved yesterday. Yesterday is newer than the merge, so the person wins.
  it('blocks a reconciliation-healed merge under a status a person set after it', () => {
    const mergedTwoDaysAgo = EVENT_AT
    expect(
      decideAutoStatus(
        firing({
          currentStatus: 'in_progress',
          prState: 'merged',
          eventAt: mergedTwoDaysAgo,
          lastHumanStatusAt: mergedTwoDaysAgo + 24 * 60 * 60 * 1000,
        }),
      ),
    ).toBeNull()
  })

  // The other half of the same rule, and the one a fixed grace window gets wrong: a person setting
  // In Progress two minutes BEFORE opening the pull request must not suppress In Review.
  it('does not block a transition whose event follows the human write by two minutes', () => {
    expect(
      decideAutoStatus(
        firing({ currentStatus: 'in_progress', lastHumanStatusAt: EVENT_AT - 120_000 }),
      ),
    ).toBe('in_review')
  })
})

describe('decideAutoStatus — the epoch is inclusive at its own instant', () => {
  it('fires on an event exactly at the opt-in instant', () => {
    expect(decideAutoStatus(firing({ eventAt: OPT_IN_AT }))).toBe('in_review')
  })

  it('does nothing one millisecond before it', () => {
    expect(decideAutoStatus(firing({ eventAt: OPT_IN_AT - 1 }))).toBeNull()
  })
})

// A sweep over every reachable input rather than the hand-picked cases above, asserting the
// properties the spec states absolutely. A ladder rewritten to "set the status the PR implies"
// passes every example test above and fails here on the backward and canceled invariants.
describe('decideAutoStatus — invariants over the whole input space', () => {
  const previousStates = [null, ...PULL_REQUEST_STATES] as const
  const humanStamps = [null, EVENT_AT - 1, EVENT_AT, EVENT_AT + 1] as const

  function sweep(visit: (input: AutoStatusInput, result: IssueStatus | null) => void): void {
    for (const currentStatus of ISSUE_STATUSES) {
      for (const prState of PULL_REQUEST_STATES) {
        for (const previousPrState of previousStates) {
          for (const needsTriage of [false, true]) {
            for (const lastHumanStatusAt of humanStamps) {
              const input = firing({
                currentStatus,
                prState,
                previousPrState,
                needsTriage,
                lastHumanStatusAt,
              })
              visit(input, decideAutoStatus(input))
            }
          }
        }
      }
    }
  }

  it('only ever targets in_review or done', () => {
    sweep((input, result) => {
      if (result === null) return
      expect(result, JSON.stringify(input)).toMatch(/^(in_review|done)$/u)
    })
  })

  it('only ever moves an issue up the ladder', () => {
    sweep((input, result) => {
      if (result === null) return
      const from = AUTO_STATUS_RANK[input.currentStatus as keyof typeof AUTO_STATUS_RANK]
      expect(
        AUTO_STATUS_RANK[result as keyof typeof AUTO_STATUS_RANK],
        JSON.stringify(input),
      ).toBeGreaterThan(from)
    })
  })

  it('never acts on a canceled or an untriaged issue', () => {
    sweep((input, result) => {
      if (input.currentStatus === 'canceled' || input.needsTriage) {
        expect(result, JSON.stringify(input)).toBeNull()
      }
    })
  })

  it('never acts without a state edge', () => {
    sweep((input, result) => {
      if (input.previousPrState === input.prState) {
        expect(result, JSON.stringify(input)).toBeNull()
      }
    })
  })

  // The whole sweep with the switch off must be silent — the property the "a fresh instance behaves
  // exactly as before" scenario rests on.
  it('is silent for every input when the team has not opted in', () => {
    for (const currentStatus of ISSUE_STATUSES) {
      for (const prState of PULL_REQUEST_STATES) {
        for (const previousPrState of previousStates) {
          expect(
            decideAutoStatus(
              firing({ autoStatusSince: null, currentStatus, prState, previousPrState }),
            ),
          ).toBeNull()
        }
      }
    }
  })

  it('finds at least one firing input, so the sweep is not vacuous', () => {
    let fired = 0
    sweep((_input, result) => {
      if (result !== null) fired += 1
    })
    expect(fired).toBeGreaterThan(0)
  })
})
