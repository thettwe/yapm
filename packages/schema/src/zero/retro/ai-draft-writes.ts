import type { Transaction } from '@rocicorp/zero'
import type { AiArtifactStatus } from '../context.js'
import { zql } from '../schema.js'
import type { RankedRetroProposal } from './ai-draft.js'

// The server-only authoritative write path for the retro AI artifact, exactly the `upsertCycleDigest`
// trick: it uses the shared Zero `Transaction` (`tx.mutate`) — the same path human edits use — but is
// NEVER registered in the client `mutators` map, so a client can never forge a draft or a proposal.
// Both tables are therefore client-read-only, and "yapm computed these numbers" stays true because
// only this path, driven by the phase advance and the tail under the system principal, writes them.

export interface RetroAiDraftWrite {
  // Client-minted UUIDv7, minted at the CALL SITE (used only if the row is inserted — the upsert is
  // keyed on the unique `retroId`, so a re-run finds the existing row and discards the fresh id).
  readonly id: string
  readonly teamId: string
  readonly retroId: string
  readonly status: AiArtifactStatus
  readonly provider?: string | null
  readonly model?: string | null
  // Wall clock the draft was produced; null until `ready`.
  readonly generatedAt?: number | null
  readonly inputToken?: number | null
  readonly outputToken?: number | null
  readonly estimatedCostUsd?: number | null
  // Deterministic write clock (keeps the write idempotent under retry).
  readonly now: number
  // UPDATE THE EXISTING ROW OR DO NOTHING, returning null when there is none. Every write that
  // COMPLETES a run sets this, and the reason is a race the artifact's whole anchoring argument turns
  // on: a facilitator may step back to `brainstorm` — which deletes the draft — while a claimed run is
  // still inside its provider call. An inserting completion would resurrect a `ready` draft into a
  // retro that is back to writing cards, and `stampRetroAiDraft` (which leaves an existing row alone)
  // would then never replace or remove it. Only the phase advance inserts.
  readonly updateOnly?: boolean
}

export interface UpsertRetroAiDraftResult {
  readonly id: string
  readonly inserted: boolean
}

// Null means "there is no row to write and none was created" — only possible under `updateOnly`.
export async function upsertRetroAiDraft(
  tx: Transaction,
  write: RetroAiDraftWrite,
): Promise<UpsertRetroAiDraftResult | null> {
  const existing = (await tx.run(zql.retro_ai_draft.where('retroId', write.retroId).one())) as
    | { id: string }
    | undefined

  const fields = {
    status: write.status,
    provider: write.provider ?? null,
    model: write.model ?? null,
    generatedAt: write.generatedAt ?? null,
    inputToken: write.inputToken ?? null,
    outputToken: write.outputToken ?? null,
    estimatedCostUsd: write.estimatedCostUsd ?? null,
    updatedAt: write.now,
  }

  if (existing) {
    await tx.mutate.retro_ai_draft.update({ id: existing.id, ...fields })
    return { id: existing.id, inserted: false }
  }
  if (write.updateOnly === true) return null
  await tx.mutate.retro_ai_draft.insert({
    id: write.id,
    teamId: write.teamId,
    retroId: write.retroId,
    createdAt: write.now,
    ...fields,
  })
  return { id: write.id, inserted: true }
}

export interface RetroAiProposalWrite extends RankedRetroProposal {
  // Minted in the JOB, at this call site — proposal ids are never minted inside a mutator.
  readonly id: string
}

// Delete-then-insert, so a re-run of the tail (a reclaimed row, a retry) leaves exactly one set of
// proposals rather than two.
export async function replaceRetroAiProposals(
  tx: Transaction,
  draft: { readonly id: string; readonly retroId: string; readonly teamId: string },
  rows: readonly RetroAiProposalWrite[],
  now: number,
): Promise<void> {
  const existing = (await tx.run(zql.retro_ai_proposal.where('draftId', draft.id))) as {
    id: string
  }[]
  for (const row of existing) {
    await tx.mutate.retro_ai_proposal.delete({ id: row.id })
  }
  for (const row of rows) {
    await tx.mutate.retro_ai_proposal.insert({
      id: row.id,
      draftId: draft.id,
      retroId: draft.retroId,
      teamId: draft.teamId,
      category: row.category,
      summary: row.summary,
      confidence: row.confidence,
      refs: row.refs,
      rank: row.rank,
      createdAt: now,
    })
  }
}
