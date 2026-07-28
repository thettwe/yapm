import { describe, expect, it } from 'vitest'
import {
  type AiArtifact,
  aiArtifactNamesMember,
  dropAiItemsNamingMembers,
  dropUncitedAiItems,
  rosterNameNeedles,
} from './ai-content.js'

// Deliberately NOT a `DigestContent`: two groups, a null headline and null headings, and a `widget`
// ref kind the digest schema does not know. The point of the shared walker is that it holds for a
// shape the digest never had.
function artifact(): AiArtifact {
  return {
    headline: null,
    groups: [
      {
        heading: null,
        items: [
          {
            summary: 'Review wait dominated lead time.',
            refs: [
              { kind: 'widget', id: 'time_to_first_review' },
              { kind: 'issue', id: 'issue-hallucinated' },
            ],
          },
          {
            summary: 'A claim resting on nothing real.',
            refs: [{ kind: 'issue', id: 'issue-invented' }],
          },
        ],
      },
      {
        heading: null,
        items: [
          {
            summary: 'CI stayed green all cycle.',
            refs: [{ kind: 'ci_check', id: 'check-1' }],
          },
        ],
      },
    ],
  }
}

const KNOWN = new Set(['time_to_first_review', 'check-1'])

describe('dropUncitedAiItems', () => {
  it('narrows refs to the known set and drops an item left with none', () => {
    const result = dropUncitedAiItems(artifact(), KNOWN)

    expect(result.groups).toHaveLength(2)
    expect(result.groups[0]?.items).toHaveLength(1)
    expect(result.groups[0]?.items[0]?.refs).toEqual([
      { kind: 'widget', id: 'time_to_first_review' },
    ])
    expect(result.groups[1]?.items[0]?.summary).toBe('CI stayed green all cycle.')
  })

  it('removes a group emptied by the drop', () => {
    const result = dropUncitedAiItems(artifact(), new Set(['check-1']))

    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.items[0]?.refs).toEqual([{ kind: 'ci_check', id: 'check-1' }])
  })

  it('drops uncited items even with no known-id set', () => {
    const uncited: AiArtifact = {
      headline: null,
      groups: [{ heading: null, items: [{ summary: 'Nothing to point at.', refs: [] }] }],
    }

    expect(dropUncitedAiItems(uncited).groups).toEqual([])
  })
})

describe('the name walkers', () => {
  const roster = [{ name: 'Ada Lovelace', email: 'ada@example.com' }]

  it('drops the item naming a member and leaves its siblings', () => {
    const named: AiArtifact = {
      headline: null,
      groups: [
        {
          heading: null,
          items: [
            {
              summary: 'Ada Lovelace unblocked the release.',
              refs: [{ kind: 'issue', id: 'i-1' }],
            },
            { summary: 'The release shipped on time.', refs: [{ kind: 'issue', id: 'i-2' }] },
          ],
        },
      ],
    }

    expect(aiArtifactNamesMember(named, roster)).toBe(true)
    const result = dropAiItemsNamingMembers(named, roster)
    expect(result.groups[0]?.items).toHaveLength(1)
    expect(result.groups[0]?.items[0]?.summary).toBe('The release shipped on time.')
    expect(aiArtifactNamesMember(result, roster)).toBe(false)
  })

  it('drops a whole group whose heading names a member', () => {
    const named: AiArtifact = {
      headline: null,
      groups: [
        {
          heading: "ada's wins",
          items: [{ summary: 'Something clean.', refs: [{ kind: 'issue', id: 'i-1' }] }],
        },
        {
          heading: 'Losses',
          items: [{ summary: 'Something else clean.', refs: [{ kind: 'issue', id: 'i-2' }] }],
        },
      ],
    }

    expect(aiArtifactNamesMember(named, roster)).toBe(true)
    const result = dropAiItemsNamingMembers(named, roster)
    expect(result.groups).toHaveLength(1)
    expect(result.groups[0]?.heading).toBe('Losses')
  })

  it('matches a needle on a word boundary and never on a substring', () => {
    const withIan = [{ name: 'Ian', email: 'ian@example.com' }]
    const commonWords: AiArtifact = {
      headline: null,
      groups: [
        {
          heading: null,
          items: [
            {
              summary: 'The median guardian job ran once.',
              refs: [{ kind: 'ci_check', id: 'c-1' }],
            },
          ],
        },
      ],
    }

    expect(aiArtifactNamesMember(commonWords, withIan)).toBe(false)

    const namesIan: AiArtifact = {
      headline: null,
      groups: [
        {
          heading: null,
          items: [{ summary: 'Ian reviewed it.', refs: [{ kind: 'ci_check', id: 'c-1' }] }],
        },
      ],
    }
    expect(aiArtifactNamesMember(namesIan, withIan)).toBe(true)
  })

  it('blanks a headline that names a member rather than rejecting the artifact', () => {
    const named: AiArtifact = {
      headline: 'Ada Lovelace carried the cycle',
      groups: [
        {
          heading: null,
          items: [{ summary: 'The release shipped.', refs: [{ kind: 'issue', id: 'i-1' }] }],
        },
      ],
    }

    const result = dropAiItemsNamingMembers(named, roster)
    expect(result.headline).toBe('')
    expect(result.groups[0]?.items).toHaveLength(1)
  })

  it('short-circuits on an empty roster', () => {
    const input = artifact()

    expect(rosterNameNeedles([])).toEqual([])
    expect(aiArtifactNamesMember(input, [])).toBe(false)
    expect(dropAiItemsNamingMembers(input, [])).toBe(input)
  })

  it('builds needles from the full name and the email handle', () => {
    expect(rosterNameNeedles(roster)).toEqual(expect.arrayContaining(['ada lovelace', 'ada']))
  })
})
