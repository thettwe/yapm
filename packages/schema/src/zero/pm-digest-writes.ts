import type { ServerTransaction, Transaction } from '@rocicorp/zero'
import type { Kysely } from 'kysely'
import type { DB } from '../db/types.js'
import type { AiArtifactStatus } from './context.js'
import type { StoredPmDigestContent } from './pm-digest.js'
import { zql } from './schema.js'

// The server-only authoritative write path for `pm_digest`, exactly the `upsertCycleDigest` and
// `upsertRetroAiDraft` trick: it uses the shared Zero `Transaction` (`tx.mutate`) — the same path
// human edits use — and is NEVER registered in the client `mutators` map, so a client can never
// forge a digest, forge its numbers, or write content of its own into a row that will be read
// outside its team. It is re-exported from `@yapm/schema/server` and nowhere else.
//
// `published_at` IS NOT WRITABLE HERE AT ALL, and that omission is the review-and-publish gate
// expressed as missing code: generation writes an unpublished row, and the only thing that can move
// content across the permission boundary is a human going through `pmDigest.publish`.

export interface PmDigestWrite {
  // Client-minted UUIDv7, minted at the call site (used only if the row is inserted — the upsert is
  // keyed on the unique `cycleId`, so a re-run finds the existing row and discards the fresh id).
  readonly id: string
  readonly teamId: string
  readonly cycleId: string
  readonly status: AiArtifactStatus
  // The model's validated content plus yapm's own subject line and evidence labels.
  readonly content: StoredPmDigestContent | null
  readonly provider: string | null
  readonly model: string | null
  // Wall clock the digest was produced; null until `ready`.
  readonly generatedAt: number | null
  readonly inputToken: number | null
  readonly outputToken: number | null
  readonly estimatedCostUsd: number | null
  // Deterministic write clock (keeps the write idempotent under retry).
  readonly now: number
}

export interface UpsertPmDigestResult {
  readonly id: string
  readonly inserted: boolean
}

export async function upsertPmDigest(
  tx: Transaction,
  write: PmDigestWrite,
): Promise<UpsertPmDigestResult> {
  const existing = (await tx.run(zql.pm_digest.where('cycleId', write.cycleId).one())) as
    | { id: string }
    | undefined

  const fields = {
    status: write.status,
    content: write.content,
    provider: write.provider,
    model: write.model,
    generatedAt: write.generatedAt,
    updatedAt: write.now,
  }

  const id = existing?.id ?? write.id
  if (existing) {
    await tx.mutate.pm_digest.update({ id, ...fields })
  } else {
    await tx.mutate.pm_digest.insert({
      id,
      teamId: write.teamId,
      cycleId: write.cycleId,
      publishedAt: null,
      audienceSizeAtPublish: null,
      createdAt: write.now,
      ...fields,
    })
  }

  // The run's own numbers, written through the raw seam IN THE SAME TRANSACTION because they are
  // not in the Zero schema — a PM has no use for a team's token counts, and `estimated_cost_usd` is
  // read in SQL by the one spend accessor. Splitting this into a second transaction would let a
  // crash between the two drop a cost the workspace really spent, which is exactly how a spend cap
  // silently under-fires.
  const db = (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
  await db
    .updateTable('pm_digest')
    .set({
      input_token: write.inputToken,
      output_token: write.outputToken,
      estimated_cost_usd: write.estimatedCostUsd,
    })
    .where('id', '=', id)
    .execute()

  return { id, inserted: existing === undefined }
}
