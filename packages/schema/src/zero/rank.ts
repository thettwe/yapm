import { BASE_62_DIGITS, generateKeyBetween, generateNKeysBetween } from 'fractional-indexing'

// A fractional-index rank orders cards within a board column. One string key can always be
// minted between two neighbours, so a move writes exactly one row and DB order is plain
// `ORDER BY rank`. BASE_62 (0-9A-Za-z) is used everywhere — client optimistic mint, backfill,
// and any server use — because mixing alphabets within a column corrupts the ordering. The
// column is stored `text COLLATE "C"` so Postgres byte-order matches JS string order.

// Mint a rank between two neighbours (either bound may be null for start/end of the column).
// Computed at the mutator call site and passed to `issue.move`, never inside the mutator
// (which re-runs on rebase, where recomputing from shifted neighbours would jump the card).
export function rankBetween(a: string | null, b: string | null): string {
  return generateKeyBetween(a, b, BASE_62_DIGITS)
}

// Mint `n` evenly-spaced ranks for an initial ordered fill (the migration backfill and an
// empty column). Returns [] for n <= 0.
export function initialRanks(n: number): string[] {
  if (n <= 0) return []
  return generateNKeysBetween(null, null, n, BASE_62_DIGITS)
}
