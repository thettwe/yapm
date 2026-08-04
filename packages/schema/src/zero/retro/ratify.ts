import type { RetroProposalVerdict } from '../context.js'
import { type BucketableProposal, RETRO_PROPOSAL_BUCKETS, retroProposalBucket } from './ai-draft.js'

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
// hand-built row in a test and over a fully synced proposal alike. When a row carries enough to be
// bucketed it is bucketed by `retroProposalBucket` — the ONE definition — so the flat list and the
// grouped rendering cannot disagree about what a follow-up is.
export interface RatifiableProposal extends Partial<BucketableProposal> {
  readonly verdict?: RetroProposalVerdict | null
  readonly rank?: number
}

function bucketIndex(proposal: RatifiableProposal): number | null {
  if (proposal.category === undefined) return null
  return RETRO_PROPOSAL_BUCKETS.indexOf(
    retroProposalBucket({ category: proposal.category, refs: proposal.refs }),
  )
}

// Contested first, then bucket order, then rank within the bucket. `Array.prototype.sort` is stable
// in every runtime this ships to, so returning 0 for two rows that tie on all three preserves the
// incoming order rather than reshuffling the tail under a reader — and a row carrying neither a
// category nor a rank ties on both, which is exactly the pre-bucket behaviour.
export function contestedFirst(a: RatifiableProposal, b: RatifiableProposal): number {
  const left = a.verdict === 'contested' ? 0 : 1
  const right = b.verdict === 'contested' ? 0 : 1
  if (left !== right) return left - right

  const leftBucket = bucketIndex(a)
  const rightBucket = bucketIndex(b)
  if (leftBucket !== null && rightBucket !== null && leftBucket !== rightBucket) {
    return leftBucket - rightBucket
  }
  if (a.rank !== undefined && b.rank !== undefined) return a.rank - b.rank
  return 0
}

// Sorting is deliberately expressed here rather than as an `orderBy`: the ordering is
// phase-dependent, and a phase-varying synced query would be a second read shape over the same rows.
export function sortContestedFirst<T extends RatifiableProposal>(rows: readonly T[]): T[] {
  return [...rows].sort(contestedFirst)
}
