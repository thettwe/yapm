import { expect, test } from 'vitest'
import { type MentionCandidate, matchMentions, normalizeMentionText } from './mention-match.js'

function member(name: string, overrides: Partial<MentionCandidate> = {}): MentionCandidate {
  return {
    id: overrides.id ?? name.toLowerCase().replace(/\s+/g, '-'),
    name,
    eligible: true,
    ...overrides,
  }
}

function ids(candidates: readonly MentionCandidate[]): string[] {
  return candidates.map((candidate) => candidate.id)
}

test('an empty query offers every default candidate, alphabetically', () => {
  const list = [member('Zoë Chen'), member('Ada Lovelace'), member('mira patel')]
  expect(ids(matchMentions(list, ''))).toEqual(['ada-lovelace', 'mira-patel', 'zoë-chen'])
})

test('matching ignores case and diacritics in both directions', () => {
  const list = [member('Zoë Chen'), member('Ada Lovelace')]
  expect(ids(matchMentions(list, 'zoe'))).toEqual(['zoë-chen'])
  expect(ids(matchMentions(list, 'ZOË'))).toEqual(['zoë-chen'])
  expect(normalizeMentionText('Ångström')).toBe('angstrom')
})

test('a prefix match ranks above a substring match', () => {
  const list = [member('Ada Lovelace', { id: 'ada' }), member('Lovis Bern', { id: 'lovis' })]
  expect(ids(matchMentions(list, 'lov'))).toEqual(['lovis', 'ada'])
})

test('the email local part matches, and the domain does not', () => {
  const list = [member('Dana Reed', { id: 'dana', email: 'dreed@example.com' })]
  expect(ids(matchMentions(list, 'dreed'))).toEqual(['dana'])
  expect(ids(matchMentions(list, 'example'))).toEqual([])
})

test('a held-back candidate is offered only on a prefix match and always ranks last', () => {
  const list = [
    member('Priya Rao', { id: 'priya' }),
    member('Prakash Admin', { id: 'admin', matchOnly: true }),
  ]

  expect(ids(matchMentions(list, ''))).toEqual(['priya'])
  expect(ids(matchMentions(list, 'pr'))).toEqual(['priya', 'admin'])
  // A substring hit is not enough for somebody held back — `@ash` must not list the workspace.
  expect(ids(matchMentions(list, 'ash'))).toEqual([])
})

test('a team member ranks above an admin-by-role even when the admin matches better', () => {
  const list = [
    member('Admin Al', { id: 'admin', matchOnly: true }),
    member('Alina Novak', { id: 'alina' }),
  ]
  expect(ids(matchMentions(list, 'al'))).toEqual(['alina', 'admin'])
})

test('an ineligible person surfaces on an explicit prefix match, after everyone else', () => {
  const list = [
    member('Casey Stone', { id: 'casey', eligible: false, reason: 'Not on this team' }),
    member('Cara Diaz', { id: 'cara' }),
    member('Admin Cal', { id: 'admin', matchOnly: true }),
  ]

  expect(ids(matchMentions(list, ''))).toEqual(['cara'])
  expect(ids(matchMentions(list, 'ca'))).toEqual(['cara', 'admin', 'casey'])
})

test('the tiebreak is stable when two people share a display name', () => {
  const list = [member('Sam Ray', { id: 'user-b' }), member('Sam Ray', { id: 'user-a' })]
  const forwards = ids(matchMentions(list, 'sam'))
  const backwards = ids(matchMentions([...list].reverse(), 'sam'))
  expect(forwards).toEqual(['user-a', 'user-b'])
  expect(backwards).toEqual(forwards)
})

test('a duplicated id is offered once, first occurrence winning', () => {
  const list = [
    member('Ada Lovelace', { id: 'ada' }),
    member('Ada L.', { id: 'ada', matchOnly: true }),
  ]
  const result = matchMentions(list, '')
  expect(result).toHaveLength(1)
  expect(result[0]?.name).toBe('Ada Lovelace')
})

test('surrounding whitespace in the query is ignored', () => {
  expect(ids(matchMentions([member('Ada Lovelace', { id: 'ada' })], '  ada '))).toEqual(['ada'])
})
