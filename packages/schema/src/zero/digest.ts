import * as z from 'zod'

// The substrate's TYPED structured-output contract + its deterministic validators. Pure — no SDK,
// DB, or UI import. The gateway (`apps/server`) asks the model to emit exactly a `DigestContent`
// via `generateObject`; the validators then enforce the injection-architecture guarantees
// (cite-evidence-or-omit, team-level/blameless) BEFORE anything is stored or shown. Because the
// output is schema-typed, these are enforceable as code, not as a prompt request.

// A digest item links the exact work-graph entity it derives from — the reader opens it, so trust
// comes from one-click verifiability, never authority. `id` is the entity's yapm id (an evidence id
// yapm computed, not the model), `label` is a human hint (e.g. `ENG-142`).
export const DIGEST_EVIDENCE_KINDS = ['issue', 'pull_request', 'ci_check', 'deployment'] as const

export type DigestEvidenceKind = (typeof DIGEST_EVIDENCE_KINDS)[number]

// `shipped` = a delivered issue; `carried` = unfinished work rolled forward; `risk` = a failing
// check / revert / divergence; `highlight` = a cross-cutting theme. The model classifies; yapm
// supplies the underlying facts.
export const DIGEST_ITEM_KINDS = ['shipped', 'carried', 'risk', 'highlight'] as const

export type DigestItemKind = (typeof DIGEST_ITEM_KINDS)[number]

export const DIGEST_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const

export type DigestConfidence = (typeof DIGEST_CONFIDENCE_LEVELS)[number]

export const digestEvidenceRefSchema = z.object({
  kind: z.enum(DIGEST_EVIDENCE_KINDS),
  id: z.string().min(1),
  label: z.string().optional(),
})

export const digestItemSchema = z.object({
  kind: z.enum(DIGEST_ITEM_KINDS),
  summary: z.string().min(1),
  evidenceRefs: z.array(digestEvidenceRefSchema),
  confidence: z.enum(DIGEST_CONFIDENCE_LEVELS),
})

export const digestSectionSchema = z.object({
  title: z.string().min(1),
  items: z.array(digestItemSchema),
})

// The whole artifact: a short narrative TL;DR (prose only — every consequential NUMBER is computed
// by yapm and lives in the cited facts, not here) plus evidence-linked sections.
export const digestContentSchema = z.object({
  headline: z.string(),
  sections: z.array(digestSectionSchema),
})

export type DigestEvidenceRef = z.infer<typeof digestEvidenceRefSchema>
export type DigestItem = z.infer<typeof digestItemSchema>
export type DigestSection = z.infer<typeof digestSectionSchema>
export type DigestContent = z.infer<typeof digestContentSchema>

// Cite-evidence-or-omit. Drops any item whose `evidenceRefs` is empty; when a `knownEvidenceIds`
// set is supplied (the ids yapm computed for this cycle), each ref is first narrowed to that set so
// a hallucinated/invented evidence id cannot survive, then the item is dropped if nothing real
// remains. A section left with no items is removed. Deterministic and pure.
export function dropUncitedItems(
  content: DigestContent,
  knownEvidenceIds?: ReadonlySet<string>,
): DigestContent {
  const sections = content.sections
    .map((section) => ({
      ...section,
      items: section.items
        .map((item) =>
          knownEvidenceIds
            ? {
                ...item,
                evidenceRefs: item.evidenceRefs.filter((ref) => knownEvidenceIds.has(ref.id)),
              }
            : item,
        )
        .filter((item) => item.evidenceRefs.length > 0),
    }))
    .filter((section) => section.items.length > 0)
  return { ...content, sections }
}

// A workspace member as the name-validator needs them: the display name and/or email. No other
// field is consulted — the roster is the ONLY identity data anywhere near the pipeline (it never
// reaches the model; it is the after-the-fact backstop).
export interface RosterMember {
  readonly name?: string | null
  readonly email?: string | null
}

// The set of case-normalized needles a digest must not contain: each member's full display name
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

function textNamesMember(text: string, needles: readonly string[]): boolean {
  if (needles.length === 0) return false
  const hay = text.toLowerCase()
  return needles.some((needle) => hay.includes(needle))
}

// The deterministic name-validator backstop: true when any headline/item text names a workspace
// member. Even a fully injected model cannot name a person (the identity dimension is never in its
// context), but this rejects the output before it is shown as defense in depth.
export function contentNamesMember(
  content: DigestContent,
  roster: readonly RosterMember[],
): boolean {
  const needles = rosterNameNeedles(roster)
  if (needles.length === 0) return false
  if (textNamesMember(content.headline, needles)) return true
  return content.sections.some((section) =>
    section.items.some((item) => textNamesMember(item.summary, needles)),
  )
}

// The applied backstop: drop any item that names a member (and blank the headline if it does), so a
// single bad line never blocks the rest of an otherwise-clean digest. Sections emptied by the drop
// are removed. Pure.
export function dropItemsNamingMembers(
  content: DigestContent,
  roster: readonly RosterMember[],
): DigestContent {
  const needles = rosterNameNeedles(roster)
  if (needles.length === 0) return content
  const sections = content.sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !textNamesMember(item.summary, needles)),
    }))
    .filter((section) => section.items.length > 0)
  return {
    headline: textNamesMember(content.headline, needles) ? '' : content.headline,
    sections,
  }
}
