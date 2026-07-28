import { describe, expect, it } from 'vitest'
import type { AreaDefinition } from './areas.js'
import {
  buildCycleFacts,
  type CycleFacts,
  type CycleFactsInput,
  withCycleAreas,
} from './cycle-facts.js'

const input: CycleFactsInput = {
  cycle: { id: 'cycle-1', teamId: 'team-1', name: 'Cycle 7' },
  teamKey: 'eng',
  issues: [
    {
      id: 'issue-shipped',
      number: 142,
      title: 'Guest checkout',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-1',
          number: 482,
          title: 'Add guest checkout',
          state: 'merged',
          ciChecks: [{ id: 'check-1', conclusion: 'success' }],
        },
      ],
    },
    {
      id: 'issue-carried',
      number: 143,
      title: 'Billing refactor',
      status: 'in_progress',
      pullRequests: [],
    },
    {
      id: 'issue-red',
      number: 144,
      title: 'Refund window',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-2',
          number: 483,
          title: 'Cut refund window',
          state: 'merged',
          ciChecks: [{ id: 'check-2', conclusion: 'failure' }],
        },
      ],
    },
    {
      id: 'issue-canceled',
      number: 145,
      title: 'Dropped work',
      status: 'canceled',
      pullRequests: [],
    },
  ],
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

describe('buildCycleFacts — team-level aggregates computed by yapm', () => {
  const facts = buildCycleFacts(input)

  it('computes the counts deterministically (numbers by yapm, not the model)', () => {
    expect(facts.counts).toEqual({
      total: 4,
      shipped: 2,
      carried: 1,
      canceled: 1,
      withLinkedPr: 2,
      withFailingCi: 1,
    })
  })

  it('rolls up CI health per issue and labels evidence with the team key', () => {
    const shipped = facts.issues.find((issue) => issue.issueId === 'issue-shipped')
    expect(shipped?.ciHealth).toBe('passing')
    expect(shipped?.evidenceRefs).toContainEqual({
      kind: 'issue',
      id: 'issue-shipped',
      label: 'ENG-142',
    })
    expect(shipped?.evidenceRefs).toContainEqual({
      kind: 'pull_request',
      id: 'pr-1',
      label: '#482',
    })
    const red = facts.issues.find((issue) => issue.issueId === 'issue-red')
    expect(red?.ciHealth).toBe('failing')
  })

  it('collects every evidence id as the cite-or-omit known-id set', () => {
    expect(new Set(facts.evidenceIds)).toEqual(
      new Set([
        'issue-shipped',
        'pr-1',
        'check-1',
        'issue-carried',
        'issue-red',
        'pr-2',
        'check-2',
        'issue-canceled',
      ]),
    )
  })

  it('carries NO assignee/author/reviewer/creator/user dimension anywhere in the result', () => {
    const keys = allKeys(facts)
    for (const forbidden of [
      'assignee',
      'assigneeId',
      'author',
      'authorId',
      'reviewer',
      'creator',
      'creatorId',
      'userId',
      'user_id',
    ]) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })
})

// The exact object `buildCycleFacts` produced BEFORE the area layer existed, written out by hand.
// `feat/retro-ai-draft` consumes this shape concurrently, so the additivity promise is a literal,
// not a paraphrase: any rename, restructure, or newly-always-present field breaks this test.
const PRE_CHANGE_FACTS: CycleFacts = {
  cycleId: 'cycle-1',
  teamId: 'team-1',
  cycleName: 'Cycle 7',
  counts: {
    total: 4,
    shipped: 2,
    carried: 1,
    canceled: 1,
    withLinkedPr: 2,
    withFailingCi: 1,
  },
  issues: [
    {
      issueId: 'issue-shipped',
      number: 142,
      title: 'Guest checkout',
      status: 'done',
      shipped: true,
      carried: false,
      ciHealth: 'passing',
      evidenceRefs: [
        { kind: 'issue', id: 'issue-shipped', label: 'ENG-142' },
        { kind: 'pull_request', id: 'pr-1', label: '#482' },
        { kind: 'ci_check', id: 'check-1' },
      ],
    },
    {
      issueId: 'issue-carried',
      number: 143,
      title: 'Billing refactor',
      status: 'in_progress',
      shipped: false,
      carried: true,
      ciHealth: null,
      evidenceRefs: [{ kind: 'issue', id: 'issue-carried', label: 'ENG-143' }],
    },
    {
      issueId: 'issue-red',
      number: 144,
      title: 'Refund window',
      status: 'done',
      shipped: true,
      carried: false,
      ciHealth: 'failing',
      evidenceRefs: [
        { kind: 'issue', id: 'issue-red', label: 'ENG-144' },
        { kind: 'pull_request', id: 'pr-2', label: '#483' },
        { kind: 'ci_check', id: 'check-2' },
      ],
    },
    {
      issueId: 'issue-canceled',
      number: 145,
      title: 'Dropped work',
      status: 'canceled',
      shipped: false,
      carried: false,
      ciHealth: null,
      evidenceRefs: [{ kind: 'issue', id: 'issue-canceled', label: 'ENG-145' }],
    },
  ],
  evidenceIds: [
    'issue-shipped',
    'pr-1',
    'check-1',
    'issue-carried',
    'issue-red',
    'pr-2',
    'check-2',
    'issue-canceled',
  ],
}

describe('buildCycleFacts — the area layer is STRICTLY ADDITIVE', () => {
  it('produces the pre-change object exactly when no area data is supplied', () => {
    const bare = buildCycleFacts(input)
    // `toStrictEqual`, not `toEqual`: it fails on an own property whose value is `undefined`, so an
    // `areas: undefined` that slipped in unconditionally would be caught here rather than pass.
    expect(bare).toStrictEqual(PRE_CHANGE_FACTS)
  })

  it('adds no key at the top level or on an issue for an un-enriched caller', () => {
    const bare = buildCycleFacts(input)
    expect(Object.keys(bare).sort()).toEqual([
      'counts',
      'cycleId',
      'cycleName',
      'evidenceIds',
      'issues',
      'teamId',
    ])
    for (const issue of bare.issues) {
      expect(Object.keys(issue).sort()).toEqual([
        'carried',
        'ciHealth',
        'evidenceRefs',
        'issueId',
        'number',
        'shipped',
        'status',
        'title',
      ])
    }
  })

  it('supplying only an area catalog, with no PR areas, still produces no area layer', () => {
    const bare = buildCycleFacts({ ...input, areaCatalog: [{ area: 'Billing', sensitive: true }] })
    expect(bare).toStrictEqual(PRE_CHANGE_FACTS)
  })
})

const catalog: AreaDefinition[] = [
  { area: 'Billing', sensitive: true },
  { area: 'Web' },
  { area: 'Tooling', internal: true },
]

const enrichedInput: CycleFactsInput = {
  cycle: { id: 'cycle-2', teamId: 'team-1', name: 'Cycle 8' },
  teamKey: 'ENG',
  areaCatalog: catalog,
  issues: [
    {
      id: 'issue-billing',
      number: 1,
      title: 'Shorten the refund window',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-a',
          number: 1,
          title: null,
          state: 'merged',
          areas: ['Billing'],
          changedLines: 40,
        },
        {
          id: 'pr-b',
          number: 2,
          title: null,
          state: 'merged',
          areas: ['Billing', 'Web'],
          changedLines: 30,
        },
      ],
    },
    {
      id: 'issue-internal',
      number: 2,
      title: 'Bump the toolchain',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-c',
          number: 3,
          title: null,
          state: 'merged',
          areas: ['Tooling'],
          changedLines: 4,
        },
      ],
    },
    {
      id: 'issue-unmapped',
      number: 3,
      title: 'Somewhere unmapped',
      status: 'done',
      pullRequests: [
        {
          id: 'pr-d',
          number: 4,
          title: null,
          state: 'merged',
          areas: ['unmapped'],
          changedLines: 5000,
        },
      ],
    },
    {
      id: 'issue-none',
      number: 4,
      title: 'No linked PR',
      status: 'in_progress',
      pullRequests: [],
    },
  ],
}

describe('buildCycleFacts — area aggregates, team-level and yapm-computed', () => {
  const facts = buildCycleFacts(enrichedInput)

  it('groups issues and PRs by area, flagging the sensitive ones', () => {
    expect(facts.areas).toEqual([
      { area: 'Billing', issueCount: 1, prCount: 2, sensitive: true },
      { area: 'Tooling', issueCount: 1, prCount: 1, sensitive: false },
      { area: 'Web', issueCount: 1, prCount: 1, sensitive: false },
      { area: 'unmapped', issueCount: 1, prCount: 1, sensitive: false },
    ])
    expect(facts.touchedSensitiveAreas).toEqual(['Billing'])
  })

  it('bands each issue by its summed change count and lists its areas', () => {
    const billing = facts.issues.find((issue) => issue.issueId === 'issue-billing')
    expect(billing?.areas).toEqual(['Billing', 'Web'])
    // 40 + 30 = 70 changed lines -> `m`, never the raw number.
    expect(billing?.sizeBand).toBe('m')
    expect(facts.issues.find((issue) => issue.issueId === 'issue-internal')?.sizeBand).toBe('xs')
    expect(facts.issues.find((issue) => issue.issueId === 'issue-unmapped')?.sizeBand).toBe('xl')
  })

  it('leaves an issue with no linked PR untouched — no areas, no band', () => {
    const none = facts.issues.find((issue) => issue.issueId === 'issue-none')
    expect(none).not.toHaveProperty('areas')
    expect(none).not.toHaveProperty('sizeBand')
  })

  it('counts internal improvements without removing those issues from the facts', () => {
    expect(facts.internalImprovements).toBe(1)
    // The collapse is a COUNT the narration acts on — the team's own facts keep every issue.
    expect(facts.issues.map((issue) => issue.issueId)).toContain('issue-internal')
    expect(facts.issues).toHaveLength(4)
  })

  it('never treats unmapped work as an internal improvement', () => {
    const onlyUnmapped = buildCycleFacts({
      ...enrichedInput,
      issues: [enrichedInput.issues[2] as (typeof enrichedInput.issues)[number]],
    })
    expect(onlyUnmapped.internalImprovements).toBe(0)
  })

  // The prompt asks the model to restate `prCount` verbatim, so a pull request that closes two
  // issues must be ONE pull request in the grouping — counting it per issue would put a number in the
  // digest that no entity in the graph supports.
  it('counts a pull request that closes two issues once', () => {
    const shared = buildCycleFacts({
      cycle: { id: 'cycle-1', teamId: 'team-1', name: 'Cycle 9' },
      areaCatalog: [{ area: 'Billing', sensitive: true }],
      issues: ['issue-one', 'issue-two'].map((id) => ({
        id,
        number: id === 'issue-one' ? 1 : 2,
        title: 'Refund window',
        status: 'done' as const,
        pullRequests: [
          {
            id: 'pr-shared',
            number: 9,
            title: null,
            state: 'merged' as const,
            areas: ['Billing'],
            changedLines: 12,
          },
        ],
      })),
    })
    expect(shared.areas).toEqual([{ area: 'Billing', issueCount: 2, prCount: 1, sensitive: true }])
  })

  it('carries no identity dimension once the area layer is present', () => {
    const keys = allKeys(facts)
    for (const forbidden of ['assignee', 'author', 'reviewer', 'creator', 'userId', 'user_id']) {
      expect(keys.has(forbidden)).toBe(false)
    }
  })
})

describe('withCycleAreas — the same derivation, layered onto already-built facts', () => {
  const bare = buildCycleFacts({
    ...enrichedInput,
    areaCatalog: undefined,
    issues: enrichedInput.issues.map((issue) => ({
      ...issue,
      pullRequests: issue.pullRequests.map((pr) => ({
        id: pr.id,
        number: pr.number,
        title: pr.title,
        state: pr.state,
      })),
    })),
  })

  it('produces the same area layer as buildCycleFacts did from its input', () => {
    const layered = withCycleAreas(bare, {
      prAreas: new Map([
        ['pr-a', { areas: ['Billing'], changedLines: 40 }],
        ['pr-b', { areas: ['Billing', 'Web'], changedLines: 30 }],
        ['pr-c', { areas: ['Tooling'], changedLines: 4 }],
        ['pr-d', { areas: ['unmapped'], changedLines: 5000 }],
      ]),
      catalog,
    })
    const direct = buildCycleFacts(enrichedInput)
    expect(layered.areas).toEqual(direct.areas)
    expect(layered.touchedSensitiveAreas).toEqual(direct.touchedSensitiveAreas)
    expect(layered.internalImprovements).toBe(direct.internalImprovements)
    expect(layered.issues).toEqual(direct.issues)
  })

  it('records partial coverage without inventing an area layer', () => {
    const layered = withCycleAreas(bare, {
      prAreas: new Map(),
      catalog,
      coverage: { enriched: 0, skipped: 4 },
    })
    expect(layered.areaCoverage).toEqual({ enriched: 0, skipped: 4 })
    expect(layered).not.toHaveProperty('areas')
    expect(layered.issues).toStrictEqual(bare.issues)
  })

  it('returns the very same object when there is nothing to layer', () => {
    expect(withCycleAreas(bare, { prAreas: new Map() })).toBe(bare)
  })
})
