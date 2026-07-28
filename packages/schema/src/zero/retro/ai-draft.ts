import * as z from 'zod'
import {
  type AiArtifact,
  type AiArtifactItem,
  dropAiItemsNamingMembers,
  dropUncitedAiItems,
  type RosterMember,
} from '../ai-content.js'
import { DIGEST_CONFIDENCE_LEVELS } from '../digest.js'
import { type RetroSeedRef, retroSeedRefSchema } from './seed.js'

// The retro draft's TYPED structured-output contract and its deterministic validators. Pure — no
// DB, no SDK, no UI import. The model emits exactly a `RetroDraftContent`; the chain below then
// enforces the substrate guarantees before anything is stored or shown.

// Wins / Losses / Improvements. The MODEL classifies into these three; it never gets to title them,
// which is why the artifact adapter carries `heading: null` — the UI supplies the labels.
export const RETRO_PROPOSAL_CATEGORIES = ['win', 'loss', 'improvement'] as const

export type RetroProposalCategory = (typeof RETRO_PROPOSAL_CATEGORIES)[number]

// At most three per bucket. A VALIDATOR, not a prompt instruction: the prompt asks for three, this
// number is what guarantees it.
export const RETRO_PROPOSALS_PER_CATEGORY = 3

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

// At most `perCategory` proposals per bucket, keeping the model's own order within each. Applied
// LAST in the chain (see `sanitizeRetroDraft`) so a dropped proposal is replaced by the next real
// one rather than leaving a hole.
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

// The three validators, in the order design §D6 fixes and for the reason it gives:
//   1. cite-or-omit against the ids yapm computed (evidence ids ∪ seed metric keys),
//   2. drop anything naming a workspace member (the roster is loaded AFTER the model call),
//   3. cap at three per category.
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

// `rank` is the 0-based index WITHIN the category, assigned after the chain so it is dense.
export function rankRetroProposals(content: RetroDraftContent): RankedRetroProposal[] {
  const next = new Map<RetroProposalCategory, number>()
  return content.proposals.map((proposal) => {
    const rank = next.get(proposal.category) ?? 0
    next.set(proposal.category, rank + 1)
    return { ...proposal, rank }
  })
}
