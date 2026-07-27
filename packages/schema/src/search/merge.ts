import { type SearchTextFields, type SearchTier, scoreSearchText, searchTierRank } from './score.js'

// The on-device cap. Not a page size — there is no pagination on this pass — but the ceiling on how
// much work the keystroke does and how much the surface can render. The palette shows ~5 per group
// and the route shows the whole list; both read the same bound so neither can quietly raise it.
export const LOCAL_RESULT_LIMIT = 200

// Every entity the on-device pass can reach, and nothing else. Issues come from two synced queries
// (`issues.byTeam` filters triage out, `triage.inbox` is where those rows live), which is exactly
// why dedupe is a requirement rather than a nicety.
export const LOCAL_SEARCH_KINDS = ['issue', 'project', 'cycle', 'label', 'team'] as const

export type LocalSearchKind = (typeof LOCAL_SEARCH_KINDS)[number]

export interface LocalSearchCandidate extends SearchTextFields {
  readonly kind: LocalSearchKind
  readonly id: string
  // Milliseconds. The ONLY tiebreak inside a tier; see `compareLocalResults`.
  readonly updatedAt: number
}

export interface LocalSearchResult {
  readonly candidate: LocalSearchCandidate
  readonly tier: SearchTier
}

function identity(candidate: LocalSearchCandidate): string {
  return `${candidate.kind}:${candidate.id}`
}

// Tier first, then `updatedAt` descending, and nothing else. Ties beyond that are left to the
// sort's stability, which resolves them by the caller's source order — a stable declaration order
// is the whole reason the palette can take filtering away from `cmdk` and still be deterministic.
export function compareLocalResults(a: LocalSearchResult, b: LocalSearchResult): number {
  const byTier = searchTierRank(a.tier) - searchTierRank(b.tier)
  if (byTier !== 0) return byTier
  return b.candidate.updatedAt - a.candidate.updatedAt
}

// Merge, dedupe, rank, cap. Sources are consumed in order and the FIRST occurrence of an identity
// wins, so an issue reached through both `issues.byTeam` and `triage.inbox` appears once and always
// from the same source.
export function mergeLocalCandidates(
  sources: readonly (readonly LocalSearchCandidate[])[],
  query: string,
  limit: number = LOCAL_RESULT_LIMIT,
): LocalSearchResult[] {
  const seen = new Set<string>()
  const results: LocalSearchResult[] = []

  for (const source of sources) {
    for (const candidate of source) {
      const key = identity(candidate)
      if (seen.has(key)) continue
      seen.add(key)
      const tier = scoreSearchText(candidate, query)
      if (tier === undefined) continue
      results.push({ candidate, tier })
    }
  }

  results.sort(compareLocalResults)
  return limit >= 0 && results.length > limit ? results.slice(0, limit) : results
}
