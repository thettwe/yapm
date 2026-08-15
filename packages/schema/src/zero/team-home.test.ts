import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { IssuePriority, IssueStatus } from './context.js'
import {
  buildTeamFrame,
  buildTeamHome,
  CADENCE_WEEK_COUNT,
  formatHomeAge,
  type TeamHomeInput,
  type TeamHomeIssueRow,
  type TeamHomePullRequestRow,
  YOURS_DERIVATION,
} from './team-home.js'
import { collectKeys, FORBIDDEN_IDENTITY_KEYS } from './testing/blameless.js'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

// A fixed Friday 09:00 UTC (2026-08-07), so every UTC day/week computation is stable.
const NOW = Date.UTC(2026, 7, 7, 9, 0, 0)
const VIEWER = 'user-viewer'

const team = { id: 'team-1', key: 'ENG', name: 'Engineering' }

// Day 9 of 14: started 8 UTC days before NOW, ends 5 days after (a Wednesday).
const activeCycle = {
  id: 'cycle-2',
  number: 2,
  name: 'Cycle 2',
  status: 'active' as const,
  startDate: NOW - 8 * DAY,
  endDate: NOW + 5 * DAY,
}

let nextIssue = 0
function makeIssue(
  overrides: Partial<TeamHomeIssueRow> & { status: IssueStatus },
): TeamHomeIssueRow {
  nextIssue += 1
  return {
    id: `issue-${nextIssue}`,
    number: 100 + nextIssue,
    title: `Issue ${nextIssue}`,
    priority: 'medium' as IssuePriority,
    assigneeId: null,
    cycleId: activeCycle.id,
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - nextIssue * HOUR,
    ...overrides,
  }
}

function link(pr: TeamHomePullRequestRow): { pullRequest: TeamHomePullRequestRow } {
  return { pullRequest: pr }
}

function baseInput(overrides: Partial<TeamHomeInput> = {}): TeamHomeInput {
  return {
    team,
    cycles: [activeCycle],
    issues: [],
    triage: [],
    deployments: [],
    digest: null,
    retros: [],
    notifications: [],
    ...overrides,
  }
}

// The falsifiable fixture: 1 status_behind_merge + 1 checks-failing + 2 waiting > 24h + 3 triage.
// The failing issue ALSO carries an open PR waiting 30h, so it matches two classes and must be
// counted once, by precedence.
function attentionFixture(): TeamHomeInput {
  const behindMerge = makeIssue({
    status: 'in_progress',
    issueLinks: [
      link({
        state: 'merged',
        openedAt: NOW - 3 * DAY,
        mergedAt: NOW - DAY,
        repo: 'acme/shop',
        mergeCommitSha: 'sha-behind',
      }),
    ],
  })
  const failing = makeIssue({
    status: 'in_progress',
    issueLinks: [
      link({
        state: 'open',
        openedAt: NOW - 30 * HOUR,
        ciChecks: [
          { conclusion: 'success', updatedAt: NOW - 2 * HOUR },
          { conclusion: 'failure', updatedAt: NOW - 41 * 60 * 1000 },
        ],
      }),
    ],
  })
  const waitingA = makeIssue({
    status: 'in_review',
    issueLinks: [link({ state: 'open', openedAt: NOW - 31 * HOUR })],
  })
  const waitingB = makeIssue({
    status: 'in_review',
    issueLinks: [link({ state: 'open', openedAt: NOW - 26 * HOUR })],
  })
  return baseInput({
    issues: [behindMerge, failing, waitingA, waitingB],
    triage: [
      { id: 'triage-1', createdAt: NOW - HOUR },
      { id: 'triage-2', createdAt: NOW - 2 * HOUR },
      { id: 'triage-3', createdAt: NOW - 3 * HOUR },
    ],
  })
}

describe('buildTeamHome attention (§D2)', () => {
  it('counts 7 across the four disjoint classes, counting a two-class issue once', () => {
    const model = buildTeamHome(attentionFixture(), NOW, VIEWER)
    expect(model.attention).not.toBeNull()
    expect(model.attention?.count).toBe(7)
    expect(model.attention?.divergence?.count).toBe(1)
    expect(model.attention?.checksFailing?.count).toBe(1)
    expect(model.attention?.waitingReview?.count).toBe(2)
    expect(model.attention?.triage?.count).toBe(3)
  })

  it('exposes the same number everywhere the model carries it', () => {
    const model = buildTeamHome(attentionFixture(), NOW, VIEWER)
    expect(model.hero.cycle?.statusWords.needAttention).toBe(model.attention?.count)
  })

  it('carries per-class evidence: waiting ages descending, red age, triage dots', () => {
    const model = buildTeamHome(attentionFixture(), NOW, VIEWER)
    expect(model.attention?.waitingReview?.agesMs).toEqual([31 * HOUR, 26 * HOUR])
    expect(model.attention?.checksFailing?.rows[0]?.redForMs).toBe(41 * 60 * 1000)
    expect(model.attention?.checksFailing?.rows[0]?.ticks).toEqual([false, true])
    expect(model.attention?.triage?.dotCount).toBe(3)
  })

  it('folds to null when nothing needs attention', () => {
    const model = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(model.attention).toBeNull()
  })
})

describe('buildTeamHome hero (§D3)', () => {
  it('computes day N of M, the day band, ends-weekday and days left in UTC', () => {
    const model = buildTeamHome(baseInput(), NOW, VIEWER)
    const cycle = model.hero.cycle
    expect(cycle?.dayIndex).toBe(9)
    expect(cycle?.dayCount).toBe(14)
    expect(cycle?.daysLeft).toBe(5)
    expect(cycle?.endsWeekday).toBe('Wednesday')
    expect(cycle?.dayBand).toHaveLength(14)
    expect(cycle?.dayBand.filter((s) => s === 'past')).toHaveLength(8)
    expect(cycle?.dayBand[8]).toBe('today')
  })

  it('computes scope with the delivery-metrics added-mid-cycle semantics', () => {
    const committedDone = makeIssue({ status: 'done' })
    const committedOpen = makeIssue({ status: 'in_progress' })
    const carriedIn = makeIssue({
      status: 'todo',
      rolledOverFromCycleId: 'cycle-1',
      // A carry-in is assigned at rollover time, i.e. before this cycle started counting it as a
      // mid-cycle add would misread the rollover; scope.ts compares against the cycle start.
      cycleAssignedAt: activeCycle.startDate,
    })
    const addedMid = makeIssue({ status: 'todo', cycleAssignedAt: activeCycle.startDate + DAY })
    const model = buildTeamHome(
      baseInput({ issues: [committedDone, committedOpen, carriedIn, addedMid] }),
      NOW,
      VIEWER,
    )
    const scope = model.hero.cycle?.scope
    expect(scope?.committed).toBe(3)
    expect(scope?.landed).toBe(1)
    expect(scope?.added).toBe(1)
    expect(scope?.band).toEqual(['landed', 'open', 'open', 'added'])
  })

  it('degrades to a null cycle when no active cycle exists, folding cycle bands', () => {
    const model = buildTeamHome(baseInput({ cycles: [] }), NOW, VIEWER)
    expect(model.hero.cycle).toBeNull()
    expect(model.hero.narrative).toBeNull()
    expect(model.runway).toBeNull()
    expect(model.shipped).toBeNull()
  })

  it('renders chips only when their artifact exists', () => {
    const bare = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(bare.hero.cycle?.chips).toEqual({ cycleReport: false, wrapped: false })

    const withArtifacts = buildTeamHome(
      baseInput({
        digest: { status: 'ready', content: { headline: 'A good week.' } },
        retros: [
          {
            id: 'retro-1',
            cycleId: activeCycle.id,
            title: 'Cycle 2 retro',
            phase: 'closed',
            closedAt: NOW - DAY,
          },
        ],
      }),
      NOW,
      VIEWER,
    )
    expect(withArtifacts.hero.cycle?.chips).toEqual({ cycleReport: true, wrapped: true })
  })

  it('lists only open retros under NEXT, with no invented times', () => {
    const model = buildTeamHome(
      baseInput({
        retros: [
          { id: 'retro-open', title: 'Mid-cycle retro', phase: 'brainstorm', closedAt: null },
          { id: 'retro-done', title: 'Old retro', phase: 'closed', closedAt: NOW - 20 * DAY },
        ],
      }),
      NOW,
      VIEWER,
    )
    expect(model.hero.cycle?.next).toEqual([
      { retroId: 'retro-open', title: 'Mid-cycle retro', phase: 'brainstorm' },
    ])
  })
})

describe('buildTeamHome narrative (§D3)', () => {
  it('passes the stored digest narrative through when ready content exists', () => {
    const model = buildTeamHome(
      baseInput({ digest: { status: 'ready', content: { headline: 'Shipped the checkout.' } } }),
      NOW,
      VIEWER,
    )
    expect(model.hero.narrative).toEqual({
      source: 'digest',
      sentences: ['Shipped the checkout.'],
    })
  })

  it('falls back to a deterministic computed narrative of at most two sentences', () => {
    const input = attentionFixture()
    const model = buildTeamHome(input, NOW, VIEWER)
    const again = buildTeamHome(input, NOW, VIEWER)
    expect(model.hero.narrative?.source).toBe('computed')
    expect(model.hero.narrative?.sentences).toEqual(again.hero.narrative?.sentences)
    expect(model.hero.narrative?.sentences.length).toBeLessThanOrEqual(2)
    // The most severe fact wins: the divergence sentence names the issue key.
    expect(model.hero.narrative?.sentences[1]).toContain('ENG-')
    expect(model.hero.narrative?.sentences[1]).toContain("the board hasn't noticed")
  })

  it('degrades to one quiet sentence on a quiet day', () => {
    const model = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(model.hero.narrative?.sentences).toHaveLength(1)
    expect(model.hero.narrative?.sentences[0]).toContain('nothing shipped yet')
  })
})

describe('buildTeamHome since yesterday (§D4)', () => {
  it('joins overnight deployments to done issues via the merge commit, with a repo fact fallback', () => {
    const shippedIssue = makeIssue({
      status: 'done',
      title: 'Order history search',
      issueLinks: [
        link({
          state: 'merged',
          openedAt: NOW - 2 * DAY,
          mergedAt: NOW - 20 * HOUR,
          repo: 'acme/shop',
          mergeCommitSha: 'sha-1',
        }),
      ],
    })
    const model = buildTeamHome(
      baseInput({
        issues: [shippedIssue],
        deployments: [
          {
            repo: 'acme/shop',
            sha: 'sha-1',
            environment: 'production',
            deployedAt: NOW - 10 * HOUR,
          },
          {
            repo: 'acme/shop',
            sha: 'sha-unmatched',
            environment: 'production',
            deployedAt: NOW - 8 * HOUR,
          },
          {
            repo: 'acme/shop',
            sha: 'sha-old',
            environment: 'production',
            deployedAt: NOW - 3 * DAY,
          },
        ],
      }),
      NOW,
      VIEWER,
    )
    const overnight = model.sinceYesterday?.overnight
    expect(overnight?.deployCount).toBe(2)
    expect(overnight?.lines.map((l) => l.text)).toEqual([
      'Order history search',
      'acme/shop · production',
    ])
    expect(overnight?.provenance).toBe('2 releases went live · production')
  })

  it('never renders the repo fallback for a duplicate deployment of a matched commit', () => {
    const shippedIssue = makeIssue({
      status: 'done',
      title: 'Order history search',
      issueLinks: [
        link({
          state: 'merged',
          openedAt: NOW - 2 * DAY,
          mergedAt: NOW - 20 * HOUR,
          repo: 'acme/shop',
          mergeCommitSha: 'sha-1',
        }),
      ],
    })
    const model = buildTeamHome(
      baseInput({
        issues: [shippedIssue],
        deployments: [
          { repo: 'acme/shop', sha: 'sha-1', environment: 'staging', deployedAt: NOW - 12 * HOUR },
          {
            repo: 'acme/shop',
            sha: 'sha-1',
            environment: 'production',
            deployedAt: NOW - 10 * HOUR,
          },
        ],
      }),
      NOW,
      VIEWER,
    )
    const overnight = model.sinceYesterday?.overnight
    expect(overnight?.deployCount).toBe(2)
    expect(overnight?.lines.map((l) => l.text)).toEqual(['Order history search'])
  })

  it("surfaces review outcomes on the viewer's issues inside the window only", () => {
    const mineReviewed = makeIssue({
      status: 'in_review',
      assigneeId: VIEWER,
      issueLinks: [
        link({
          state: 'open',
          openedAt: NOW - 2 * DAY,
          reviews: [{ state: 'approved', submittedAt: NOW - 9 * HOUR }],
        }),
      ],
    })
    const notMine = makeIssue({
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [
        link({
          state: 'open',
          openedAt: NOW - 2 * DAY,
          reviews: [{ state: 'changes_requested', submittedAt: NOW - 5 * HOUR }],
        }),
      ],
    })
    const model = buildTeamHome(baseInput({ issues: [mineReviewed, notMine] }), NOW, VIEWER)
    const rows = model.sinceYesterday?.yourReview?.rows
    expect(rows).toHaveLength(1)
    expect(rows?.[0]?.outcome).toBe('Approved')
    expect(rows?.[0]?.ageMs).toBe(9 * HOUR)
  })

  it('summarizes team-scoped unread notifications in the window and folds the band when all cards are empty', () => {
    const model = buildTeamHome(
      baseInput({
        notifications: [
          {
            kind: 'mention',
            teamId: team.id,
            subjectKey: 'ENG-142',
            subjectTitle: 'Checkout flow',
            readAt: null,
            createdAt: NOW - 2 * HOUR,
          },
          {
            kind: 'mention',
            teamId: 'team-other',
            subjectTitle: 'Elsewhere',
            readAt: null,
            createdAt: NOW - 2 * HOUR,
          },
          {
            kind: 'mention',
            teamId: team.id,
            subjectTitle: 'Read already',
            readAt: NOW - HOUR,
            createdAt: NOW - 2 * HOUR,
          },
          {
            kind: 'mention',
            teamId: team.id,
            subjectTitle: 'Too old',
            readAt: null,
            createdAt: NOW - 2 * DAY,
          },
        ],
      }),
      NOW,
      VIEWER,
    )
    expect(model.sinceYesterday?.inbox?.count).toBe(1)
    expect(model.sinceYesterday?.inbox?.rows[0]?.subjectKey).toBe('ENG-142')
    expect(model.sinceYesterday?.cardCount).toBe(1)

    const quiet = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(quiet.sinceYesterday).toBeNull()
  })
})

describe('buildTeamHome yours (§D5)', () => {
  it("lists the viewer's unfinished rows by last movement with predicate-keyed bifacts", () => {
    const approved = makeIssue({
      status: 'in_review',
      assigneeId: VIEWER,
      updatedAt: NOW - HOUR,
      issueLinks: [
        link({
          state: 'open',
          openedAt: NOW - 2 * DAY,
          ciChecks: [{ conclusion: 'success', updatedAt: NOW - 10 * HOUR }],
          reviews: [{ state: 'approved', submittedAt: NOW - 9 * HOUR }],
        }),
      ],
    })
    const inProgress = makeIssue({
      status: 'in_progress',
      assigneeId: VIEWER,
      updatedAt: NOW - 2 * HOUR,
    })
    const done = makeIssue({ status: 'done', assigneeId: VIEWER })
    const model = buildTeamHome(baseInput({ issues: [approved, inProgress, done] }), NOW, VIEWER)

    expect(model.yours.count).toBe(2)
    expect(model.yours.rows.map((r) => r.say)).toEqual([
      'Approved — merge when ready',
      'In progress',
    ])
    expect(model.yours.rows[0]?.git).toBe('checks green · approved 9h')
    expect(model.yours.rows[1]?.git).toBe('')
    // Not `toBe(YOURS_DERIVATION)`: that stays green through any rewrite of the constant. The
    // band's lens definition is what the requirement binds, clause by clause.
    expect(model.yours.derivation).toBe(YOURS_DERIVATION)
    expect(model.yours.derivation).toContain('assignee you')
    expect(model.yours.derivation).toContain('status < done')
    expect(model.yours.derivation).toContain('ordered by last movement')
    expect(model.yours.derivation.endsWith('your work only — never compared')).toBe(true)
    expect(model.yours.derivation.startsWith('yours = ')).toBe(false)
  })

  it('collapses rows whose PR awaits review into the waiting-on-others line', () => {
    const waiting = makeIssue({
      status: 'in_review',
      assigneeId: VIEWER,
      issueLinks: [link({ state: 'open', openedAt: NOW - 16 * HOUR })],
    })
    const model = buildTeamHome(baseInput({ issues: [waiting] }), NOW, VIEWER)
    expect(model.yours.rows).toHaveLength(0)
    expect(model.yours.waitingOnOthers).toEqual({ count: 1, agesMs: [16 * HOUR] })
    expect(model.yours.noReviewsOwed).toBe(false)
  })

  it('keeps an open-PR row with failing checks as its own row — the fix is the viewer’s', () => {
    const redOpen = makeIssue({
      status: 'in_review',
      assigneeId: VIEWER,
      issueLinks: [
        link({
          state: 'open',
          openedAt: NOW - 16 * HOUR,
          ciChecks: [{ conclusion: 'failure', updatedAt: NOW - HOUR }],
        }),
      ],
    })
    const model = buildTeamHome(baseInput({ issues: [redOpen] }), NOW, VIEWER)
    expect(model.yours.waitingOnOthers).toBeNull()
    expect(model.yours.rows).toHaveLength(1)
    expect(model.yours.rows[0]?.say).toBe('Checks failing — the fix is yours')
    expect(model.yours.rows[0]?.sayUrgent).toBe(true)
  })

  it('asserts no reviews owed ONLY when the whole team has zero open PRs awaiting review', () => {
    const teammateOpenPr = makeIssue({
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [link({ state: 'open', openedAt: NOW - 2 * HOUR })],
    })
    const withOpen = buildTeamHome(baseInput({ issues: [teammateOpenPr] }), NOW, VIEWER)
    expect(withOpen.yours.noReviewsOwed).toBe(false)

    const approvedOnly = makeIssue({
      status: 'in_review',
      assigneeId: 'user-other',
      issueLinks: [
        link({
          state: 'open',
          openedAt: NOW - 2 * DAY,
          reviews: [{ state: 'approved', submittedAt: NOW - HOUR }],
        }),
      ],
    })
    const clear = buildTeamHome(baseInput({ issues: [approvedOnly] }), NOW, VIEWER)
    expect(clear.yours.noReviewsOwed).toBe(true)
  })

  it('is empty (the warmth line case) when the viewer holds nothing', () => {
    const model = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(model.yours.count).toBe(0)
    expect(model.yours.rows).toHaveLength(0)
    expect(model.yours.waitingOnOthers).toBeNull()
  })
})

describe('buildTeamHome runway (§D6)', () => {
  it('lists unassigned todo/backlog rows of the active cycle, urgent first, phrases from predicates', () => {
    const urgent = makeIssue({ status: 'todo', priority: 'urgent' })
    const carried = makeIssue({
      status: 'backlog',
      rolledOverFromCycleId: 'cycle-1',
      cycleAssignedAt: activeCycle.startDate,
    })
    const added = makeIssue({ status: 'todo', cycleAssignedAt: activeCycle.startDate + DAY })
    const planned = makeIssue({ status: 'todo' })
    const assigned = makeIssue({ status: 'todo', assigneeId: 'user-other' })
    const inProgress = makeIssue({ status: 'in_progress' })
    const model = buildTeamHome(
      baseInput({ issues: [planned, added, carried, urgent, assigned, inProgress] }),
      NOW,
      VIEWER,
    )
    expect(model.runway?.count).toBe(4)
    expect(model.runway?.rows[0]?.urgent).toBe(true)
    expect(model.runway?.rows.map((r) => r.phrase)).toEqual([
      'Urgent — nothing blocks a start',
      'Carried in — pick it back up',
      'Added mid-cycle',
      'Committed at planning',
    ])
  })

  it('folds when empty or when no active cycle exists', () => {
    expect(buildTeamHome(baseInput(), NOW, VIEWER).runway).toBeNull()
    const issue = makeIssue({ status: 'todo' })
    expect(buildTeamHome(baseInput({ cycles: [], issues: [issue] }), NOW, VIEWER).runway).toBeNull()
  })
})

describe('buildTeamHome cadence (§D7)', () => {
  it('buckets deployments into UTC weeks, stable regardless of time of day', () => {
    const deployments = [
      { repo: 'acme/shop', sha: 'a', deployedAt: NOW - HOUR },
      { repo: 'acme/shop', sha: 'b', deployedAt: NOW - 2 * HOUR },
      { repo: 'acme/shop', sha: 'c', deployedAt: NOW - 8 * DAY },
      { repo: 'acme/shop', sha: 'old', deployedAt: NOW - 100 * DAY },
      { repo: 'acme/shop', sha: 'never', deployedAt: null },
    ]
    const model = buildTeamHome(baseInput({ deployments }), NOW, VIEWER)
    expect(model.cadence?.weeks).toHaveLength(CADENCE_WEEK_COUNT)
    expect(model.cadence?.todayIndex).toBe(CADENCE_WEEK_COUNT - 1)
    const lastWeek = model.cadence?.weeks[CADENCE_WEEK_COUNT - 1]
    expect(lastWeek?.deploys).toBe(2)
    expect(model.cadence?.weeks[CADENCE_WEEK_COUNT - 2]?.deploys).toBe(1)

    // UTC-stable: the same buckets at a different hour of the same UTC day.
    const later = buildTeamHome(baseInput({ deployments }), NOW + 5 * HOUR, VIEWER)
    expect(later.cadence?.weeks.map((w) => w.startMs)).toEqual(
      model.cadence?.weeks.map((w) => w.startMs),
    )
  })

  it('marks retro ticks from closed retros and folds without a production timestamp', () => {
    const model = buildTeamHome(
      baseInput({
        deployments: [{ repo: 'acme/shop', sha: 'a', deployedAt: NOW - HOUR }],
        retros: [{ id: 'retro-1', title: 'Retro', phase: 'closed', closedAt: NOW - 8 * DAY }],
      }),
      NOW,
      VIEWER,
    )
    expect(model.cadence?.weeks[CADENCE_WEEK_COUNT - 2]?.retro).toBe(true)
    expect(buildTeamHome(baseInput(), NOW, VIEWER).cadence).toBeNull()
    // Pending/failed deploys carry no `deployedAt`; alone they must not render a hollow chart.
    const pendingOnly = baseInput({
      deployments: [
        { repo: 'acme/shop', sha: 'pending', deployedAt: null },
        { repo: 'acme/shop', sha: 'failed', deployedAt: undefined },
      ],
    })
    expect(buildTeamHome(pendingOnly, NOW, VIEWER).cadence).toBeNull()
    const oneLive = baseInput({
      deployments: [
        { repo: 'acme/shop', sha: 'pending', deployedAt: null },
        { repo: 'acme/shop', sha: 'live', deployedAt: NOW - HOUR },
      ],
    })
    expect(buildTeamHome(oneLive, NOW, VIEWER).cadence).not.toBeNull()
  })
})

describe('buildTeamHome shipped (§D8)', () => {
  it('marks Live only when a deployment carried the merge commit', () => {
    const live = makeIssue({
      status: 'done',
      issueLinks: [
        link({
          state: 'merged',
          openedAt: NOW - 3 * DAY,
          mergedAt: NOW - 2 * DAY,
          repo: 'acme/shop',
          mergeCommitSha: 'sha-live',
        }),
      ],
    })
    const builtNotLive = makeIssue({
      status: 'done',
      issueLinks: [
        link({
          state: 'merged',
          openedAt: NOW - 3 * DAY,
          mergedAt: NOW - 2 * DAY,
          repo: 'acme/shop',
          mergeCommitSha: 'sha-unshipped',
        }),
      ],
    })
    const model = buildTeamHome(
      baseInput({
        issues: [live, builtNotLive],
        deployments: [{ repo: 'acme/shop', sha: 'sha-live', deployedAt: NOW - DAY }],
      }),
      NOW,
      VIEWER,
    )
    expect(model.shipped?.count).toBe(2)
    const byKey = new Map(model.shipped?.rows.map((r) => [r.issueId, r.live]))
    expect(byKey.get(live.id)).toBe(true)
    expect(byKey.get(builtNotLive.id)).toBe(false)
  })
})

describe('buildTeamHome footline (§D9) and folding', () => {
  it('contains only executed-rule clauses', () => {
    const busy = buildTeamHome(
      {
        ...attentionFixture(),
        issues: [
          ...attentionFixture().issues,
          makeIssue({ status: 'in_progress', assigneeId: VIEWER }),
        ],
      },
      NOW,
      VIEWER,
    )
    expect(busy.footline).toEqual([
      'attention first',
      'your lens — your work only',
      'empty bands fold away',
    ])

    const quiet = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(quiet.footline).toEqual(['empty bands fold away'])
  })

  it('folds every optional band on an all-quiet fixture', () => {
    const model = buildTeamHome(baseInput(), NOW, VIEWER)
    expect(model.attention).toBeNull()
    expect(model.sinceYesterday).toBeNull()
    expect(model.runway).toBeNull()
    expect(model.cadence).toBeNull()
    expect(model.shipped).toBeNull()
    expect(model.yours.count).toBe(0)
  })
})

describe('blamelessness', () => {
  it('exposes no identity key anywhere in the model', () => {
    const input = attentionFixture()
    const full = buildTeamHome(
      {
        ...input,
        issues: [
          ...input.issues,
          makeIssue({ status: 'in_progress', assigneeId: VIEWER }),
          makeIssue({ status: 'done', assigneeId: 'user-other' }),
        ],
        deployments: [{ repo: 'acme/shop', sha: 'a', deployedAt: NOW - HOUR }],
        notifications: [
          {
            kind: 'mention',
            teamId: team.id,
            subjectTitle: 'Checkout flow',
            readAt: null,
            createdAt: NOW - HOUR,
          },
        ],
      },
      NOW,
      VIEWER,
    )
    const keys = collectKeys(full)
    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) {
      expect(keys.has(forbidden), `model leaks identity key "${forbidden}"`).toBe(false)
    }
  })
})

describe('formatHomeAge', () => {
  it("renders the mock's mono vocabulary", () => {
    expect(formatHomeAge(30_000)).toBe('now')
    expect(formatHomeAge(41 * 60 * 1000)).toBe('41m')
    expect(formatHomeAge(9 * HOUR)).toBe('9h')
    expect(formatHomeAge(31 * HOUR)).toBe('31h')
    expect(formatHomeAge(3 * DAY)).toBe('3d')
  })
})

// The app frame renders bands 1 and 3 on every authenticated page from THIS model, and the Home
// digest builds its bands on the same result. The invariant these cases hold: the deck badge, the
// statusline segment and Home's NEEDS ATTENTION are one number because they are one object.
describe('buildTeamFrame (app-frame §D2)', () => {
  it('reports the same attention count the digest reports, from the same object', () => {
    const input = attentionFixture()
    const frame = buildTeamFrame(input, NOW)
    const home = buildTeamHome(input, NOW, VIEWER)

    expect(frame.attention?.count).toBe(7)
    expect(frame.attention?.count).toBe(home.attention?.count)
    expect(home.hero.cycle?.statusWords.needAttention).toBe(frame.attention?.count)
    // Two calls cannot share an object, but they must agree in every class, not just the total —
    // and inside one `buildTeamHome` the digest holds the frame's own object rather than a copy.
    expect(home.attention).toStrictEqual(frame.attention)
  })

  it('carries the team identity, the active cycle, the shipped count and this week’s deploys', () => {
    const input = baseInput({
      issues: [
        makeIssue({ status: 'done' }),
        makeIssue({ status: 'done' }),
        makeIssue({ status: 'in_progress' }),
      ],
      deployments: [
        { repo: 'acme/shop', sha: 'a', deployedAt: NOW - 2 * HOUR },
        { repo: 'acme/shop', sha: 'b', deployedAt: NOW - DAY },
        { repo: 'acme/shop', sha: 'c', deployedAt: NOW - 30 * DAY },
      ],
    })
    const frame = buildTeamFrame(input, NOW)
    const home = buildTeamHome(input, NOW, VIEWER)

    expect(frame.teamId).toBe('team-1')
    expect(frame.teamName).toBe('Engineering')
    expect(frame.teamKey).toBe('ENG')
    expect(frame.cycle).toEqual({ title: 'Cycle 2', dayIndex: 9, dayCount: 14 })
    expect(frame.shipped).toBe(2)
    expect(frame.shipped).toBe(home.hero.cycle?.statusWords.shipped)
    expect(frame.cycle?.dayIndex).toBe(home.hero.cycle?.dayIndex)
    expect(frame.cycle?.dayCount).toBe(home.hero.cycle?.dayCount)
    expect(frame.cycle?.title).toBe(home.hero.cycle?.title)
    // The current UTC week only: the deploy 30 days back belongs to an older bucket.
    expect(frame.deploysThisWeek).toBe(home.cadence?.weeks[home.cadence.todayIndex]?.deploys)
    expect(frame.deploysThisWeek).toBe(2)
  })

  it('folds every segment it has no fact for, and reports absence as null rather than zero', () => {
    const frame = buildTeamFrame({ team, cycles: [], issues: [], triage: [], deployments: [] }, NOW)
    expect(frame.attention).toBeNull()
    expect(frame.cycle).toBeNull()
    expect(frame.shipped).toBeNull()
    expect(frame.deploysThisWeek).toBeNull()
  })

  it('ignores a completed cycle: only an active one is the team’s day', () => {
    const frame = buildTeamFrame(
      baseInput({
        cycles: [{ ...activeCycle, status: 'completed' as const }],
        issues: [makeIssue({ status: 'done' })],
      }),
      NOW,
    )
    expect(frame.cycle).toBeNull()
    expect(frame.shipped).toBeNull()
  })

  // The table. One agreeing case proves the wiring; these prove it survives the shapes that would
  // most plausibly break it — an issue in two classes, an empty team, a team between cycles, a team
  // that has never deployed. Each asserts the expected count too, so a derivation that quietly
  // returned the same wrong number in both places still fails.
  const AGREEMENT: readonly { name: string; input: () => TeamHomeInput; count: number | null }[] = [
    { name: 'four classes, one issue matching two', input: attentionFixture, count: 7 },
    { name: 'nothing needing attention', input: () => baseInput(), count: null },
    {
      name: 'one issue in two classes, counted once',
      input: () =>
        baseInput({
          issues: [
            makeIssue({
              status: 'in_review',
              issueLinks: [
                link({
                  state: 'open',
                  openedAt: NOW - 30 * HOUR,
                  ciChecks: [{ conclusion: 'failure', updatedAt: NOW - 20 * 60 * 1000 }],
                }),
              ],
            }),
          ],
        }),
      count: 1,
    },
    {
      name: 'no active cycle, exceptions still counted',
      input: () =>
        baseInput({
          cycles: [],
          issues: [
            makeIssue({
              status: 'in_review',
              cycleId: null,
              issueLinks: [link({ state: 'open', openedAt: NOW - 40 * HOUR })],
            }),
          ],
          triage: [{ id: 'triage-1', createdAt: NOW - HOUR }],
        }),
      count: 2,
    },
    {
      name: 'no deployments at all',
      input: () =>
        baseInput({
          deployments: [],
          triage: [
            { id: 'triage-1', createdAt: NOW - HOUR },
            { id: 'triage-2', createdAt: NOW - 2 * HOUR },
          ],
        }),
      count: 2,
    },
  ]

  it.each(AGREEMENT)('$name: the frame and the digest report one number', ({ input, count }) => {
    const built = input()
    const frame = buildTeamFrame(built, NOW)
    const home = buildTeamHome(built, NOW, VIEWER)

    expect(frame.attention?.count ?? null).toBe(count)
    expect(home.attention?.count ?? null).toBe(count)
    expect(home.attention).toStrictEqual(frame.attention)
    // Home's hero restates the count in words; off-cycle it has no hero to restate it in, and an
    // absent restatement is not a disagreement.
    if (home.hero.cycle !== null && home.hero.cycle !== undefined) {
      expect(home.hero.cycle.statusWords.needAttention).toBe(count ?? 0)
    }
  })
})

// The rule the whole change rests on, asserted against the source rather than a behaviour: a
// SECOND attention derivation cannot be introduced without this failing. One definition, one call.
describe('one attention derivation', () => {
  it('has exactly one buildAttention call site in the module that defines it', async () => {
    const source = await readFile(new URL('./team-home.ts', import.meta.url), 'utf8')
    const occurrences = source.match(/\bbuildAttention\s*\(/gu) ?? []
    expect(occurrences).toHaveLength(2)
    expect(source).toContain('function buildAttention(')
  })
})
