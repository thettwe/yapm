import { describe, expect, it } from 'vitest'
import {
  contentDisclosesPaths,
  contentNamesMember,
  type DigestContent,
  type DigestItem,
  dropItemsDisclosingPaths,
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

  it('matches needles on word boundaries — a short name never false-blocks common words', () => {
    const withIan = [{ name: 'Ian', email: 'ian@example.test' }]
    const commonWords = content({
      headline: 'The median build time fell and the guardian check stayed green.',
      sections: [
        {
          title: 'What shipped',
          items: [
            {
              kind: 'shipped',
              summary: 'Indian-region latency dropped below the median.',
              evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
              confidence: 'high',
            },
          ],
        },
      ],
    })
    // "median", "guardian", "Indian" all contain "ian" but must NOT flag.
    expect(contentNamesMember(commonWords, withIan)).toBe(false)
    expect(dropItemsNamingMembers(commonWords, withIan).sections[0]?.items).toHaveLength(1)
    // But the actual roster member, on a word boundary, still flags.
    const namesIan = content({ headline: 'Ian shipped guest checkout.' })
    expect(contentNamesMember(namesIan, withIan)).toBe(true)
  })

  it('builds needles from full name and email handle, ignoring empty roster', () => {
    expect(rosterNameNeedles(roster)).toEqual(
      expect.arrayContaining(['alice smith', 'alice.smith', 'bob jones', 'bjones']),
    )
    expect(rosterNameNeedles([])).toEqual([])
    expect(contentNamesMember(content(), [])).toBe(false)
  })
})

describe('disclosure validator — no path, extension, fence or code identifier survives', () => {
  const clean: DigestItem = {
    kind: 'shipped',
    summary: 'Guest checkout went live in Billing.',
    evidenceRefs: [{ kind: 'issue', id: 'issue-1' }],
    confidence: 'high',
  }

  function withSummary(summary: string): DigestContent {
    return content({
      headline: 'The team shipped in Billing and Web.',
      sections: [
        {
          title: 'What shipped',
          items: [
            { ...clean },
            {
              kind: 'highlight',
              summary,
              evidenceRefs: [{ kind: 'issue', id: 'issue-2' }],
              confidence: 'medium',
            },
          ],
        },
      ],
    })
  }

  // The four leak shapes design D6 names.
  const leaks: Record<string, string> = {
    'a slash-bearing path token': 'Reworked apps/server/src/billing to shorten the window.',
    'a source-file extension': 'Reworked refund.ts to shorten the window.',
    'a backtick / code fence': 'Reworked the `refund window` constant.',
    'a code identifier call': 'Reworked session.refresh() so the window shortens.',
  }

  for (const [shape, summary] of Object.entries(leaks)) {
    it(`drops the item disclosing ${shape}, keeping the clean one`, () => {
      const dirty = withSummary(summary)
      expect(contentDisclosesPaths(dirty)).toBe(true)
      const result = dropItemsDisclosingPaths(dirty)
      expect(result.sections[0]?.items).toHaveLength(1)
      expect(result.sections[0]?.items[0]?.summary).toBe(clean.summary)
      expect(contentDisclosesPaths(result)).toBe(false)
      expect(JSON.stringify(result)).not.toContain(summary)
    })
  }

  it('flags a two-slash directory path with no extension at all', () => {
    expect(contentDisclosesPaths(withSummary('Work landed under packages/schema.'))).toBe(true)
    expect(contentDisclosesPaths(withSummary('Work landed under src/billing.'))).toBe(true)
  })

  it('blanks a disclosing headline but keeps the clean items', () => {
    const dirty = content({
      headline: 'The team reworked apps/server/src/billing/refund.ts.',
      sections: [{ title: 'What shipped', items: [{ ...clean }] }],
    })
    const result = dropItemsDisclosingPaths(dirty)
    expect(result.headline).toBe('')
    expect(result.sections[0]?.items).toHaveLength(1)
    expect(contentDisclosesPaths(result)).toBe(false)
  })

  it('drops a section whose TITLE discloses, and removes a section the item drop emptied', () => {
    const dirty = content({
      headline: 'Cycle 8.',
      sections: [
        { title: 'Changes in apps/web/routes', items: [{ ...clean }] },
        {
          title: 'Risks',
          items: [
            {
              kind: 'risk',
              summary: 'Flaky check in .github/workflows/ci.yml.',
              evidenceRefs: [{ kind: 'ci_check', id: 'check-1' }],
              confidence: 'low',
            },
          ],
        },
        { title: 'What shipped', items: [{ ...clean }] },
      ],
    })
    const result = dropItemsDisclosingPaths(dirty)
    expect(result.sections.map((section) => section.title)).toEqual(['What shipped'])
  })

  it('retains ordinary prose that merely contains a slash or a dot', () => {
    const allowlisted = [
      'The CI/CD pipeline stayed green.',
      'I/O wait fell across Billing.',
      'The A/B test in Web concluded.',
      'The and/or filter now parses.',
      'On-call moved to 24/7.',
      'Only 14/30 checks were rerun.',
      'The cycle closed on 2026/07/28.',
      'Latency improved by 2.5 percent.',
      'Version 2.1 of the plan editor shipped.',
    ]
    for (const summary of allowlisted) {
      const candidate = withSummary(summary)
      expect(contentDisclosesPaths(candidate), summary).toBe(false)
      expect(dropItemsDisclosingPaths(candidate).sections[0]?.items, summary).toHaveLength(2)
    }
  })

  it('leaves a fully clean digest byte-identical', () => {
    const cleanContent = content({
      headline: 'The team shipped in Billing and Web.',
      sections: [{ title: 'What shipped', items: [{ ...clean }] }],
    })
    expect(contentDisclosesPaths(cleanContent)).toBe(false)
    expect(dropItemsDisclosingPaths(cleanContent)).toEqual(cleanContent)
  })
})
