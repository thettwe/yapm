import { describe, expect, it } from 'vitest'
import { collectKeys, FORBIDDEN_IDENTITY_KEYS } from '../testing/blameless.js'
import { DELIVERED_METRICS, FLOW_METRICS, flowEmptyState } from './descriptors.js'
import {
  BINDING_TEAM_LEVEL_RULE,
  buildDeliveryPage,
  type DeliveryPageCycleRow,
  type DeliveryPageDeploymentRow,
  type DeliveryPageInput,
  type DeliveryPageIssueRow,
  type DeliveryPagePullRequestRow,
  type DeliveryPageRetroRow,
  DISTRIBUTION_OUTLIER_MULTIPLE,
  deliveryCyclesOf,
  REVIEW_RHYTHM_CAP,
} from './page.js'
import { flowMeasures, scopeOfCycles } from './scope.js'

// The redraw's own proof. Three properties matter more than any number the page states: the mapping
// from the twelve metric definitions to the page's sections is TOTAL (a redraw is how a signal gets
// quietly deleted), the honesty statement names what is genuinely absent, and it does NOT repeat the
// mock's "merged-to-live isn't measured yet" — which was true when the mock was drawn and is now a
// new false statement on the one page whose subject is not guessing.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const CYCLE = 14 * DAY
// A Monday, so the cycle boundaries and the ISO weeks the call-out rule buckets by line up and the
// fixture's arithmetic is readable.
const BASE = Date.UTC(2026, 0, 5)

// The fixture carries every identity column the synced rows carry — an assignee, a creator, and a
// review by a real-looking provider login — so the blamelessness walk below is run over input that
// could leak rather than over input that could not.
interface LeakyReviewRow {
  readonly state: 'approved' | 'changes_requested' | 'commented' | 'dismissed'
  readonly submittedAt: number
  readonly author: string
}

interface LeakyPrRow extends DeliveryPagePullRequestRow {
  readonly reviews?: readonly LeakyReviewRow[]
}

interface LeakyIssueRow extends DeliveryPageIssueRow {
  readonly assigneeId?: string
  readonly creatorId?: string
  readonly issueLinks?: readonly { readonly pullRequest?: LeakyPrRow | null }[]
}

function cycleRow(number: number, status: DeliveryPageCycleRow['status']): DeliveryPageCycleRow {
  const startDate = BASE + (number - 1) * CYCLE
  return {
    id: `cycle-${number}`,
    number,
    name: `Cycle ${number}`,
    status,
    startDate,
    endDate: startDate + 13 * DAY,
  }
}

// Twelve completed cycles: the window is the last six, and the six before them are the delta's
// basis — a comparison the page only makes when a FULL preceding window exists.
const PRIOR = [1, 2, 3, 4, 5, 6].map((n) => cycleRow(n, 'completed'))
const WINDOW = [7, 8, 9, 10, 11, 12].map((n) => cycleRow(n, 'completed'))
const COMPLETED = [...PRIOR, ...WINDOW]
const ACTIVE = cycleRow(13, 'active')
const LAST = WINDOW[5] as DeliveryPageCycleRow
const C_LAST = LAST.startDate
// Day 9 of 14 of the cycle in progress — the mock's own reading.
const NOW = ACTIVE.startDate + 8 * DAY

function pr(over: Partial<LeakyPrRow> & { readonly id: string }): LeakyPrRow {
  return {
    state: 'merged',
    openedAt: C_LAST,
    repo: 'acme/web',
    mergeCommitSha: `sha-${over.id}`,
    ciChecks: [{ conclusion: 'success' }],
    reviews: [{ state: 'approved', submittedAt: C_LAST + 2 * HOUR, author: 'octocat' }],
    ...over,
  }
}

const SHARED_PR = pr({ id: 'pr-shared', mergedAt: C_LAST + 30 * HOUR })

function issue(over: Partial<LeakyIssueRow> & { readonly id: string }): LeakyIssueRow {
  return {
    number: 100,
    title: 'A change',
    status: 'done',
    assigneeId: 'user-1',
    creatorId: 'user-2',
    ...over,
  }
}

// The six cycles before the window, so the delta has a full basis to compare against.
const PRIOR_ISSUES: readonly LeakyIssueRow[] = PRIOR.map((cycle) =>
  issue({ id: `prior-${cycle.id}`, cycleId: cycle.id }),
)

const ISSUES: readonly LeakyIssueRow[] = [
  ...PRIOR_ISSUES,
  issue({ id: 'i1', cycleId: 'cycle-7' }),
  issue({ id: 'i2', cycleId: 'cycle-7', status: 'todo' }),
  // Carried into the window from the cycle before it opened.
  issue({
    id: 'carry-in',
    cycleId: 'cycle-7',
    status: 'todo',
    rolledOverFromCycleId: 'cycle-6',
    carryoverCount: 1,
  }),
  issue({ id: 'i3', cycleId: 'cycle-8' }),
  issue({ id: 'i4', cycleId: 'cycle-9' }),
  issue({ id: 'i5', cycleId: 'cycle-10' }),
  issue({ id: 'i6', cycleId: 'cycle-11' }),
  // Carried from cycle 11 into cycle 12, for the second time: a ribbon between two window cycles,
  // which is not a carry OUT of the window.
  issue({
    id: 'carry-a',
    cycleId: 'cycle-12',
    status: 'in_progress',
    rolledOverFromCycleId: 'cycle-11',
    carryoverCount: 2,
    cycleAssignedAt: C_LAST,
  }),
  // Carried out of the window's last cycle into the cycle in progress.
  issue({
    id: 'carry-out',
    cycleId: 'cycle-13',
    status: 'todo',
    rolledOverFromCycleId: 'cycle-12',
    carryoverCount: 1,
    cycleAssignedAt: ACTIVE.startDate,
  }),
  issue({
    id: 'i7',
    cycleId: 'cycle-12',
    issueLinks: [
      {
        pullRequest: pr({
          id: 'pr-1',
          mergedAt: C_LAST + 10 * HOUR,
          reviews: [
            { state: 'commented', submittedAt: C_LAST + 2 * HOUR, author: 'octocat' },
            { state: 'approved', submittedAt: C_LAST + 6 * HOUR, author: 'octocat' },
          ],
        }),
      },
    ],
  }),
  issue({
    id: 'i8',
    cycleId: 'cycle-12',
    issueLinks: [
      {
        pullRequest: pr({
          id: 'pr-2',
          mergedAt: C_LAST + 50 * HOUR,
          ciChecks: [{ conclusion: 'failure' }, { conclusion: 'success' }],
          reviews: [{ state: 'approved', submittedAt: C_LAST + 8 * HOUR, author: 'hubot' }],
        }),
      },
    ],
  }),
  // The same pull request, reached through two issues that both touched the window.
  issue({ id: 'i9', cycleId: 'cycle-12', issueLinks: [{ pullRequest: SHARED_PR }] }),
  issue({
    id: 'i-late',
    cycleId: 'cycle-12',
    status: 'todo',
    cycleAssignedAt: C_LAST + 3 * DAY,
    issueLinks: [{ pullRequest: SHARED_PR }],
  }),
  issue({
    id: 'i10',
    cycleId: 'cycle-12',
    issueLinks: [
      {
        pullRequest: pr({
          id: 'pr-giant',
          mergedAt: C_LAST + 400 * HOUR,
          reviews: [{ state: 'approved', submittedAt: C_LAST + 100 * HOUR, author: 'octocat' }],
        }),
      },
    ],
  }),
  // Merged in git, still in progress on the board: the divergence class the page's one peek draws,
  // and the newer of the fixture's two diverged changes.
  issue({
    id: 'diverged',
    number: 116,
    title: 'Apple Pay in the payment sheet',
    status: 'in_progress',
    cycleId: 'cycle-13',
    issueLinks: [
      {
        pullRequest: pr({
          id: 'pr-diverged',
          openedAt: ACTIVE.startDate + 2 * DAY,
          mergedAt: ACTIVE.startDate + 6 * DAY,
          ciChecks: [{ conclusion: 'success' }],
        }),
      },
    ],
  }),
]

// The two issues whose linked change merged while the board still says otherwise. `i-late` is one of
// them by construction — it links the shared merged change under a `todo` status — which is why
// removing the peek's subject alone does not empty the class.
const DIVERGED_IDS = ['diverged', 'i-late']

function deploy(dayOffset: number, over: Partial<DeliveryPageDeploymentRow> = {}) {
  return {
    repo: 'acme/web',
    sha: `sha-deploy-${dayOffset}`,
    ref: `release-${dayOffset}`,
    environment: 'production',
    deployedAt: ACTIVE.startDate + dayOffset * DAY,
    ...over,
  }
}

const DEPLOYMENTS: readonly DeliveryPageDeploymentRow[] = [
  // Week one of the cycle in progress: three releases.
  deploy(1, { ref: 'checkout-v2' }),
  deploy(2),
  deploy(3),
  // Week two: two.
  deploy(7),
  deploy(8),
  // Outside the cycle in progress entirely, and pending rather than live.
  { repo: 'acme/web', sha: 'sha-old', deployedAt: BASE - 3 * DAY, environment: 'production' },
  { repo: 'acme/web', sha: 'sha-pending', deployedAt: null, environment: 'production' },
]

const RETROS: readonly DeliveryPageRetroRow[] = [
  { cycleId: 'cycle-13', title: 'Cycle 13 retro', closedAt: ACTIVE.startDate + 5 * DAY },
  { cycleId: 'cycle-12', title: 'Cycle 12 retro', closedAt: null },
]

function input(over: Partial<DeliveryPageInput> = {}): DeliveryPageInput {
  return {
    teamKey: 'ENG',
    cycles: [...COMPLETED, ACTIVE],
    issues: ISSUES,
    deployments: DEPLOYMENTS,
    retros: RETROS,
    size: 6,
    ...over,
  }
}

function built(over: Partial<DeliveryPageInput> = {}) {
  const model = buildDeliveryPage(input(over), NOW)
  if (model === null) throw new Error('the fixture has completed cycles, so this cannot be null')
  return model
}

describe('buildDeliveryPage — the redraw loses no signal', () => {
  it('gives every one of the twelve metric definitions exactly one home', () => {
    const defined = [...DELIVERED_METRICS, ...FLOW_METRICS].map((descriptor) => descriptor.key)
    const placed = built().metricMap.map((placement) => placement.metricKey)

    for (const key of defined) {
      expect(placed.filter((candidate) => candidate === key)).toHaveLength(1)
    }
    // And nothing is claimed that is not defined: the mapping is exactly the definitions.
    expect([...placed].sort()).toEqual([...defined].sort())
  })

  it('says where each definition landed, and whether that section drew today', () => {
    const model = built()
    const home = new Map(model.metricMap.map((placement) => [placement.metricKey, placement]))
    expect(home.get('total')?.section).toBe('stats_how')
    expect(home.get('carried_twice_plus')?.section).toBe('flow')
    expect(home.get('review_rounds')?.section).toBe('rhythm')
    for (const placement of model.metricMap) {
      expect(placement.drawn).toBe(true)
      expect(placement.place.length).toBeGreaterThan(0)
    }
  })
})

describe('buildDeliveryPage — the honesty statement is corrected, not ported', () => {
  const honesty = built().honesty

  it('names change failure rate, time to restore and deployment frequency AS A RATE as absent', () => {
    expect(honesty.line).toContain('change failure rate')
    expect(honesty.line).toContain('time to restore')
    expect(honesty.line).toContain('deployment frequency as a rate')
  })

  it('never claims merged-to-live is unmeasured — it is derivable, and the mock’s line is now a lie', () => {
    const statements = [honesty.line, ...honesty.more]
    for (const statement of statements) {
      if (!/merge/i.test(statement)) continue
      expect(statement).not.toMatch(/((is|isn't|is not|not|never)\s+)?(un)?measured/i)
      expect(statement).not.toMatch(/not (shown|derivable|available)/i)
    }
    expect(statements.join(' ')).not.toMatch(/merged[-\s]to[-\s]live/i)
  })

  it('says instead where whether a merged change reached production IS stated', () => {
    const more = honesty.more.join(' ')
    expect(more).toMatch(/reached production IS derived/)
    expect(more).toContain('delivery rail')
  })

  it('discloses the coverage limit the page cannot see past', () => {
    expect(honesty.more.join(' ')).toMatch(
      /pull request linked to no issue is invisible in every reading/,
    )
  })

  it('is one line plus more, and carries no dismissal', () => {
    expect(honesty.line.split('. ')).toHaveLength(1)
    expect(honesty.more.length).toBeGreaterThan(0)
  })
})

describe('buildDeliveryPage — the standfirst carries two scopes and the binding rule', () => {
  it('names the cycle in progress, the completed-cycle window, and the rule once', () => {
    const model = built()
    expect(model.standfirst.cycleInProgress).toBe('Cycle 13')
    expect(model.standfirst.window).toBe('last 6 completed cycles')
    expect(model.standfirst.rule).toBe(BINDING_TEAM_LEVEL_RULE)
    expect(model.standfirst.rule).toContain('never a per-person number')
  })

  it('drops the cycle clause rather than inventing a cycle when none is running', () => {
    const model = built({ cycles: COMPLETED })
    expect(model.standfirst.cycleInProgress).toBeNull()
    expect(model.standfirst.window).toBe('last 6 completed cycles')
  })

  it('labels a window shorter than the request with the cycles it actually covers', () => {
    const model = built({ cycles: [...WINDOW.slice(0, 2), ACTIVE], size: 6 })
    expect(model.cycleCount).toBe(2)
    expect(model.standfirst.window).toBe('last 2 completed cycles')
  })

  it('is null for a team with no completed cycle at all', () => {
    expect(buildDeliveryPage(input({ cycles: [ACTIVE] }), NOW)).toBeNull()
  })
})

describe('buildDeliveryPage — the annotated timeline is the cycle in progress', () => {
  const timeline = built().timeline

  it('draws one mark per successful deployment inside the cycle, at its own moment', () => {
    expect(timeline?.deploys).toHaveLength(5)
    expect(timeline?.deploys.map((entry) => entry.atMs)).toEqual([
      ACTIVE.startDate + 1 * DAY,
      ACTIVE.startDate + 2 * DAY,
      ACTIVE.startDate + 3 * DAY,
      ACTIVE.startDate + 7 * DAY,
      ACTIVE.startDate + 8 * DAY,
    ])
    expect(timeline?.deploys.every((entry) => entry.position >= 0 && entry.position <= 1)).toBe(
      true,
    )
  })

  it('states the day of the cycle and the days remaining from the cycle’s own dates', () => {
    expect(timeline?.dayIndex).toBe(9)
    expect(timeline?.dayCount).toBe(14)
    expect(timeline?.todayLabel).toBe('today · day 9 of 14')
    expect(timeline?.daysLeftLabel).toBe('5 days left')
  })

  it('marks a closed retrospective by its own title and close moment', () => {
    expect(timeline?.retros).toHaveLength(1)
    const retro = timeline?.retros[0]
    expect(retro?.title).toBe('Cycle 13 retro')
    expect(retro?.atMs).toBe(ACTIVE.startDate + 5 * DAY)
    expect(retro?.deploysBefore).toBe(3)
    expect(retro?.deploysAfter).toBe(2)
  })

  it('reports the counts either side of that date and claims no cause', () => {
    // Everything the timeline SAYS, as opposed to what its derivation disclaims below.
    const annotations = [
      timeline?.retros[0]?.counts ?? '',
      timeline?.callout?.headline ?? '',
      timeline?.callout?.subline ?? '',
      timeline?.label ?? '',
    ].join(' ')
    // The mock's "— the dots have been denser since" is a causal claim about a retro's effect, and
    // this product does not get to make it.
    expect(annotations).not.toMatch(
      /because|caused|since the retro|thanks to|led to|denser|as a result|agreed/i,
    )
    expect(timeline?.retros[0]?.counts).toMatch(/^3 before \w+ \d+ · 2 after$/)
    expect(timeline?.how.body).toMatch(/not a claim that one caused the other/)
  })

  it('calls out the first deployment of the busiest week, naming what the row carries', () => {
    expect(timeline?.callout?.atMs).toBe(ACTIVE.startDate + 1 * DAY)
    expect(timeline?.callout?.headline).toBe('checkout-v2 went out here')
    expect(timeline?.callout?.subline).toMatch(/· first of 3 that week$/)
    expect(timeline?.callout?.weekCount).toBe(3)
  })

  it('breaks a tie between two equally busy weeks to the earlier week', () => {
    const evenWeeks = [deploy(1), deploy(2), deploy(7), deploy(8)]
    const model = built({ deployments: evenWeeks })
    expect(model.timeline?.callout?.atMs).toBe(ACTIVE.startDate + 1 * DAY)
  })

  it('names no release when the deployment row carries none', () => {
    const model = built({ deployments: [deploy(1, { ref: null }), deploy(2, { ref: null })] })
    expect(model.timeline?.callout?.headline).toBe('A deployment went out here')
  })

  it('states what one mark is, and does not render at all with no cycle in progress', () => {
    expect(timeline?.markUnit).toBe('one dot is one deployment that reached production')
    expect(timeline?.label).toContain('one dot is one deployment')
    expect(built({ cycles: COMPLETED }).timeline).toBeNull()
  })
})

describe('buildDeliveryPage — the four stat readings', () => {
  const model = built()

  it('states the four the mock draws, in its order', () => {
    expect(model.stats.map((stat) => stat.key)).toEqual([
      'shipped',
      'pr_cycle_time',
      'ci_failing_rate',
      'issues_without_pr',
    ])
  })

  it('carries a per-cycle series with one entry per cycle in the window', () => {
    for (const stat of model.stats) expect(stat.series).toHaveLength(model.cycleCount)
  })

  it('states the delta’s direction in words as well as its sign', () => {
    const shipped = model.stats.find((stat) => stat.key === 'shipped')
    expect(shipped?.delta).not.toBeNull()
    expect(shipped?.delta?.words).toMatch(/^(up|down|no change)/)
    expect(shipped?.delta?.spoken).toContain('against the previous 6 completed cycles')
  })

  it('suppresses the delta entirely rather than comparing a window against a shorter one', () => {
    const model = built({ cycles: [...WINDOW, ACTIVE], size: 6 })
    for (const stat of model.stats) expect(stat.delta).toBeNull()
  })

  it('gives each reading a how · built here, with the constraints it was computed within', () => {
    for (const stat of model.stats) {
      expect(stat.how.body.length).toBeGreaterThan(0)
      expect(stat.how.constraint).toContain('team-level only')
    }
  })

  it('carries total and canceled inside the Shipped derivation, their only home', () => {
    const shipped = model.stats.find((stat) => stat.key === 'shipped')
    expect(shipped?.how.body).toMatch(/distinct issues that touched/)
    expect(shipped?.how.body).toMatch(/canceled instead/)
  })
})

describe('buildDeliveryPage — one dot is one merged pull request', () => {
  const model = built()
  const distribution = model.distribution

  it('draws one entry per DISTINCT merged change, so a twice-linked change is one dot', () => {
    expect(distribution?.entries).toHaveLength(4)
    const ids = distribution?.entries.map((entry) => entry.changeId) ?? []
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('pr-shared')
    expect(distribution?.markUnit).toBe('one dot is one merged pull request')
    expect(distribution?.label).toContain('one dot is one merged pull request')
  })

  it('reads the median off the same measure the reading states, not a second computation', () => {
    const scope = scopeOfCycles(deliveryCyclesOf(WINDOW, ISSUES))
    const measured = flowMeasures(scope).prCycleTimeHours
    expect(distribution?.medianHours).toBe(measured)
    expect(model.stats.find((stat) => stat.key === 'pr_cycle_time')?.value).toBe(measured)
    // 10, 30, 50 and 400 hours: the shared change counted twice would drag this to 30.
    expect(measured).toBe(40)
  })

  it('draws the median where it falls on an axis derived from the data', () => {
    expect(distribution?.axisMaxHours).toBeGreaterThanOrEqual(400)
    expect(distribution?.ticks[0]).toBe(0)
    expect(distribution?.ticks.at(-1)).toBe(distribution?.axisMaxHours)
    expect(distribution?.medianPosition).toBeCloseTo(
      (distribution?.medianHours ?? 0) / (distribution?.axisMaxHours ?? 1),
    )
  })

  it('names the crowd and the giants in words, with their counts', () => {
    const crowd = distribution?.annotations.find((entry) => entry.kind === 'crowd')
    const outlier = distribution?.annotations.find((entry) => entry.kind === 'outlier')
    expect(crowd?.count).toBe(2)
    expect(crowd?.text).toBe('2 of 4 merged inside 40h')
    expect(outlier?.count).toBe(1)
    expect(outlier?.text).toBe('1 change waited 400h or more')
    expect(distribution?.standfirst).toContain(
      `${DISTRIBUTION_OUTLIER_MULTIPLE} times that or longer`,
    )
  })

  it('does not render at all when the window holds no merged change', () => {
    const unlinked = ISSUES.map((row) => ({ ...row, issueLinks: undefined }))
    const model = built({ issues: unlinked })
    expect(model.distribution).toBeNull()
    expect(model.rhythm).toBeNull()
  })
})

// Spec §"Degrades to the data that exists": a whole family missing because nothing has been fed in
// is said ONCE, in the measurement scope's own words, rather than once per absent drawing.
describe('buildDeliveryPage — the absent family', () => {
  it('says nothing when the linked-change readings have something behind them', () => {
    expect(built().flowAbsence).toBeNull()
  })

  it('states it once, in the shared empty state, when no change is linked at all', () => {
    const unlinked = ISSUES.map((row) => ({ ...row, issueLinks: undefined }))
    const model = built({ issues: unlinked })
    expect(model.flowAbsence).toBe(
      flowEmptyState({ kind: 'window', cycleCount: model.cycleCount }).detail,
    )
    // One statement, not one per absent drawing.
    expect(model.distribution).toBeNull()
    expect(model.rhythm).toBeNull()
  })
})

describe('buildDeliveryPage — cycle flow', () => {
  const flow = built().flow

  it('draws one bar per completed cycle, newest labelled last', () => {
    expect(flow?.cycles).toHaveLength(6)
    expect(flow?.cycles.map((cycle) => cycle.label)).toEqual([
      '5 ago',
      '4 ago',
      '3 ago',
      '2 ago',
      '1 ago',
      'last',
    ])
  })

  it('draws a connection only between the cycle work left and the cycle it entered', () => {
    expect(flow?.carries).toEqual([{ fromIndex: 4, toIndex: 5, count: 1, label: '1 carried' }])
  })

  it('caps a bar with work added after that cycle started, and nothing when none was', () => {
    const last = flow?.cycles.at(-1)
    expect(last?.addedMidCycle).toBe(1)
    expect(last?.addedLabel).toBe('+1 added')
    expect(flow?.cycles[0]?.addedLabel).toBeNull()
  })

  it('states the carryover trend it can see, and the repeat carries', () => {
    expect(flow?.standfirst).toMatch(/^(\d+ items? carried from|Carryover is|Nothing carried)/)
    expect(flow?.standfirst).toContain('carried twice or more')
    expect(flow?.how.body).toContain('carried out past its end')
  })

  it('draws no connection and no cap when nothing carried and nothing was added', () => {
    const quiet = ISSUES.filter(
      (row) => row.rolledOverFromCycleId == null && row.cycleAssignedAt == null,
    )
    const model = built({ issues: quiet })
    expect(model.flow?.carries).toEqual([])
    expect(model.flow?.cycles.every((cycle) => cycle.addedLabel === null)).toBe(true)
    expect(model.flow?.standfirst).toContain('Nothing carried')
  })
})

describe('buildDeliveryPage — review rhythm names no reviewer', () => {
  const rhythm = built().rhythm

  it('draws one row per merged change, open → reviews → merge', () => {
    expect(rhythm?.changes).toHaveLength(4)
    const first = rhythm?.changes.find((change) => change.changeId === 'pr-1')
    expect(first?.reviewOffsetsHours).toEqual([2, 6])
    expect(first?.firstReviewHours).toBe(2)
    expect(first?.rounds).toBe(2)
    expect(first?.spanLabel).toBe('10h')
  })

  it('states its own duration rather than being clipped when it runs past the axis', () => {
    const giant = rhythm?.changes.find((change) => change.changeId === 'pr-giant')
    expect(giant?.overAxis).toBe(true)
    expect(giant?.spanLabel).toBe('400h')
  })

  it('states the two medians it draws over', () => {
    expect(rhythm?.standfirst).toContain('A first review arrived a median of')
    expect(rhythm?.standfirst).toContain('reviews came back a median of')
  })

  it('publishes its cap and the count it drew rather than truncating silently', () => {
    const many: LeakyIssueRow[] = Array.from({ length: REVIEW_RHYTHM_CAP + 3 }, (_, index) =>
      issue({
        id: `bulk-${index}`,
        cycleId: LAST.id,
        issueLinks: [
          {
            pullRequest: pr({
              id: `pr-bulk-${index}`,
              mergedAt: C_LAST + (index + 1) * HOUR,
            }),
          },
        ],
      }),
    )
    const model = built({ issues: many })
    const drawn = model.rhythm
    expect(drawn?.cap).toBe(REVIEW_RHYTHM_CAP)
    expect(drawn?.drawnCount).toBe(drawn?.cap)
    expect(drawn?.totalCount).toBe(REVIEW_RHYTHM_CAP + 3)
    expect(drawn?.capLabel).toBe(`showing ${drawn?.drawnCount} of ${drawn?.totalCount}`)
  })

  it('has no reviewer field at any depth, and no login anywhere in the section', () => {
    const keys = collectKeys(rhythm)
    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) expect([...keys]).not.toContain(forbidden)
    expect(JSON.stringify(rhythm)).not.toContain('octocat')
    expect(rhythm?.how.constraint).toContain('no reviewer is named')
  })
})

describe('buildDeliveryPage — the one peek', () => {
  const model = built()

  it('draws the diverged change whose merge is newest, in the dictionary’s words', () => {
    expect(model.peek?.issueKey).toBe('ENG-116')
    expect(model.peek?.phrase).toBe('Done in git, not on the board')
    expect(model.peek?.urgent).toBe(true)
    expect(model.peek?.strip.pr).toBe('merged')
  })

  it('counts the whole class, and picks the newest merge out of it', () => {
    // Two changes have diverged; the chip is the one whose merge is newest, and the count says how
    // many there are so the peek never implies it is the only one.
    expect(model.peek?.classCount).toBe(DIVERGED_IDS.length)
    expect(model.peek?.classLabel).toContain('done in git, not on the board')
    expect(model.peek?.issueId).toBe('diverged')
  })

  it('places the chip where the merge happened inside the cycle in progress', () => {
    expect(model.peek?.mergedAt).toBe(ACTIVE.startDate + 6 * DAY)
    expect(model.peek?.position).toBeCloseTo((6 * DAY) / (13 * DAY))
  })

  it('does not render at all when nothing has diverged', () => {
    const agreed = ISSUES.filter((row) => !DIVERGED_IDS.includes(row.id))
    expect(built({ issues: agreed }).peek).toBeNull()
  })
})

describe('buildDeliveryPage — blameless, and deterministic', () => {
  it('carries no identity dimension at any depth, over input that carries four', () => {
    const model = built()
    const keys = collectKeys(model)
    for (const forbidden of FORBIDDEN_IDENTITY_KEYS) {
      expect([...keys]).not.toContain(forbidden)
    }
    // The shape check passes for a login interpolated into a sentence, which is why the serialised
    // model is checked too.
    const serialised = JSON.stringify(model)
    expect(serialised).not.toContain('octocat')
    expect(serialised).not.toContain('hubot')
    expect(serialised).not.toContain('user-1')
    expect(serialised).not.toContain('user-2')
  })

  it('yields an identical model for identical input', () => {
    expect(built()).toEqual(built())
  })

  it('never renders a section as a zero-valued object', () => {
    const model = built({ issues: [], deployments: [], retros: [] })
    expect(model.distribution).toBeNull()
    expect(model.rhythm).toBeNull()
    expect(model.peek).toBeNull()
    expect(model.timeline?.deploys).toEqual([])
    expect(model.timeline?.callout).toBeNull()
  })
})
