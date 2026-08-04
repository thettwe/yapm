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
  type RetroSeedRef,
  retroSeedRefSchema,
} from './seed.js'

// The retro draft's TYPED structured-output contract and its deterministic validators. Pure — no
// DB, no SDK, no UI import. The model emits exactly a `RetroDraftContent`; the chain below then
// enforces the substrate guarantees before anything is stored or shown.

// Wins / Losses / Improvements. The MODEL classifies into these three; it never gets to title them,
// which is why the artifact adapter carries `heading: null` — the UI supplies the labels.
export const RETRO_PROPOSAL_CATEGORIES = ['win', 'loss', 'improvement'] as const

export type RetroProposalCategory = (typeof RETRO_PROPOSAL_CATEGORIES)[number]

// The fourth BUCKET, and it is deliberately not a fourth stored category (design §D3).
// `retro_ai_proposal.category` is a text column under `check (category in ('win','loss',
// 'improvement'))`, so a fourth stored value costs DDL; `refs` is jsonb with no constraint, so a
// fourth reference KIND costs nothing. A proposal is a follow-up exactly when it cites one of the
// prior retro's agreed actions — which means "no prior actions ⇒ no follow-up" falls out of the
// shipped cite-or-omit validator (no action id is citable, so the reference is narrowed away and the
// proposal is dropped) rather than out of a first-retro branch somebody has to remember to write.
export const RETRO_PROPOSAL_BUCKETS = ['win', 'loss', 'improvement', 'follow_up'] as const

export type RetroProposalBucket = (typeof RETRO_PROPOSAL_BUCKETS)[number]

// At most three per bucket. A VALIDATOR, not a prompt instruction: the prompt asks for three, this
// number is what guarantees it.
export const RETRO_PROPOSALS_PER_CATEGORY = 3

// The ONE place a reference is inspected for the loop-closing kind. Everything that needs to know
// whether something points at a prior action — the bucket, the server's label baking, the panel's
// chip — asks this, so "what is a follow-up" has exactly one definition.
export function isRetroActionRef<T extends { readonly kind: string }>(
  ref: T,
): ref is T & { readonly kind: 'retro_action' } {
  return ref.kind === 'retro_action'
}

// Enough of a proposal to bucket one: the stored row, the model's parsed output and the client's
// synced row all satisfy it structurally, so there is no adapter and no second classifier.
export interface BucketableProposal {
  readonly category: RetroProposalCategory
  readonly refs?: readonly { readonly kind: string }[] | null
}

// THE single definition of a proposal's bucket, used by the cap, the rank, the ratification
// comparator, the panel's grouping and its category chip.
export function retroProposalBucket(proposal: BucketableProposal): RetroProposalBucket {
  return (proposal.refs ?? []).some(isRetroActionRef) ? 'follow_up' : proposal.category
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

// At most `perCategory` proposals per BUCKET, keeping the model's own order within each. Applied
// LAST in the chain (see `sanitizeRetroDraft`) so a dropped proposal is replaced by the next real
// one rather than leaving a hole. Counting by bucket rather than by stored category is what keeps a
// cycle full of follow-ups from crowding out the improvements the team should make next.
export function capRetroProposals(
  content: RetroDraftContent,
  perCategory: number,
): RetroDraftContent {
  const kept = new Map<RetroProposalBucket, number>()
  return {
    proposals: content.proposals.filter((proposal) => {
      const bucket = retroProposalBucket(proposal)
      const seen = kept.get(bucket) ?? 0
      if (seen >= perCategory) return false
      kept.set(bucket, seen + 1)
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

// How much of an action body a chip carries. Long enough to recognize the action, short enough that
// a prior retro's wording cannot take over the row.
const RETRO_ACTION_LABEL_MAX = 80

function truncate(text: string, max: number): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

// YAPM SAYS WHAT THE MODEL IS POINTING AT (design §D4). Run after `sanitizeRetroDraft` and before the
// write: every surviving `retro_action` reference has its `label`, `outcome` and `origin` OVERWRITTEN
// with yapm's own text, and every other kind has `outcome`/`origin` stripped — so none of the three
// can ever carry a string a model wrote. This exists because a `retro_action` reference is the one
// kind the client cannot resolve from its own synced rows (the prior retro is not in this retro's
// sync scope), so unlike an issue chip it has nothing to fall back to.
//
// A reference whose action is unknown is DROPPED rather than labelled: after cite-or-omit only real
// action ids survive, so this is a belt on a brace, and a proposal left with no reference at all goes
// with it — the same rule the citation validator applies.
export function bakeRetroActionRefs(
  content: RetroDraftContent,
  prior: { readonly cycleName: string; readonly actions: readonly BakeableRetroAction[] } | null,
): RetroDraftContent {
  const actions = new Map((prior?.actions ?? []).map((action) => [action.id, action]))
  const proposals = content.proposals
    .map((proposal) => ({
      ...proposal,
      refs: proposal.refs.flatMap((ref): RetroSeedRef[] => {
        if (!isRetroActionRef(ref)) {
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

// The three validators, in the order design §D6 fixes and for the reason it gives:
//   1. cite-or-omit against the ids yapm computed (evidence ids ∪ seed metric keys ∪ prior action
//      ids ∪ prior-retro outcome-total keys),
//   2. drop anything naming a workspace member (the roster is loaded AFTER the model call),
//   3. cap at three per BUCKET, follow-ups included.
// Pure and synchronous — nothing here reads a database or a clock.
export function sanitizeRetroDraft(
  content: RetroDraftContent,
  knownIds: ReadonlySet<string>,
  roster: readonly RosterMember[],
): RetroDraftContent {
  const cited = dropUncitedAiItems(retroDraftToArtifact(content), knownIds)
  const named = dropAiItemsNamingMembers(cited, roster)
  return capRetroProposals(retroDraftFromArtifact(named), RETRO_PROPOSALS_PER_CATEGORY)
}

// `rank` is the 0-based index WITHIN the bucket, assigned after the chain so it is dense. Two
// follow-ups stored as `improvement` therefore rank 0 and 1 among follow-ups, not among the
// improvements they are rendered apart from.
export function rankRetroProposals(content: RetroDraftContent): RankedRetroProposal[] {
  const next = new Map<RetroProposalBucket, number>()
  return content.proposals.map((proposal) => {
    const bucket = retroProposalBucket(proposal)
    const rank = next.get(bucket) ?? 0
    next.set(bucket, rank + 1)
    return { ...proposal, rank }
  })
}
