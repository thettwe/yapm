// Query normalisation, shared by both passes.
//
// `MIN_SERVER_QUERY_LENGTH` lives here and nowhere else. The client hook decides whether to issue a
// request and the route decides whether to touch the index; if those two numbers ever drift apart,
// one of them starts lying — either a query the client suppressed would have matched, or a request
// the route refuses is issued on every keystroke. One constant, two importers.

export const MIN_SERVER_QUERY_LENGTH = 2

const WHITESPACE_RUN = /\s+/u
const WHITESPACE_CHAR = /\s/u

// Trimmed and lowercased, matching `matchesText`'s needle exactly (`zero/filter.ts`), so the list
// filter and the search ladder normalise a query the same way.
export function normalizeQuery(raw: string): string {
  return raw.trim().toLowerCase()
}

// Lowercased tokens in query order, whitespace removed. The server pass hands the raw query to
// `websearch_to_tsquery`, which does its own parsing; these tokens are the on-device vocabulary.
export function tokenizeQuery(raw: string): string[] {
  const normalized = normalizeQuery(raw)
  if (normalized.length === 0) return []
  return normalized.split(WHITESPACE_RUN).filter((token) => token.length > 0)
}

// Counted in CODE POINTS over the raw query, not code units and not the lowercased form. Case
// folding can change a string's length (`İ` lowercases to two characters), and a length threshold
// that moves when you lowercase is a threshold two callers can disagree about. Code points rather
// than code units so a two-character query in a script outside the BMP is not silently a
// four-character one.
export function queryLength(raw: string): number {
  let length = 0
  for (const char of raw) {
    if (!WHITESPACE_CHAR.test(char)) length += 1
  }
  return length
}

// The single rule for "is this query worth a round trip". Never a judgement about whether anything
// would have matched — that would make the state an oracle over the corpus.
export function isServerSearchable(raw: string): boolean {
  return queryLength(raw) >= MIN_SERVER_QUERY_LENGTH
}
