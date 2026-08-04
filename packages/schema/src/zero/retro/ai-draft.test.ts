import { describe, expect, it } from 'vitest'
import {
  type BakeablePriorRetro,
  type BakeableRetroAction,
  bakeRetroActionRefs,
  capRetroProposals,
  type RetroDraftContent,
  rankRetroProposals,
  retroDraftContentSchema,
  retroProposalBucket,
  sanitizeRetroDraft,
} from './ai-draft.js'

const KNOWN = new Set([
  'issue-1',
  'issue-2',
  'pr-1',
  // A computed seed metric key: `widget` is a legal ref kind, so a proposal may cite the number
  // itself and the UI renders yapm's value beside the sentence.
  'time_to_first_review',
])

const NO_ROSTER: { name?: string | null; email?: string | null }[] = []

function proposal(
  category: 'win' | 'loss' | 'improvement',
  summary: string,
  refIds: readonly string[],
): RetroDraftContent['proposals'][number] {
  return {
    category,
    summary,
    refs: refIds.map((id) => ({ kind: 'issue' as const, id })),
    confidence: 'medium',
  }
}

describe('retroDraftContentSchema', () => {
  it('accepts a widget ref, because a proposal may cite a computed metric key', () => {
    const parsed = retroDraftContentSchema.parse({
      proposals: [
        {
          category: 'loss',
          summary: 'Review wait dominated lead time.',
          refs: [{ kind: 'widget', id: 'time_to_first_review', label: 'Time to first review' }],
          confidence: 'high',
        },
      ],
    })

    expect(parsed.proposals[0]?.refs[0]?.kind).toBe('widget')
  })

  it('parses an empty result without throwing', () => {
    const empty = retroDraftContentSchema.parse({ proposals: [] })

    expect(sanitizeRetroDraft(empty, KNOWN, NO_ROSTER, null).proposals).toEqual([])
    expect(rankRetroProposals(empty)).toEqual([])
  })
})

describe('sanitizeRetroDraft — cite-or-omit', () => {
  it('strips a hallucinated id and an unknown metric key, and drops a proposal left with none', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'win',
          summary: 'Guest checkout shipped.',
          refs: [
            { kind: 'issue', id: 'issue-1' },
            { kind: 'issue', id: 'issue-invented' },
          ],
          confidence: 'high',
        },
        {
          category: 'win',
          summary: 'A claim about a metric that does not exist.',
          refs: [{ kind: 'widget', id: 'deploy_frequency' }],
          confidence: 'low',
        },
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER, null)

    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]?.summary).toBe('Guest checkout shipped.')
    expect(result.proposals[0]?.refs).toEqual([{ kind: 'issue', id: 'issue-1' }])
  })

  it('keeps a proposal citing a real widget metric key', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'loss',
          summary: 'First review took most of the lead time.',
          refs: [{ kind: 'widget', id: 'time_to_first_review' }],
          confidence: 'medium',
        },
      ],
    }

    expect(sanitizeRetroDraft(content, KNOWN, NO_ROSTER, null).proposals).toHaveLength(1)
  })
})

describe('sanitizeRetroDraft — the name backstop', () => {
  const roster = [{ name: 'Ada Lovelace', email: 'ada@example.com' }]

  it('drops the name-bearing proposal while its siblings survive', () => {
    const content: RetroDraftContent = {
      proposals: [
        proposal('improvement', 'Ada Lovelace should review sooner.', ['issue-1']),
        proposal('improvement', 'Reviews should start within a day.', ['issue-2']),
        proposal('win', 'The release landed.', ['pr-1']),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN, roster, null)

    expect(result.proposals.map((p) => p.summary)).toEqual([
      'The release landed.',
      'Reviews should start within a day.',
    ])
  })
})

describe('sanitizeRetroDraft — the cap, applied last', () => {
  it('caps six clean wins to exactly three, in model order', () => {
    const content: RetroDraftContent = {
      proposals: [1, 2, 3, 4, 5, 6].map((n) => proposal('win', `Win ${n}`, ['issue-1'])),
    }

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER, null)

    expect(result.proposals.map((p) => p.summary)).toEqual(['Win 1', 'Win 2', 'Win 3'])
  })

  it('caps AFTER the drops, so a dropped proposal is replaced rather than leaving a hole', () => {
    const content: RetroDraftContent = {
      proposals: [
        proposal('win', 'Win 1', ['issue-1']),
        // Uncited: its only ref is invented, so it is dropped before the cap runs.
        proposal('win', 'Win 2', ['issue-invented']),
        proposal('win', 'Win 3', ['issue-2']),
        proposal('win', 'Win 4', ['pr-1']),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER, null)

    expect(result.proposals.map((p) => p.summary)).toEqual(['Win 1', 'Win 3', 'Win 4'])
  })

  it('caps each category independently', () => {
    const content: RetroDraftContent = {
      proposals: [
        ...[1, 2, 3, 4].map((n) => proposal('win', `Win ${n}`, ['issue-1'])),
        ...[1, 2, 3, 4].map((n) => proposal('loss', `Loss ${n}`, ['issue-1'])),
      ],
    }

    const result = capRetroProposals(content, 3)

    expect(result.proposals.filter((p) => p.category === 'win')).toHaveLength(3)
    expect(result.proposals.filter((p) => p.category === 'loss')).toHaveLength(3)
  })
})

describe('rankRetroProposals', () => {
  it('assigns a dense 0-based rank within each category', () => {
    const content: RetroDraftContent = {
      proposals: [
        proposal('win', 'Win 1', ['issue-1']),
        proposal('loss', 'Loss 1', ['issue-1']),
        proposal('win', 'Win 2', ['issue-1']),
        proposal('improvement', 'Improvement 1', ['issue-1']),
        proposal('loss', 'Loss 2', ['issue-1']),
      ],
    }

    expect(rankRetroProposals(content).map((p) => [p.category, p.rank])).toEqual([
      ['win', 0],
      ['loss', 0],
      ['win', 1],
      ['improvement', 0],
      ['loss', 1],
    ])
  })
})

// The prior retro's two agreed actions, as the citable set and the label baker both see them.
const ACTION_SHIPPED: BakeableRetroAction = {
  id: 'action-1',
  body: 'Split the release check in two',
  outcome: 'shipped',
}
const ACTION_CANCELED: BakeableRetroAction = {
  id: 'action-2',
  body: 'Rotate the on-call doc weekly',
  outcome: 'canceled',
}
const PRIOR: BakeablePriorRetro = {
  cycleName: 'Cycle 6',
  actions: [ACTION_SHIPPED, ACTION_CANCELED],
  totals: { shipped: 1, canceled: 1, in_flight: 0, not_converted: 0 },
}

// The citable set a cycle with a prior retro produces: this cycle's evidence, plus the prior actions
// and the four outcome-total keys.
const KNOWN_WITH_PRIOR = new Set([...KNOWN, 'action-1', 'action-2', 'prior_retro_shipped'])

function followUp(
  summary: string,
  actionId: string,
  category: 'win' | 'loss' | 'improvement' = 'win',
): RetroDraftContent['proposals'][number] {
  return {
    category,
    summary,
    refs: [{ kind: 'retro_action', id: actionId }],
    confidence: 'medium',
  }
}

// A reference as the bucket classifier sees one: it inspects `kind` and nothing else, which is what
// lets the stored row, the model's parsed output and the client's synced row all be bucketed by the
// same function with no adapter between them.
const ref = (kind: string, id: string): { kind: string; id: string } => ({ kind, id })

describe('retroProposalBucket', () => {
  it('is the stored category when nothing points at a prior action', () => {
    for (const category of ['win', 'loss', 'improvement'] as const) {
      expect(retroProposalBucket(proposal(category, 'x', ['issue-1']))).toBe(category)
      expect(retroProposalBucket({ category, refs: [ref('widget', 'shipped')] })).toBe(category)
      expect(retroProposalBucket({ category })).toBe(category)
      expect(retroProposalBucket({ category, refs: null })).toBe(category)
    }
  })

  // IFF. A follow-up is a proposal that cites a `retro_action`, whatever it was stored as — which is
  // the whole reason the bucket is derived rather than stored.
  it('is follow_up exactly when a retro_action reference is present, at any position', () => {
    expect(retroProposalBucket(followUp('Shipped last cycle’s fix.', 'action-1'))).toBe('follow_up')
    expect(retroProposalBucket(followUp('Abandoned it.', 'action-2', 'loss'))).toBe('follow_up')
    expect(
      retroProposalBucket({
        category: 'improvement',
        refs: [ref('issue', 'issue-1'), ref('retro_action', 'action-1')],
      }),
    ).toBe('follow_up')
  })
})

describe('the cap and the rank count by bucket', () => {
  // Four follow-ups and four improvements, all STORED as `improvement`, so bucketing by the stored
  // column would keep three of the eight. Bucketing by the derived bucket keeps three of each — which
  // is what stops a cycle full of follow-ups from crowding out what the team should do next.
  const mixed: RetroDraftContent = {
    proposals: [
      ...[1, 2, 3, 4].map((n) => followUp(`Follow-up ${n}`, 'action-1', 'improvement')),
      ...[1, 2, 3, 4].map((n) => proposal('improvement', `Improvement ${n}`, ['issue-1'])),
    ],
  }

  it('gives three follow-ups AND three improvements out of eight rows stored as one category', () => {
    const capped = capRetroProposals(mixed, 3)

    expect(capped.proposals.map((p) => p.summary)).toEqual([
      'Follow-up 1',
      'Follow-up 2',
      'Follow-up 3',
      'Improvement 1',
      'Improvement 2',
      'Improvement 3',
    ])
    expect(capped.proposals.filter((p) => p.category === 'improvement')).toHaveLength(6)
  })

  it('ranks densely within each bucket, not within the stored category', () => {
    const ranked = rankRetroProposals(capRetroProposals(mixed, 3))

    expect(ranked.map((p) => [retroProposalBucket(p), p.rank])).toEqual([
      ['follow_up', 0],
      ['follow_up', 1],
      ['follow_up', 2],
      ['improvement', 0],
      ['improvement', 1],
      ['improvement', 2],
    ])
    // Every row still stores one of the three legal category values: the bucket costs no DDL.
    for (const row of ranked) expect(row.category).toBe('improvement')
  })

  it('survives the whole chain: three follow-ups beside three improvements', () => {
    const result = sanitizeRetroDraft(mixed, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    const buckets = result.proposals.map(retroProposalBucket)
    expect(buckets.filter((bucket) => bucket === 'follow_up')).toHaveLength(3)
    expect(buckets.filter((bucket) => bucket === 'improvement')).toHaveLength(3)
  })
})

// THE CAP IS GENUINELY LAST. Both cases below are the same defect seen from its two sides: the bake
// drops references and therefore RE-BUCKETS proposals, so a bake that ran after the cap would move
// rows between buckets that had already been counted. Each proposal here stamps the loop-closing kind
// on a real ISSUE id — citable, so cite-or-omit alone lets it through — which is exactly the crossing
// `narrowRetroActionRefs` exists to refuse.
describe('nothing re-buckets a proposal after the cap has counted it', () => {
  const crossed = (summary: string): RetroDraftContent['proposals'][number] => ({
    category: 'win',
    summary,
    refs: [
      { kind: 'retro_action', id: 'issue-1' },
      { kind: 'issue', id: 'issue-1' },
    ],
    confidence: 'medium',
  })

  it('never lets a bucket end up holding four proposals', () => {
    const content: RetroDraftContent = {
      proposals: [
        crossed('A win wearing a follow-up’s kind.'),
        ...[1, 2, 3].map((n) => proposal('win', `Win ${n}`, ['issue-1'])),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals).toHaveLength(3)
    expect(result.proposals.map(retroProposalBucket)).toEqual(['win', 'win', 'win'])
  })

  it('never lets bogus follow-ups consume the cap and then vanish', () => {
    const content: RetroDraftContent = {
      proposals: [
        // Three that look like follow-ups until the reference is checked, ahead of three real ones.
        ...[1, 2, 3].map((n) => ({
          category: 'win' as const,
          summary: `Not really a follow-up ${n}.`,
          refs: [{ kind: 'retro_action' as const, id: 'issue-1' }],
          confidence: 'medium' as const,
        })),
        ...[1, 2, 3].map((n) => followUp(`Real follow-up ${n}`, 'action-1')),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals.map((p) => p.summary)).toEqual([
      'Real follow-up 1',
      'Real follow-up 2',
      'Real follow-up 3',
    ])
    expect(result.proposals.map(retroProposalBucket)).toEqual([
      'follow_up',
      'follow_up',
      'follow_up',
    ])
  })
})

// THE FIRST-RETRO GUARANTEE, proven through the SHIPPED validator rather than through a branch. A
// team with no prior retro contributes no action id to the citable set, so a model that invents one
// has the reference narrowed away and the proposal dropped with it. There is no first-retro code
// path to get wrong, and this is the test that says so.
describe('a first retro produces no follow-up, without a first-retro branch', () => {
  it('drops a proposal citing an invented action id when nothing prior is citable', () => {
    const content: RetroDraftContent = {
      proposals: [
        followUp('Last cycle we agreed to split the release check, and we did.', 'action-1'),
        proposal('win', 'Guest checkout shipped.', ['issue-1']),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER, null)

    expect(result.proposals.map((p) => p.summary)).toEqual(['Guest checkout shipped.'])
    expect(result.proposals.map(retroProposalBucket)).not.toContain('follow_up')
  })

  it('bakes nothing when there is no prior retro, so no follow-up chip can exist', () => {
    const baked = bakeRetroActionRefs(
      { proposals: [followUp('Invented.', 'action-1'), proposal('win', 'Real.', ['issue-1'])] },
      null,
    )

    expect(baked.proposals.map((p) => p.summary)).toEqual(['Real.'])
  })
})

// YAPM SAYS WHAT THE MODEL IS POINTING AT. This is the one reference kind the client cannot resolve
// from its own synced rows, so the label is the whole caption — and it must never be the model's.
describe('bakeRetroActionRefs', () => {
  const modelWrote: RetroDraftContent = {
    proposals: [
      {
        category: 'win',
        summary: 'The release check split landed.',
        refs: [
          {
            kind: 'retro_action',
            id: 'action-1',
            label: 'we shipped everything, 100% done',
            outcome: 'canceled',
            origin: 'Cycle 99',
          },
        ],
        confidence: 'high',
      },
    ],
  }

  it('overwrites the label, the outcome and the origin the model supplied', () => {
    const ref = bakeRetroActionRefs(modelWrote, PRIOR).proposals[0]?.refs[0]

    expect(ref?.label).toBe('Split the release check in two — shipped')
    expect(ref?.outcome).toBe('shipped')
    expect(ref?.origin).toBe('Cycle 6')
    // Not one word of what the model wrote survives into storage.
    expect(JSON.stringify(ref)).not.toContain('100%')
    expect(JSON.stringify(ref)).not.toContain('Cycle 99')
  })

  it('strips the two baked fields from every other reference kind', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'loss',
          summary: 'Reviews were slow.',
          refs: [
            { kind: 'issue', id: 'issue-1', label: 'kept', outcome: 'shipped', origin: 'Cycle 99' },
            { kind: 'widget', id: 'time_to_first_review', outcome: 'shipped' },
          ],
          confidence: 'medium',
        },
      ],
    }

    expect(bakeRetroActionRefs(content, PRIOR).proposals[0]?.refs).toEqual([
      // The label on a work-graph ref is left alone: the client resolves that chip from its own
      // synced row and never renders the label, so there is nothing to overwrite.
      { kind: 'issue', id: 'issue-1', label: 'kept' },
      { kind: 'widget', id: 'time_to_first_review' },
    ])
  })

  it('truncates a long body rather than letting a prior retro’s wording take over the row', () => {
    const long = 'a'.repeat(200)
    const ref = bakeRetroActionRefs(
      { proposals: [followUp('Reported.', 'action-3')] },
      {
        cycleName: 'Cycle 6',
        actions: [{ id: 'action-3', body: long, outcome: 'in_flight' }],
        totals: { shipped: 0, canceled: 0, in_flight: 1, not_converted: 0 },
      },
    ).proposals[0]?.refs[0]

    expect(ref?.label?.length).toBeLessThan(120)
    expect(ref?.label).toContain('…')
    expect(ref?.label).toContain('still open')
  })

  it('drops a reference to an action the prior retro does not have, and the empty proposal with it', () => {
    const content: RetroDraftContent = {
      proposals: [
        followUp('Reports on nothing.', 'action-does-not-exist'),
        {
          category: 'improvement',
          summary: 'Keeps a real citation beside a fake one.',
          refs: [
            { kind: 'retro_action', id: 'action-does-not-exist' },
            { kind: 'issue', id: 'issue-1' },
          ],
          confidence: 'low',
        },
      ],
    }

    const baked = bakeRetroActionRefs(content, PRIOR)

    expect(baked.proposals.map((p) => p.summary)).toEqual([
      'Keeps a real citation beside a fake one.',
    ])
    expect(baked.proposals[0]?.refs).toEqual([{ kind: 'issue', id: 'issue-1' }])
  })

  // The four outcome totals are citable so a proposal can point at a count rather than type one —
  // which only means something if the count is renderable. No seed metric carries these keys, so
  // yapm writes their caption here or nothing ever draws them.
  it('writes yapm’s own count onto a cited outcome total', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'win',
          summary: 'One of the two improvements we agreed landed.',
          refs: [{ kind: 'widget', id: 'prior_retro_shipped', label: 'all of them, obviously' }],
          confidence: 'high',
        },
      ],
    }

    const ref = bakeRetroActionRefs(content, PRIOR).proposals[0]?.refs[0]

    expect(ref).toEqual({
      kind: 'widget',
      id: 'prior_retro_shipped',
      label: '1 shipped',
      outcome: 'shipped',
    })
  })

  it('drops a cited outcome total when there is no prior retro to count', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'win',
          summary: 'Invents a count out of nothing.',
          refs: [{ kind: 'widget', id: 'prior_retro_shipped' }],
          confidence: 'low',
        },
      ],
    }

    expect(bakeRetroActionRefs(content, null).proposals).toEqual([])
  })

  it('leaves a baked proposal parseable by the stored schema', () => {
    const baked = bakeRetroActionRefs(modelWrote, PRIOR)

    expect(retroDraftContentSchema.parse(baked)).toEqual(baked)
  })
})
