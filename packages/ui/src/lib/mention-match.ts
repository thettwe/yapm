/**
 * One person the mention typeahead may offer.
 *
 * Deliberately data-agnostic: `packages/ui` knows nothing about teams, queries or permissions, so
 * the consuming application decides who is eligible, why someone is not, and who is held back
 * until the query names them.
 */
export interface MentionCandidate {
  id: string
  name: string
  email?: string | undefined
  image?: string | null | undefined
  /** False when a mention of this person cannot be delivered on this document. */
  eligible: boolean
  /** Why they cannot be mentioned. Rendered on the disabled row and announced. */
  reason?: string | undefined
  /**
   * Held back from the unfiltered list and ranked after every default candidate: offered only
   * when the typed query PREFIX-matches. The application uses this for people who genuinely can
   * be mentioned but should not pad a team's `@` list — a workspace admin who is not on the team.
   * It is spelled as a list behaviour rather than as a role so this module stays ignorant of
   * permissions.
   */
  matchOnly?: boolean | undefined
}

// Case- and diacritic-insensitive. NFD splits a precomposed letter into base + combining mark and
// the mark is then dropped, so `Zoë` matches `zoe`. Letters that carry no combining form (`ø`,
// `ł`) do not decompose and keep their own identity — matching them needs their own character,
// which is the honest behaviour rather than a hand-rolled transliteration table.
export function normalizeMentionText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function emailLocalPart(email: string | undefined): string {
  if (email === undefined) return ''
  const at = email.indexOf('@')
  return at === -1 ? email : email.slice(0, at)
}

// How well the query hit, best first. A hit at the start of the whole name or of the email local
// part beats one at the start of a later word, which beats one buried mid-word.
const TIER_PREFIX = 0
const TIER_WORD_PREFIX = 1
const TIER_SUBSTRING = 2

// Who gets offered at all, best first. A candidate offered by default beats one held back; an
// ineligible person comes last, because they are shown to explain themselves rather than be picked.
const GROUP_DEFAULT = 0
const GROUP_HELD_BACK = 1
const GROUP_INELIGIBLE = 2

const GROUP_WEIGHT = 10

interface Ranked {
  candidate: MentionCandidate
  rank: number
  name: string
}

function tokensOf(name: string, local: string): string[] {
  return `${name} ${local}`.split(/[\s._+-]+/u).filter((token) => token !== '')
}

function hitTier(name: string, local: string, needle: string): number | null {
  if (name.startsWith(needle) || (local !== '' && local.startsWith(needle))) return TIER_PREFIX
  if (tokensOf(name, local).some((token) => token.startsWith(needle))) return TIER_WORD_PREFIX
  if (name.includes(needle) || (local !== '' && local.includes(needle))) return TIER_SUBSTRING
  return null
}

// Deterministic and locale-independent: `localeCompare` varies with the host ICU data, and a
// typeahead whose order depends on where it runs cannot be unit-tested. Ties on the normalized
// name fall through to the id, so two people with the same display name still have one order.
function compareRanked(a: Ranked, b: Ranked): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  if (a.candidate.id === b.candidate.id) return 0
  return a.candidate.id < b.candidate.id ? -1 : 1
}

/**
 * The whole sub-100ms story: a synchronous filter over rows the sync engine has already
 * replicated. No promise, no network, no debounce.
 */
export function matchMentions(
  candidates: readonly MentionCandidate[],
  query: string,
): MentionCandidate[] {
  const needle = normalizeMentionText(query.trim())
  const seen = new Set<string>()
  const ranked: Ranked[] = []

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue
    seen.add(candidate.id)

    const name = normalizeMentionText(candidate.name)
    const local = normalizeMentionText(emailLocalPart(candidate.email))
    const offeredByDefault = candidate.eligible && candidate.matchOnly !== true

    if (needle.length === 0) {
      if (offeredByDefault) ranked.push({ candidate, rank: TIER_PREFIX, name })
      continue
    }

    const tier = hitTier(name, local, needle)
    if (tier === null) continue

    if (offeredByDefault) {
      ranked.push({ candidate, rank: GROUP_DEFAULT * GROUP_WEIGHT + tier, name })
      continue
    }

    // Held back: a mid-word hit is not enough. Surfacing an off-team admin or an ineligible
    // colleague on a loose match would make every `@a` list the whole workspace.
    if (tier === TIER_SUBSTRING) continue
    ranked.push({
      candidate,
      rank: (candidate.eligible ? GROUP_HELD_BACK : GROUP_INELIGIBLE) * GROUP_WEIGHT + tier,
      name,
    })
  }

  ranked.sort(compareRanked)
  return ranked.map((entry) => entry.candidate)
}
