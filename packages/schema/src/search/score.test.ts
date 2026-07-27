import { describe, expect, it } from 'vitest'
import { issueKeyOf, matchesSearchText, SEARCH_TIERS, scoreSearchText } from './score.js'

const ISSUE = {
  title: 'Ship the reconnect fix',
  body: 'Blocked on @Lovisa Berg, who owns the socket teardown.',
  number: 12,
  teamKey: 'ENG',
}

describe('the tier ladder', () => {
  it('keeps the specified order, with the key-substring tier appended below it', () => {
    expect(SEARCH_TIERS).toEqual([
      'issue-key',
      'title-prefix',
      'title-substring',
      'body-substring',
      'issue-key-partial',
      'abbreviation',
    ])
  })

  it('ranks an exact issue key first, with or without the team prefix', () => {
    expect(scoreSearchText(ISSUE, 'ENG-12')).toBe('issue-key')
    expect(scoreSearchText(ISSUE, 'eng-12')).toBe('issue-key')
    expect(scoreSearchText({ ...ISSUE, teamKey: undefined }, '12')).toBe('issue-key')
  })

  it('ranks a title prefix above a title substring', () => {
    expect(scoreSearchText(ISSUE, 'ship')).toBe('title-prefix')
    expect(scoreSearchText(ISSUE, 'reconnect')).toBe('title-substring')
  })

  it('ranks body text below every title hit', () => {
    expect(scoreSearchText(ISSUE, 'teardown')).toBe('body-substring')
  })

  // The `@lov` case: the plaintext projection renders a mention as `@` plus the person's name, so
  // typing the start of a colleague's name finds what they were mentioned on. Word-start needs no
  // tier of its own — substring already reaches it, and the `@` is what makes it unambiguous.
  it('finds a mention by the start of the mentioned person name', () => {
    expect(scoreSearchText(ISSUE, '@lov')).toBe('body-substring')
    expect(scoreSearchText(ISSUE, 'lovisa')).toBe('body-substring')
  })

  it('ranks a partial issue key last, preserving the list filter predicate', () => {
    expect(scoreSearchText(ISSUE, 'ng-1')).toBe('issue-key-partial')
  })

  // The reach `cmdk`'s scorer used to provide, kept when the palette took filtering off it (D8).
  it('ranks a word-boundary abbreviation last, below every literal hit', () => {
    expect(scoreSearchText(ISSUE, 'strf')).toBe('abbreviation')
    expect(scoreSearchText(ISSUE, 'eng12')).toBe('abbreviation')
    expect(scoreSearchText({ title: 'Change status' }, 'cs')).toBe('abbreviation')
    expect(scoreSearchText({ title: 'Go to inbox notifications' }, 'gti')).toBe('abbreviation')
  })

  // A plain character subsequence would match this, and an unranked list filter that matches it
  // feels broken. The needle has to be spellable as successive WORD PREFIXES.
  it('does not treat scattered characters as an abbreviation', () => {
    expect(scoreSearchText({ title: 'Landing page for the org' }, 'log')).toBeUndefined()
    expect(scoreSearchText(ISSUE, 'stx')).toBeUndefined()
  })

  it('does not match a blank query', () => {
    expect(scoreSearchText(ISSUE, '')).toBeUndefined()
    expect(scoreSearchText(ISSUE, '   ')).toBeUndefined()
  })

  it('does not match text that appears nowhere', () => {
    expect(scoreSearchText(ISSUE, 'qzt-echo')).toBeUndefined()
  })

  it('treats a missing body as no body rather than as a match', () => {
    expect(scoreSearchText({ title: 'Ship it', number: null }, 'teardown')).toBeUndefined()
    expect(scoreSearchText({ title: 'Ship it', body: null, number: null }, 'ship')).toBe(
      'title-prefix',
    )
  })
})

describe('matchesSearchText', () => {
  it('is exactly the ladder, so the predicate and the ranking cannot diverge', () => {
    for (const query of ['ENG-12', 'ship', 'reconnect', 'teardown', 'ng-1', 'nope', '']) {
      expect(matchesSearchText(ISSUE, query)).toBe(scoreSearchText(ISSUE, query) !== undefined)
    }
  })
})

describe('issueKeyOf', () => {
  it('builds the team-prefixed key, or the bare number without a team key', () => {
    expect(issueKeyOf(12, 'ENG')).toBe('ENG-12')
    expect(issueKeyOf(12)).toBe('12')
  })

  it('has no key for an issue that has not been numbered yet', () => {
    expect(issueKeyOf(null, 'ENG')).toBeUndefined()
    expect(issueKeyOf(undefined, 'ENG')).toBeUndefined()
  })
})
