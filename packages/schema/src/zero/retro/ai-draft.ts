import * as z from 'zod'
import {
  type AiArtifact,
  type AiArtifactItem,
  dropAiItemsNamingMembers,
  dropUncitedAiItems,
  type RosterMember,
} from '../ai-content.js'
import { DIGEST_CONFIDENCE_LEVELS } from '../digest.js'
import {
  RETRO_ACTION_OUTCOME_LABEL,
  type RetroActionOutcome,
  type RetroActionOutcomeTotals,
  type RetroSeedRef,
  type RetroSeedRefKind,
  retroActionOutcomeFromKey,
  retroSeedRefSchema,
} from './seed.js'

// The retro draft's TYPED structured-output contract and its deterministic validators. Pure — no
// DB, no SDK, no UI import. The model emits exactly a `RetroDraftContent`; the chain below then
// enforces the substrate guarantees before anything is stored or shown.

// Wins / Losses / Improvements / Follow-ups — the four buckets the MODEL classifies into and the
// four values `retro_ai_proposal.category` may store, CHECK-constrained by migration 0022. It never
// gets to title them, which is why the artifact adapter carries `heading: null` — the UI supplies
// the labels. The cap, the rank, the ratification comparator, the panel's grouping and its category
// chip all read this stored value directly; there is no derivation and no second vocabulary.
//
// `follow_up` is the one that carries an obligation the other three do not: a proposal reporting on
// a prior retro's agreed action must cite that action, which `dropUnbackedFollowUps` enforces.
export const RETRO_PROPOSAL_CATEGORIES = ['win', 'loss', 'improvement', 'follow_up'] as const

export type RetroProposalCategory = (typeof RETRO_PROPOSAL_CATEGORIES)[number]

// At most three per category. A VALIDATOR, not a prompt instruction: the prompt asks for three, this
// number is what guarantees it.
export const RETRO_PROPOSALS_PER_CATEGORY = 3

// The ONE place a reference is inspected for the loop-closing kind — the server's label baking, the
// panel's origin lookup and the follow-up citation validator. It identifies a reference KIND, not a
// proposal's category: what a follow-up IS is the stored value above.
export function isRetroActionRef<T extends { readonly kind: string }>(
  ref: T,
): ref is T & { readonly kind: 'retro_action' } {
  return ref.kind === 'retro_action'
}

// `refs` reuses `retroSeedRefSchema` rather than the digest's, so `widget` is a legal ref kind and a
// proposal can point at a computed seed metric by its key — the UI then renders YAPM's value beside
// the sentence, never a number the model emitted.
export const retroDraftProposalSchema = z.object({
  category: z.enum(RETRO_PROPOSAL_CATEGORIES),
  summary: z.string().min(1),
  refs: z.array(retroSeedRefSchema),
  confidence: z.enum(DIGEST_CONFIDENCE_LEVELS),
})

export const retroDraftContentSchema = z.object({
  proposals: z.array(retroDraftProposalSchema),
})

export type RetroDraftProposal = z.infer<typeof retroDraftProposalSchema>
export type RetroDraftContent = z.infer<typeof retroDraftContentSchema>

// A stored proposal row: the sanitized proposal plus its 0-based position within its category.
export interface RankedRetroProposal extends RetroDraftProposal {
  readonly rank: number
}

// The `RetroDraftContent ↔ AiArtifact` adapters. ONE GROUP PER CATEGORY, in the canonical category
// order, so the shared walkers see a stable shape; each item carries its `source` proposal so the
// category and confidence survive a walk that knows nothing about them.
interface RetroArtifactItem extends AiArtifactItem {
  readonly source: RetroDraftProposal
}

export function retroDraftToArtifact(content: RetroDraftContent): AiArtifact {
  return {
    headline: null,
    groups: RETRO_PROPOSAL_CATEGORIES.map((category) => ({
      heading: null,
      items: content.proposals
        .filter((proposal) => proposal.category === category)
        .map(
          (proposal): RetroArtifactItem => ({
            summary: proposal.summary,
            refs: proposal.refs,
            source: proposal,
          }),
        ),
    })),
  }
}

export function retroDraftFromArtifact(artifact: AiArtifact): RetroDraftContent {
  return {
    proposals: artifact.groups.flatMap((group) =>
      group.items.map((item) => ({
        ...(item as RetroArtifactItem).source,
        refs: item.refs as readonly RetroSeedRef[] as RetroSeedRef[],
      })),
    ),
  }
}

// At most `perCategory` proposals per category, keeping the model's own order within each. Applied
// LAST in the chain (see `sanitizeRetroDraft`) so a dropped proposal is replaced by the next real
// one rather than leaving a hole. Follow-ups count under their own category on this same line, which
// is what keeps a cycle full of them from crowding out the improvements the team should make next.
export function capRetroProposals(
  content: RetroDraftContent,
  perCategory: number,
): RetroDraftContent {
  const kept = new Map<RetroProposalCategory, number>()
  return {
    proposals: content.proposals.filter((proposal) => {
      const seen = kept.get(proposal.category) ?? 0
      if (seen >= perCategory) return false
      kept.set(proposal.category, seen + 1)
      return true
    }),
  }
}

// One of the prior retro's agreed actions, as the label baker needs it: `PriorRetroAction` from the
// fact assembly satisfies this structurally, so nothing in `zero/` imports anything from `db/`.
export interface BakeableRetroAction {
  readonly id: string
  readonly body: string
  readonly outcome: RetroActionOutcome
}

// The prior retro as every step of the chain needs it — the actions to bake against, the totals the
// four citable outcome keys resolve to, and the cycle those actions were agreed in. `PriorRetroFacts`
// from the fact assembly satisfies it structurally, so nothing in `zero/` imports anything from `db/`.
export interface BakeablePriorRetro {
  readonly cycleName: string
  readonly actions: readonly BakeableRetroAction[]
  readonly totals: RetroActionOutcomeTotals
}

// How much of an action body a chip carries. Long enough to recognize the action, short enough that
// a prior retro's wording cannot take over the row.
const RETRO_ACTION_LABEL_MAX = 80

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

// YAPM SAYS WHAT THE MODEL IS POINTING AT (design §D4). Run INSIDE `sanitizeRetroDraft`, after the
// two validators and before the cap: every surviving `retro_action` reference has its `label`,
// `outcome` and `origin` OVERWRITTEN with yapm's own text, every prior-retro outcome TOTAL gets
// yapm's own count as its caption, and every other kind has `outcome`/`origin` stripped — so none of
// the three can ever carry a string a model wrote. This exists because those are the two references
// the client cannot resolve from its own synced rows (the prior retro is not in this retro's sync
// scope, and no seed metric carries an outcome key), so unlike an issue chip they have nothing to
// fall back to.
//
// A reference whose action is unknown is DROPPED rather than labelled: after cite-or-omit only real
// action ids survive, so this is a belt on a brace, and a proposal left with no reference at all goes
// with it — the same rule the citation validator applies.
export function bakeRetroActionRefs(
  content: RetroDraftContent,
  prior: BakeablePriorRetro | null,
): RetroDraftContent {
  const actions = new Map((prior?.actions ?? []).map((action) => [action.id, action]))
  const proposals = content.proposals
    .map((proposal) => ({
      ...proposal,
      refs: proposal.refs.flatMap((ref): RetroSeedRef[] => {
        if (!isRetroActionRef(ref)) {
          // The four outcome TOTALS are citable keys in the `widget` namespace with no seed metric
          // behind them, so yapm writes their caption here for the same reason it writes an action's:
          // there is nothing on the client to resolve them against. Without a prior retro the key was
          // never citable, so a reference carrying one is dropped exactly like an invented action id.
          const total = ref.kind === 'widget' ? retroActionOutcomeFromKey(ref.id) : null
          if (total !== null) {
            if (prior === null) return []
            return [
              {
                kind: ref.kind,
                id: ref.id,
                label: `${prior.totals[total]} ${RETRO_ACTION_OUTCOME_LABEL[total]}`,
                outcome: total,
              },
            ]
          }
          return [
            {
              kind: ref.kind,
              id: ref.id,
              ...(ref.label === undefined ? {} : { label: ref.label }),
            },
          ]
        }
        const action = actions.get(ref.id)
        if (action === undefined || prior === null) return []
        return [
          {
            kind: ref.kind,
            id: ref.id,
            label: `${truncate(action.body, RETRO_ACTION_LABEL_MAX)} — ${
              RETRO_ACTION_OUTCOME_LABEL[action.outcome]
            }`,
            outcome: action.outcome,
            origin: prior.cycleName,
          },
        ]
      }),
    }))
    .filter((proposal) => proposal.refs.length > 0)
  return { proposals }
}

// "NO PRIOR ACTIONS ⇒ NO FOLLOW-UP PROPOSAL", restored explicitly — the one property that was free
// under change 22's derived bucket and is not free under a stored category. A derived follow-up
// could not exist without citing a prior action, because citing one was the whole definition; on a
// team's first retro the `retroAction` namespace is empty, so an invented action id was narrowed
// away and the proposal dropped. A stored category breaks that implication: the model can say
// `follow_up` while citing nothing but a perfectly valid issue, and every shipped validator passes
// it — it is cited, it names no member, its references are in their own namespaces, it fits the cap.
// It would then be rendered as a report on a prior retro the team may never have had.
export function dropUnbackedFollowUps(content: RetroDraftContent): RetroDraftContent {
  return {
    proposals: content.proposals.filter(
      (proposal) => proposal.category !== 'follow_up' || proposal.refs.some(isRetroActionRef),
    ),
  }
}

// WHAT YAPM COMPUTED, PARTITIONED BY THE KIND IT MAY BE CITED UNDER — never one flat id set. Each
// namespace is resolved by exactly one surface: an evidence id by the client's synced work-graph
// rows, a `widget` key by `findSeedMetric` or by yapm's baked outcome caption, a prior action id by
// yapm's baked action caption. An id cited under a kind from another namespace resolves nowhere, so
// it is refused rather than stored — whichever direction it is crossed in.
export interface RetroCitations {
  // Work-graph entity ids, citable under `issue`, `pull_request`, `ci_check` and `deployment`.
  readonly evidence: readonly string[]
  // Computed seed metric keys plus the four prior-retro outcome-total keys.
  readonly widget: readonly string[]
  // The prior retro's agreed action ids. Empty for a team's first retro, so no `retro_action`
  // reference survives the narrowing and `dropUnbackedFollowUps` then has nothing to keep — which is
  // how "no prior actions ⇒ no follow-up proposal" holds without a first-retro branch.
  readonly retroAction: readonly string[]
}

const RETRO_REF_NAMESPACE: Readonly<Record<RetroSeedRefKind, keyof RetroCitations>> = {
  issue: 'evidence',
  pull_request: 'evidence',
  ci_check: 'evidence',
  deployment: 'evidence',
  widget: 'widget',
  retro_action: 'retroAction',
}

// The flat union, for the shared cite-or-omit walker: it drops an ITEM left with no reference, which
// the namespace narrowing above deliberately does not do.
export function retroCitableIds(citations: RetroCitations): ReadonlySet<string> {
  return new Set([...citations.evidence, ...citations.widget, ...citations.retroAction])
}

// Narrowing by (namespace, id) rather than by id alone, BEFORE cite-or-omit runs. A model that
// stamps the loop-closing kind on a real issue id would otherwise buy a follow-up the citation that
// backs it; a model that stamps an ordinary kind on a prior action id or an outcome-total
// key would otherwise keep a reference no surface can draw, leaving a proposal on screen with no
// evidence at all. Both are the same defect — a crossed namespace — and one filter refuses both.
function narrowRetroRefNamespaces(
  content: RetroDraftContent,
  citations: RetroCitations,
): RetroDraftContent {
  const ids: Readonly<Record<keyof RetroCitations, ReadonlySet<string>>> = {
    evidence: new Set(citations.evidence),
    widget: new Set(citations.widget),
    retroAction: new Set(citations.retroAction),
  }
  return {
    proposals: content.proposals.map((proposal) => ({
      ...proposal,
      refs: proposal.refs.filter((ref) => ids[RETRO_REF_NAMESPACE[ref.kind]].has(ref.id)),
    })),
  }
}

// The validators, in the order design §D6 fixes and for the reason it gives:
//   1. narrow every reference to the ids citable under ITS OWN kind's namespace (evidence ids under
//      a work-graph kind, metric and outcome-total keys under `widget`, prior action ids under
//      `retro_action`), so no namespace can be crossed in either direction,
//   2. cite-or-omit, which drops a proposal left with no surviving reference,
//   3. drop anything naming a workspace member (the roster is loaded AFTER the model call),
//   4. bake yapm's own caption onto the two references the client cannot resolve,
//   5. drop a `follow_up` proposal left backing its claim with no prior action at all,
//   6. cap at three per category, follow-ups included.
//
// BOTH HALVES OF STEP 5'S POSITION ARE LOAD-BEARING. It runs AFTER the bake because the bake is what
// removes a reference naming an action the prior retro does not have: a follow-up whose only
// prior-action reference the bake dropped must go with it, not survive backed by an issue chip. It
// runs BEFORE the cap for the reason the bake does — anything that drops a proposal must run before
// the cap, or three proposals that were going to be discarded can consume a category's entire
// allowance and leave a legitimate fourth one on the floor.
//
// THE BAKE IS INSIDE THE CHAIN for that same reason: it DROPS a reference whose action is unknown,
// and the proposal left with none, so a bake that ran after the cap could leave a category holding
// four proposals. The cap is last so that a dropped proposal is replaced by the next real one, which
// only holds if nothing downstream of it drops anything.
//
// Pure and synchronous — nothing here reads a database or a clock.
export function sanitizeRetroDraft(
  content: RetroDraftContent,
  citations: RetroCitations,
  roster: readonly RosterMember[],
  prior: BakeablePriorRetro | null,
): RetroDraftContent {
  const kinded = narrowRetroRefNamespaces(content, citations)
  const cited = dropUncitedAiItems(retroDraftToArtifact(kinded), retroCitableIds(citations))
  const named = dropAiItemsNamingMembers(cited, roster)
  const baked = bakeRetroActionRefs(retroDraftFromArtifact(named), prior)
  return capRetroProposals(dropUnbackedFollowUps(baked), RETRO_PROPOSALS_PER_CATEGORY)
}

// `rank` is the 0-based index WITHIN the stored category, assigned after the chain so it is dense.
// Two follow-ups therefore rank 0 and 1 among follow-ups, independently of how many improvements
// they are rendered beside.
export function rankRetroProposals(content: RetroDraftContent): RankedRetroProposal[] {
  const next = new Map<RetroProposalCategory, number>()
  return content.proposals.map((proposal) => {
    const rank = next.get(proposal.category) ?? 0
    next.set(proposal.category, rank + 1)
    return { ...proposal, rank }
  })
}
