import type { RetroProposalVerdict } from '../context.js'

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

export interface RatifiableProposal {
  readonly verdict?: RetroProposalVerdict | null
}

// Contested first, everything else in the order it already had. `Array.prototype.sort` is stable in
// every runtime this ships to, so returning 0 for two same-class rows preserves the incoming
// (category, rank) order rather than reshuffling the tail under a reader.
export function contestedFirst(a: RatifiableProposal, b: RatifiableProposal): number {
  const left = a.verdict === 'contested' ? 0 : 1
  const right = b.verdict === 'contested' ? 0 : 1
  return left - right
}

// Sorting is deliberately expressed here rather than as an `orderBy`: the ordering is
// phase-dependent, and a phase-varying synced query would be a second read shape over the same rows.
export function sortContestedFirst<T extends RatifiableProposal>(rows: readonly T[]): T[] {
  return [...rows].sort(contestedFirst)
}
