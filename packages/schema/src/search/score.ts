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
// `abbreviation` is appended below `issue-key-partial` for the same reason `issue-key-partial` was
// appended below the four: dropping it would silently NARROW what already matched. The palette used
// to hand `cmdk` its rows, and `cmdk` scores a fuzzy subsequence — so `cs` reached "Change status"
// and `eng12` reached `ENG-12`. Taking filtering off `cmdk` (D8) has to keep the reach it replaced.
export const SEARCH_TIERS = [
  'issue-key',
  'title-prefix',
  'title-substring',
  'body-substring',
  'issue-key-partial',
  'abbreviation',
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

const NON_WORD = /[^\p{L}\p{N}]+/u

/**
 * A WORD-BOUNDARY subsequence: the needle has to be spellable as a run of successive word prefixes.
 * `cs` reaches "change status", `gti` reaches "go to inbox" and `eng12` reaches `ENG-12`, while
 * `log` does NOT reach "Landing page for the org" — a plain character subsequence would, and that
 * looseness is what makes an unranked list filter feel broken.
 *
 * Deliberately over the title and the issue key only. A subsequence over a two-thousand-character
 * body would match almost any query, and the body already has a tier of its own.
 */
function matchesAbbreviation(haystack: string, compact: string): boolean {
  const words = haystack.split(NON_WORD).filter((word) => word.length > 0)
  if (words.length === 0) return false

  // Memoised on the (word, needle position) pair, so the walk is linear in their product rather
  // than exponential in the backtracking.
  const exhausted = new Set<number>()
  const stride = compact.length + 1

  const walk = (wordIndex: number, needleIndex: number): boolean => {
    if (needleIndex === compact.length) return true
    if (wordIndex >= words.length) return false
    const state = wordIndex * stride + needleIndex
    if (exhausted.has(state)) return false
    if (walk(wordIndex + 1, needleIndex)) return true

    const word = words[wordIndex] ?? ''
    const reach = Math.min(word.length, compact.length - needleIndex)
    for (let taken = 1; taken <= reach; taken += 1) {
      if (word[taken - 1] !== compact[needleIndex + taken - 1]) break
      if (walk(wordIndex + 1, needleIndex + taken)) return true
    }
    exhausted.add(state)
    return false
  }

  return walk(0, 0)
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

  // Last, and only for a needle worth abbreviating: a single character is already covered by the
  // substring tiers, and treating it as an abbreviation would match nearly every row.
  const compact = needle.replace(/[^\p{L}\p{N}]+/gu, '')
  if (compact.length >= 2) {
    if (matchesAbbreviation(title, compact)) return 'abbreviation'
    if (key !== undefined && matchesAbbreviation(key, compact)) return 'abbreviation'
  }

  return undefined
}

// `matchesText`'s predicate, now owned here. Deliberately defined AS the ladder so the two can
// never diverge: anything the ladder ranks matches, and anything that matches has a tier.
export function matchesSearchText(fields: SearchTextFields, query: string): boolean {
  return scoreSearchText(fields, query) !== undefined
}
