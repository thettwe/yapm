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
// by yapm and lives in the cited facts, not here) plus evidence-linked sections. This is the
// MODEL-FACING schema: it is what `generateObject` is given, so nothing yapm authors may appear in it.
export const digestContentSchema = z.object({
  headline: z.string(),
  sections: z.array(digestSectionSchema),
})

// How much of the cycle the area-enrichment step actually covered. yapm's own arithmetic, never the
// model's: it is attached AFTER generation and rendered as a yapm-authored line, so "the grouping is
// partial" is a stated fact rather than something the model was asked to remember to mention.
export const digestAreaCoverageSchema = z.object({
  // Pull requests whose changed files were read and mapped.
  enriched: z.number(),
  // Pull requests left unmapped by the per-cycle call cap or the rate-limit floor.
  skipped: z.number(),
  // Pull requests mapped from their first page of files only — the area set is a partial view.
  partial: z.number().optional(),
})

// The STORED digest blob: the model's content plus yapm's coverage arithmetic. Separate from the
// model-facing schema on purpose — a field the model could fill is a number the model could invent.
export const storedDigestContentSchema = digestContentSchema.extend({
  areaCoverage: digestAreaCoverageSchema.optional(),
})

export type DigestEvidenceRef = z.infer<typeof digestEvidenceRefSchema>
export type DigestItem = z.infer<typeof digestItemSchema>
export type DigestSection = z.infer<typeof digestSectionSchema>
export type DigestContent = z.infer<typeof digestContentSchema>
export type DigestAreaCoverage = z.infer<typeof digestAreaCoverageSchema>
export type StoredDigestContent = z.infer<typeof storedDigestContentSchema>

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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Match each needle on WORD BOUNDARIES, not raw substring: a member/handle like `ian` must flag
// "Ian shipped X" but never false-block common words such as "median" or "guardian". This is the
// "exact needle, never false-block on common words" behavior design.md decision 131 promises.
function textNamesMember(text: string, needles: readonly string[]): boolean {
  if (needles.length === 0) return false
  return needles.some((needle) => new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(text))
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
  return content.sections.some(
    (section) =>
      textNamesMember(section.title, needles) ||
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
    .filter((section) => !textNamesMember(section.title, needles))
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

// The DISCLOSURE validator — a structural sibling of the name validator above, and deliberately not
// a second cite-or-omit walker. It is DEFENCE IN DEPTH, NOT THE BOUNDARY: the boundary is that raw
// file paths are converted to yapm-computed area labels before the model is called, so a
// path-shaped string in the output can only come from an injected or echoed provider title, or from
// a hallucination. That distinction is why a heuristic is acceptable here and would not have been as
// the only control over patch content.

// Source-file extensions. The list is closed on purpose: a "looks like an extension" heuristic would
// eat ordinary prose ("v2.1 rollout", "St. Louis") for no gain.
const SOURCE_FILE_EXTENSION =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|java|kt|swift|c|h|cpp|cs|php|sql|sh|yml|yaml|toml|json|css|scss|html|vue|svelte)\b/gi

// A CAPITALISED identifier immediately before the dot is a product name, not a filename: `Node.js`,
// `Next.js`, `Vue.js`, `D3.js` are ordinary delivery prose and dropping those items would silently
// eat legitimate content. A real path still discloses through its slashes, which is why giving this
// up costs only the bare, slash-free, capitalised filename — and this is defence in depth, not the
// boundary.
const PRODUCT_NAME_BEFORE_DOT = /[A-Z][A-Za-z0-9]*$/

function textCarriesSourceExtension(text: string): boolean {
  for (const match of text.matchAll(SOURCE_FILE_EXTENSION)) {
    if (PRODUCT_NAME_BEFORE_DOT.test(text.slice(0, match.index))) continue
    return true
  }
  return false
}

// Directory names that only ever appear in a repository layout.
const SOURCE_DIRECTORY_SEGMENTS = new Set([
  'src',
  'apps',
  'packages',
  'lib',
  'test',
  'tests',
  'node_modules',
  'dist',
])

// `foo.bar(` — a code identifier calling a method. No whitespace is allowed before the paren, so
// ordinary prose ("e.g. (as above)") never matches.
const CODE_CALL_SHAPE = /\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(/

const ALL_DIGITS = /^\d+$/

function isPathToken(token: string): boolean {
  // Strip surrounding punctuation, INCLUDING a trailing dot: a path never ends in one, and leaving
  // it attached turns a sentence-final date (`2026/07/28.`) into a non-numeric final segment and so
  // into a false positive.
  const trimmed = token.replace(/^[^\w/]+/, '').replace(/[^\w/]+$/, '')
  if (!trimmed.includes('/')) return false
  const segments = trimmed.split('/')
  // `24/7`, `14/30`, `2026/07/28` — numeric pairs and dates are never a path, whatever their arity.
  if (segments.every((segment) => ALL_DIGITS.test(segment))) return false
  if (segments.length >= 3) return true
  // Exactly the three shapes design D6 names. A single slash between two ordinary words is NOT one
  // of them, which is what leaves `CI/CD`, `I/O`, `A/B` and `and/or` alone without an allowlist to
  // keep up to date.
  return segments.some(
    (segment) =>
      textCarriesSourceExtension(segment) || SOURCE_DIRECTORY_SEGMENTS.has(segment.toLowerCase()),
  )
}

function textDisclosesPath(text: string): boolean {
  // Any backtick at all: a code fence or an inline code span is a disclosure shape regardless of
  // what it wraps.
  if (text.includes('`')) return true
  if (textCarriesSourceExtension(text)) return true
  if (CODE_CALL_SHAPE.test(text)) return true
  return text.split(/\s+/).some(isPathToken)
}

// True when any headline/section/item text carries a path, an extension, a backtick or a code call.
export function contentDisclosesPaths(content: DigestContent): boolean {
  if (textDisclosesPath(content.headline)) return true
  return content.sections.some(
    (section) =>
      textDisclosesPath(section.title) ||
      section.items.some((item) => textDisclosesPath(item.summary)),
  )
}

// The applied validator: drop the offending ITEM (never the digest), blank a headline that discloses,
// and remove a section the drop emptied. Pure — same walker as `dropItemsNamingMembers`.
export function dropItemsDisclosingPaths(content: DigestContent): DigestContent {
  const sections = content.sections
    .filter((section) => !textDisclosesPath(section.title))
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => !textDisclosesPath(item.summary)),
    }))
    .filter((section) => section.items.length > 0)
  return {
    headline: textDisclosesPath(content.headline) ? '' : content.headline,
    sections,
  }
}
