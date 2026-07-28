// The ONE shape-agnostic view every AI artifact is validated through, and the ONE implementation of
// the two injection-critical walkers. Pure — no DB, no SDK, no UI import.
//
// `digest.ts` shipped these walkers typed to `DigestContent` exactly. A second artifact (the retro
// draft) has a different shape, and a second copy of a name-validator is a second place for the
// blameless guarantee to rot. So the walkers move here, over a normalized view, and every artifact
// supplies a pair of adapters onto it. The word-boundary matching, the needle length thresholds and
// the headline-blanking behaviour are carried over VERBATIM from `digest.ts` — this was a re-typing,
// not a re-decision.
//
// The standing rule, enforced by `scripts/check-boundaries.mjs` rule 4: there is exactly one
// `rosterNameNeedles` and exactly one word-boundary member-name walker under `packages/schema/src`,
// and they are here.

export interface AiArtifactRef {
  readonly kind: string
  readonly id: string
  readonly label?: string
}

export interface AiArtifactItem {
  readonly summary: string
  readonly refs: readonly AiArtifactRef[]
}

// `heading` is null for an artifact whose grouping is supplied by yapm rather than the model (the
// retro draft's categories), and a string for one the model titled (the digest's sections).
export interface AiArtifactGroup {
  readonly heading: string | null
  readonly items: readonly AiArtifactItem[]
}

export interface AiArtifact {
  readonly headline: string | null
  readonly groups: readonly AiArtifactGroup[]
}

// Cite-evidence-or-omit. Drops any item whose `refs` is empty; when a `knownIds` set is supplied
// (the ids yapm computed), each ref is first narrowed to that set so a hallucinated/invented id
// cannot survive, then the item is dropped if nothing real remains. A group left with no items is
// removed. Deterministic and pure.
export function dropUncitedAiItems(
  artifact: AiArtifact,
  knownIds?: ReadonlySet<string>,
): AiArtifact {
  const groups = artifact.groups
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) =>
          knownIds ? { ...item, refs: item.refs.filter((ref) => knownIds.has(ref.id)) } : item,
        )
        .filter((item) => item.refs.length > 0),
    }))
    .filter((group) => group.items.length > 0)
  return { ...artifact, groups }
}

// A workspace member as the name-validator needs them: the display name and/or email. No other
// field is consulted — the roster is the ONLY identity data anywhere near the pipeline (it never
// reaches the model; it is the after-the-fact backstop).
export interface RosterMember {
  readonly name?: string | null
  readonly email?: string | null
}

// The set of case-normalized needles an artifact must not contain: each member's full display name
// and their email local-part (handle). Kept to the exact roster strings (not fuzzy tokens) so
// common first names in prose never trigger a false block, per the design's matching strategy.
export function rosterNameNeedles(roster: readonly RosterMember[]): string[] {
  const needles = new Set<string>()
  for (const member of roster) {
    const name = member.name?.trim().toLowerCase()
    if (name && name.length >= 2) needles.add(name)
    const email = member.email?.trim().toLowerCase()
    if (email) {
      const handle = email.split('@')[0]
      if (handle && handle.length >= 3) needles.add(handle)
    }
  }
  return [...needles]
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match each needle on WORD BOUNDARIES, not raw substring: a member/handle like `ian` must flag
// "Ian shipped X" but never false-block common words such as "median" or "guardian". This is the
// "exact needle, never false-block on common words" behavior design.md decision 131 promises.
function textNamesMember(text: string | null, needles: readonly string[]): boolean {
  if (text === null) return false
  if (needles.length === 0) return false
  return needles.some((needle) => new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(text))
}

// The deterministic name-validator backstop: true when any headline/heading/item text names a
// workspace member. Even a fully injected model cannot name a person (the identity dimension is
// never in its context), but this rejects the output before it is shown as defense in depth.
export function aiArtifactNamesMember(
  artifact: AiArtifact,
  roster: readonly RosterMember[],
): boolean {
  const needles = rosterNameNeedles(roster)
  if (needles.length === 0) return false
  if (textNamesMember(artifact.headline, needles)) return true
  return artifact.groups.some(
    (group) =>
      textNamesMember(group.heading, needles) ||
      group.items.some((item) => textNamesMember(item.summary, needles)),
  )
}

// The applied backstop: drop any item that names a member (and blank the headline if it does), so a
// single bad line never blocks the rest of an otherwise-clean artifact. Groups emptied by the drop
// are removed. Pure.
export function dropAiItemsNamingMembers(
  artifact: AiArtifact,
  roster: readonly RosterMember[],
): AiArtifact {
  const needles = rosterNameNeedles(roster)
  if (needles.length === 0) return artifact
  const groups = artifact.groups
    .filter((group) => !textNamesMember(group.heading, needles))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !textNamesMember(item.summary, needles)),
    }))
    .filter((group) => group.items.length > 0)
  return {
    headline: textNamesMember(artifact.headline, needles) ? '' : artifact.headline,
    groups,
  }
}
