import { describe, expect, it } from 'vitest'
import {
  type BakeablePriorRetro,
  type BakeableRetroAction,
  bakeRetroActionRefs,
  capRetroProposals,
  type RetroCitations,
  type RetroDraftContent,
  type RetroProposalCategory,
  rankRetroProposals,
  retroDraftContentSchema,
  sanitizeRetroDraft,
} from './ai-draft.js'

const KNOWN: RetroCitations = {
  evidence: ['issue-1', 'issue-2', 'pr-1'],
  // A computed seed metric key: `widget` is a legal ref kind, so a proposal may cite the number
  // itself and the UI renders yapm's value beside the sentence.
  widget: ['time_to_first_review'],
  retroAction: [],
}

const NO_ROSTER: { name?: string | null; email?: string | null }[] = []

function proposal(
  category: RetroProposalCategory,
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

// The citable namespaces a cycle with a prior retro produces: this cycle's evidence, the metric keys
// and the outcome-total keys under `widget`, and the prior actions under `retro_action`.
const KNOWN_WITH_PRIOR: RetroCitations = {
  evidence: KNOWN.evidence,
  widget: [...KNOWN.widget, 'prior_retro_shipped'],
  retroAction: ['action-1', 'action-2'],
}

function followUp(
  summary: string,
  actionId: string,
  category: RetroProposalCategory = 'follow_up',
): RetroDraftContent['proposals'][number] {
  return {
    category,
    summary,
    refs: [{ kind: 'retro_action', id: actionId }],
    confidence: 'medium',
  }
}

// A `follow_up` MUST BE BACKED BY THE ACTION IT REPORTS ON. This is the one property change 22's
// derived bucket got for free — a follow-up could not exist without citing a prior action, because
// citing one WAS the definition — and the property a stored category has to enforce. Every case here
// runs through `sanitizeRetroDraft`, so it is the shipped path rather than a direct validator call.
describe('a follow_up with no prior-action reference is dropped', () => {
  it('drops one whose only citation is a perfectly valid issue', () => {
    const content: RetroDraftContent = {
      proposals: [
        proposal('follow_up', 'We agreed something last retro and it went well.', ['issue-1']),
        proposal('win', 'Guest checkout shipped.', ['issue-2']),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals.map((p) => p.summary)).toEqual(['Guest checkout shipped.'])
  })

  // AFTER THE BAKE, and this is the case that fixes the validator's position in the chain. The bake
  // removes a reference naming an action the prior retro does not have; the follow-up left behind is
  // still cited — by the issue — so cite-or-omit keeps it. Only a validator downstream of the bake
  // drops it, rather than storing a follow-up backed by an issue chip and nothing else.
  it('drops one the bake orphaned, rather than leaving it backed by an issue', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'follow_up',
          summary: 'Reports on an action this retro never agreed.',
          refs: [
            { kind: 'retro_action', id: 'action-9' },
            { kind: 'issue', id: 'issue-1' },
          ],
          confidence: 'medium',
        },
      ],
    }

    const withAction9: RetroCitations = {
      ...KNOWN_WITH_PRIOR,
      retroAction: [...KNOWN_WITH_PRIOR.retroAction, 'action-9'],
    }

    expect(sanitizeRetroDraft(content, withAction9, NO_ROSTER, PRIOR).proposals).toEqual([])
  })

  // THE CONVERSE IS DELIBERATELY NOT ENFORCED. An `improvement` may cite the prior action it is a
  // repeat of and is stored as what it says it is — which is what keeps change 19's one-keystroke
  // "add this improvement as an action" on the proposal most likely to deserve it.
  it('keeps an improvement that cites a real prior action, with its baked caption intact', () => {
    const content: RetroDraftContent = {
      proposals: [followUp('Let us try the release split again.', 'action-2', 'improvement')],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals[0]?.category).toBe('improvement')
    expect(result.proposals[0]?.refs[0]).toEqual({
      kind: 'retro_action',
      id: 'action-2',
      label: 'Rotate the on-call doc weekly — canceled',
      outcome: 'canceled',
      origin: 'Cycle 6',
    })
  })
})

describe('the cap and the rank count by stored category', () => {
  // Four follow-ups and four improvements. The cap counts follow-ups on the same line as every other
  // category, which is what stops a cycle full of them from crowding out what the team should do next.
  const mixed: RetroDraftContent = {
    proposals: [
      ...[1, 2, 3, 4].map((n) => followUp(`Follow-up ${n}`, 'action-1')),
      ...[1, 2, 3, 4].map((n) => proposal('improvement', `Improvement ${n}`, ['issue-1'])),
    ],
  }

  it('caps four follow-ups to three, and gives three improvements beside them', () => {
    const capped = capRetroProposals(mixed, 3)

    expect(capped.proposals.map((p) => p.summary)).toEqual([
      'Follow-up 1',
      'Follow-up 2',
      'Follow-up 3',
      'Improvement 1',
      'Improvement 2',
      'Improvement 3',
    ])
  })

  it('ranks densely within each category', () => {
    const ranked = rankRetroProposals(capRetroProposals(mixed, 3))

    expect(ranked.map((p) => [p.category, p.rank])).toEqual([
      ['follow_up', 0],
      ['follow_up', 1],
      ['follow_up', 2],
      ['improvement', 0],
      ['improvement', 1],
      ['improvement', 2],
    ])
  })

  it('survives the whole chain: three follow-ups beside three improvements', () => {
    const result = sanitizeRetroDraft(mixed, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    const categories = result.proposals.map((p) => p.category)
    expect(categories.filter((category) => category === 'follow_up')).toHaveLength(3)
    expect(categories.filter((category) => category === 'improvement')).toHaveLength(3)
  })
})

// THE CAP IS GENUINELY LAST. Both cases below are the same defect seen from its two sides: the bake
// drops references and therefore RE-BUCKETS proposals, so a bake that ran after the cap would move
// rows between buckets that had already been counted. Each proposal here stamps the loop-closing kind
// on a real ISSUE id — citable, so cite-or-omit alone lets it through — which is exactly the crossing
// `narrowRetroRefNamespaces` exists to refuse.
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
    expect(result.proposals.map((p) => p.category)).toEqual(['win', 'win', 'win'])
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
    expect(result.proposals.map((p) => p.category)).toEqual(['follow_up', 'follow_up', 'follow_up'])
  })
})

// THE OTHER DIRECTION, and the reason citability is a (namespace, id) pair rather than one flat set.
// Every id below is one yapm computed, so cite-or-omit alone keeps all of them — and each would then
// sit on a proposal whose chip no surface can draw: the client resolves an ordinary kind against its
// synced work-graph rows, which hold neither a prior retro's action nor an outcome total, and it
// resolves a `widget` key against the seed, which holds no action id.
describe('a namespace cannot be crossed in either direction', () => {
  const stray = (
    summary: string,
    kind: 'issue' | 'widget' | 'retro_action',
    id: string,
  ): RetroDraftContent['proposals'][number] => ({
    category: 'win',
    summary,
    refs: [{ kind, id }],
    confidence: 'medium',
  })

  it('refuses a prior action id, an outcome total and a metric key worn under an ordinary kind', () => {
    const content: RetroDraftContent = {
      proposals: [
        stray('A prior action dressed as this cycle’s issue.', 'issue', 'action-1'),
        stray('An outcome total dressed as an issue.', 'issue', 'prior_retro_shipped'),
        stray('A metric key dressed as an issue.', 'issue', 'time_to_first_review'),
        stray('An issue dressed as a computed number.', 'widget', 'issue-1'),
        stray('A prior action dressed as a computed number.', 'widget', 'action-1'),
        stray('Cites a prior action as itself.', 'retro_action', 'action-1'),
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals.map((p) => p.summary)).toEqual(['Cites a prior action as itself.'])
    // Stored as the win it says it is: citing a prior action no longer re-classifies a proposal.
    expect(result.proposals.map((p) => p.category)).toEqual(['win'])
  })

  it('keeps a proposal whose surviving reference is the one on the right side of the line', () => {
    const content: RetroDraftContent = {
      proposals: [
        {
          category: 'loss',
          summary: 'One real citation beside a crossed one.',
          refs: [
            { kind: 'issue', id: 'prior_retro_shipped' },
            { kind: 'issue', id: 'issue-1' },
          ],
          confidence: 'low',
        },
      ],
    }

    const result = sanitizeRetroDraft(content, KNOWN_WITH_PRIOR, NO_ROSTER, PRIOR)

    expect(result.proposals[0]?.refs).toEqual([{ kind: 'issue', id: 'issue-1' }])
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
    expect(result.proposals.map((p) => p.category)).not.toContain('follow_up')
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
