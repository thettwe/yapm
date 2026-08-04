import type { RetroProposalVerdict } from '../context.js'
import { RETRO_PROPOSAL_CATEGORIES, type RetroProposalCategory } from './ai-draft.js'

// The team's decision rule, and the ordering it drives. Pure — no I/O, no ZQL, no clock — so the
// SAME function decides the stored verdict on the server and the hand-count a test compares it
// against, and the surface can sort already-synced rows without a second query shape.

// FIXED AND KNOB-FREE, AND THERE IS NO PARAMETER TO MAKE IT OTHERWISE. A threshold argument is the
// specific knob whose settings encode how much dissent a team is willing to hear, and retro-board's
// D7 refused config knobs on principle.
//
// Any single disagree means not agreed: a minority veto protects the quiet dissenter, which is the
// entire reason the ceremony exists. `contested` is a ROUTING label — "spend five minutes here" —
// not a rejection. `unrated` is the honest answer to silence; rendering it as agreement would
// manufacture consent from nobody having spoken.
export function retroProposalVerdict(agree: number, disagree: number): RetroProposalVerdict {
  if (agree + disagree === 0) return 'unrated'
  if (disagree === 0) return 'agreed'
  if (disagree > agree) return 'rejected'
  return 'contested'
}

// Every field but the verdict is OPTIONAL, and that is what keeps this comparator usable over a
// hand-built row in a test and over a fully synced proposal alike. A row carrying a category is
// ordered by that STORED value — the same one the panel groups on — so the flat list and the grouped
// rendering cannot disagree about which category a proposal is in.
export interface RatifiableProposal {
  readonly category?: RetroProposalCategory
  readonly verdict?: RetroProposalVerdict | null
  readonly rank?: number
}

function categoryIndex(proposal: RatifiableProposal): number | null {
  if (proposal.category === undefined) return null
  return RETRO_PROPOSAL_CATEGORIES.indexOf(proposal.category)
}

// Contested first, then category order, then rank within it. `Array.prototype.sort` is stable
// in every runtime this ships to, so returning 0 for two rows that tie on all three preserves the
// incoming order rather than reshuffling the tail under a reader — and a row carrying neither a
// category nor a rank ties on both, which is exactly the pre-bucket behaviour.
export function contestedFirst(a: RatifiableProposal, b: RatifiableProposal): number {
  const left = a.verdict === 'contested' ? 0 : 1
  const right = b.verdict === 'contested' ? 0 : 1
  if (left !== right) return left - right

  const leftCategory = categoryIndex(a)
  const rightCategory = categoryIndex(b)
  if (leftCategory !== null && rightCategory !== null && leftCategory !== rightCategory) {
    return leftCategory - rightCategory
  }
  if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank
  return 0
}

// Sorting is deliberately expressed here rather than as an `orderBy`: the ordering is
// phase-dependent, and a phase-varying synced query would be a second read shape over the same rows.
export function sortContestedFirst<T extends RatifiableProposal>(rows: readonly T[]): T[] {
  return [...rows].sort(contestedFirst)
}
