import { describe, expect, it } from 'vitest'
import {
  contentNamesMember,
  type DigestContent,
  dropItemsNamingMembers,
  dropUncitedItems,
  rosterNameNeedles,
} from './digest.js'

function content(overrides: Partial<DigestContent> = {}): DigestContent {
  return {
    headline: 'The team shipped guest checkout and cut the refund window.',
    sections: [
      {
        title: 'What shipped',
        items: [
          {
            kind: 'shipped',
            summary: 'Guest checkout went live.',
            evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
            confidence: 'high',
          },
          {
            kind: 'highlight',
            summary: 'An uncited claim the model invented.',
            evidenceRefs: [],
            confidence: 'low',
          },
        ],
      },
    ],
    ...overrides,
  }
}

describe('dropUncitedItems — cite-evidence-or-omit', () => {
  it('drops any item with no evidence ref but keeps cited ones', () => {
    const result = dropUncitedItems(content())
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.items).toHaveLength(1)
    expect(result.sections[0]?.items[0]?.summary).toBe('Guest checkout went live.')
  })

  it('narrows refs to the known-evidence set, dropping invented ids, then omits emptied items', () => {
    const withInvented = content({
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Cites a real and an invented id.',
              evidenceRefs: [
                { kind: 'issue', id: 'issue-1' },
                { kind: 'pull_request', id: 'hallucinated-99' },
              ],
              confidence: 'high',
            },
            {
              kind: 'risk',
              summary: 'Cites only an invented id.',
              evidenceRefs: [{ kind: 'issue', id: 'not-real' }],
              confidence: 'medium',
            },
          ],
        },
      ],
    })
    const known = new Set(['issue-1', 'pr-1'])
    const result = dropUncitedItems(withInvented, known)
    expect(result.sections[0]?.items).toHaveLength(1)
    expect(result.sections[0]?.items[0]?.evidenceRefs).toEqual([{ kind: 'issue', id: 'issue-1' }])
  })

  it('removes a section left with no items', () => {
    const allUncited = content({
      sections: [
        {
          title: 'Empty',
          items: [{ kind: 'risk', summary: 'x', evidenceRefs: [], confidence: 'low' }],
        },
      ],
    })
    expect(dropUncitedItems(allUncited).sections).toHaveLength(0)
  })
})

describe('name-validator — team-level / blameless backstop', () => {
  const roster = [
    { name: 'Alice Smith', email: 'alice.smith@example.test' },
    { name: 'Bob Jones', email: 'bjones@example.test' },
  ]

  it('flags output naming a roster member by full name', () => {
    const named = content({
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Alice Smith fixed the checkout bug.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    expect(contentNamesMember(named, roster)).toBe(true)
  })

  it('flags output naming a member by email handle', () => {
    const named = content({
      headline: 'bjones led the billing change.',
    })
    expect(contentNamesMember(named, roster)).toBe(true)
  })

  it('passes clean team-level output naming no member', () => {
    expect(contentNamesMember(content(), roster)).toBe(false)
  })

  it('flags and drops a section whose TITLE names a roster member', () => {
    const namedTitle = content({
      sections: [
        {
          title: 'Alice Smith highlights',
          items: [
            {
              kind: 'shipped',
              summary: 'Guest checkout went live.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
              confidence: 'high',
            },
          ],
        },
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Refund window cut to seven days.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-2' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    expect(contentNamesMember(namedTitle, roster)).toBe(true)
    const result = dropItemsNamingMembers(namedTitle, roster)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]?.title).toBe('What shipped')
    expect(contentNamesMember(result, roster)).toBe(false)
  })

  it('drops the offending item and blanks a naming headline, keeping clean content', () => {
    const named = content({
      headline: 'Alice Smith drove this cycle.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Alice Smith fixed the checkout bug.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
              confidence: 'high',
            },
            {
              kind: 'shipped',
              summary: 'Guest checkout went live.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-2' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    const result = dropItemsNamingMembers(named, roster)
    expect(result.headline).toBe('')
    expect(result.sections[0]?.items).toHaveLength(1)
    expect(result.sections[0]?.items[0]?.summary).toBe('Guest checkout went live.')
    expect(contentNamesMember(result, roster)).toBe(false)
  })

  it('builds needles from full name and email handle, ignoring empty roster', () => {
    expect(rosterNameNeedles(roster)).toEqual(
      expect.arrayContaining(['alice smith', 'alice.smith', 'bob jones', 'bjones']),
    )
    expect(rosterNameNeedles([])).toEqual([])
    expect(contentNamesMember(content(), [])).toBe(false)
  })
})
