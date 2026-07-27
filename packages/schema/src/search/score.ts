import { normalizeQuery } from './tokenize.js'

// The on-device tier ladder. It EXTENDS `matchesText` (`zero/filter.ts`) rather than forking it:
// `matchesSearchText` is exactly the predicate the issue list's text filter has always applied, and
// the list now delegates to it, so "matches" means one thing in the list and in the palette.
//
// The four tiers the maintainer specified are in the stated order. `issue-key-partial` is appended
// BELOW them, not inserted among them: `matchesText` matched a SUBSTRING of the issue key, so
// dropping that would silently narrow the list filter, and ranking it above a title hit would put
// every issue whose key contains the letter you just typed at the top. Appending it keeps the
// predicate identical to today's and leaves the specified ordering untouched.
export const SEARCH_TIERS = [
  'issue-key',
  'title-prefix',
  'title-substring',
  'body-substring',
  'issue-key-partial',
] as const

export type SearchTier = (typeof SEARCH_TIERS)[number]

// The text a candidate offers the ladder. `body` is the plaintext projection of a rich-text
// document (`rich-text/plaintext.ts`), never the document JSON — which is also why a mention is
// findable by the person's name rather than by a node's attribute soup.
export interface SearchTextFields {
  readonly title: string
  readonly body?: string | null
  readonly number?: number | null
  readonly teamKey?: string | null
}

// `ENG-12` when the team key is known, otherwise the bare number — the same construction
// `matchesText` uses, so the two agree about what an issue's searchable key is.
export function issueKeyOf(
  number: number | null | undefined,
  teamKey?: string | null,
): string | undefined {
  if (number == null) return undefined
  return teamKey ? `${teamKey}-${number}` : String(number)
}

export function searchTierRank(tier: SearchTier): number {
  return SEARCH_TIERS.indexOf(tier)
}

// The best tier a candidate reaches, or `undefined` when it does not match at all. An empty query
// matches NOTHING here: an unranked "everything" is the filter's meaning of a blank text axis, not
// search's, and the filter keeps that behaviour at its own call site.
export function scoreSearchText(fields: SearchTextFields, query: string): SearchTier | undefined {
  const needle = normalizeQuery(query)
  if (needle.length === 0) return undefined

  const key = issueKeyOf(fields.number, fields.teamKey)?.toLowerCase()
  if (key !== undefined && key === needle) return 'issue-key'

  const title = fields.title.toLowerCase()
  if (title.startsWith(needle)) return 'title-prefix'
  if (title.includes(needle)) return 'title-substring'

  const body = fields.body?.toLowerCase()
  if (body !== undefined && body.length > 0 && body.includes(needle)) return 'body-substring'

  if (key?.includes(needle)) return 'issue-key-partial'

  return undefined
}

// `matchesText`'s predicate, now owned here. Deliberately defined AS the ladder so the two can
// never diverge: anything the ladder ranks matches, and anything that matches has a tier.
export function matchesSearchText(fields: SearchTextFields, query: string): boolean {
  return scoreSearchText(fields, query) !== undefined
}
