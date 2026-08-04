import type { Transaction } from '@rocicorp/zero'
import type { RetroReactionValue } from '../context.js'
import { zql } from '../schema.js'
import { retroProposalVerdict } from './ratify.js'

// The server-only authoritative ratification pass, the same shape as `ai-draft-writes.ts`: it writes
// through the shared Zero `Transaction` but is NEVER registered in the client mutator map, so the
// four verdict columns are client-read-only exactly as the proposal itself is.
//
// THE WHOLE DESIGN IS THAT THIS IS THE ONLY PLACE A COUNT IS EVER WRITTEN. Reactions accumulate
// nothing: recording one is a plain upsert on a key nobody else can address, and the tally is
// computed here, once, from one read. That sidesteps both concurrency scars this repo already paid
// for — there is no shared counter to lose an update on (`bumpRetroVoteTally`) and no per-actor
// budget to hold a row lock for (`lockRetroForVote`), because a reaction has no budget and its
// primary key IS its whole constraint.

interface ReactionRow {
  readonly proposalId: string
  readonly value: RetroReactionValue
}

interface ProposalRow {
  readonly id: string
}

interface Tally {
  agree: number
  disagree: number
}

// Bounded by proposals x members — at most 9 x team size, so for yapm's audience at most a couple of
// hundred rows, read once at a moment that is already doing a multi-row publish pass.
export async function ratifyRetroAiProposals(
  tx: Transaction,
  retroId: string,
  at: number,
): Promise<void> {
  const proposals = (await tx.run(zql.retro_ai_proposal.where('retroId', retroId))) as ProposalRow[]
  if (proposals.length === 0) return

  // ONE read of every reaction row for the retro. A server transaction is not permission-filtered —
  // the same property `publishRetroDrafts` relies on to read every author's drafts — so this sees
  // the whole team's reactions while no client query can see any but its own.
  const reactions = (await tx.run(zql.retro_ai_reaction.where('retroId', retroId))) as ReactionRow[]

  const tallies = new Map<string, Tally>()
  for (const reaction of reactions) {
    const tally = tallies.get(reaction.proposalId) ?? { agree: 0, disagree: 0 }
    if (reaction.value === 'agree') tally.agree += 1
    else tally.disagree += 1
    tallies.set(reaction.proposalId, tally)
  }

  for (const proposal of proposals) {
    const tally = tallies.get(proposal.id) ?? { agree: 0, disagree: 0 }
    await tx.mutate.retro_ai_proposal.update({
      id: proposal.id,
      verdict: retroProposalVerdict(tally.agree, tally.disagree),
      agreeCount: tally.agree,
      disagreeCount: tally.disagree,
      ratifiedAt: at,
    })
  }
}

// The step back's counterpart. A stale verdict displayed while people are still reacting is an
// anchoring signal, and a member who reacted after the first advance would otherwise read a verdict
// computed without them — which is worse than no verdict at all.
//
// REACTION ROWS ARE NEVER DELETED HERE. They are what each member said; only the derived stamp is
// cleared, and the next advance recounts them.
export async function clearRetroAiVerdicts(tx: Transaction, retroId: string): Promise<void> {
  const proposals = (await tx.run(zql.retro_ai_proposal.where('retroId', retroId))) as ProposalRow[]
  for (const proposal of proposals) {
    await tx.mutate.retro_ai_proposal.update({
      id: proposal.id,
      verdict: null,
      agreeCount: null,
      disagreeCount: null,
      ratifiedAt: null,
    })
  }
}
