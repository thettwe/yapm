import { describe, expect, it } from 'vitest'
import {
  capRetroProposals,
  type RetroDraftContent,
  rankRetroProposals,
  retroDraftContentSchema,
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

    expect(sanitizeRetroDraft(empty, KNOWN, NO_ROSTER).proposals).toEqual([])
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

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER)

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

    expect(sanitizeRetroDraft(content, KNOWN, NO_ROSTER).proposals).toHaveLength(1)
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

    const result = sanitizeRetroDraft(content, KNOWN, roster)

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

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER)

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

    const result = sanitizeRetroDraft(content, KNOWN, NO_ROSTER)

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
