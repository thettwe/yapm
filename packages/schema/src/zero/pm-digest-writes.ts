import type { ServerTransaction, Transaction } from '@rocicorp/zero'
import type { Kysely } from 'kysely'
import { recordDisclosureAudit } from '../db/pm-disclosure.js'
import type { DB } from '../db/types.js'
import { type AiArtifactStatus, SYSTEM_ACTOR_ID } from './context.js'
import type { StoredPmDigestContent } from './pm-digest.js'
import { zql } from './schema.js'

// The server-only authoritative write path for `pm_digest`, exactly the `upsertCycleDigest` and
// `upsertRetroAiDraft` trick: it uses the shared Zero `Transaction` (`tx.mutate`) — the same path
// human edits use — and is NEVER registered in the client `mutators` map, so a client can never
// forge a digest, forge its numbers, or write content of its own into a row that will be read
// outside its team. It is re-exported from `@yapm/schema/server` and nowhere else.
//
// `published_at` IS ONLY EVER CLEARED HERE, NEVER SET, and that asymmetry is the review-and-publish
// gate expressed in code: generation writes an unpublished row and a re-generation forces a
// published one back to unpublished, so the only thing that can ever move content ACROSS the
// permission boundary is a human going through `pmDigest.publish`.

export interface PmDigestWrite {
  // Client-minted UUIDv7, minted at the call site (used only if the row is inserted — the upsert is
  // keyed on the unique `cycleId`, so a re-run finds the existing row and discards the fresh id).
  readonly id: string
  // Client-minted UUIDv7 for the forced-retraction audit row, minted at the call site for the same
  // reason and used only when this write lands on a row a human had already released.
  readonly auditId: string
  readonly workspaceId: string
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
  // True when this write landed on a row a human had already released, and therefore forced it back
  // to unpublished.
  readonly retracted: boolean
}

export async function upsertPmDigest(
  tx: Transaction,
  write: PmDigestWrite,
): Promise<UpsertPmDigestResult> {
  const existing = (await tx.run(zql.pm_digest.where('cycleId', write.cycleId).one())) as
    | { id: string; publishedAt: number | null }
    | undefined

  // REGENERATION CAN NEVER LEAVE NEW TEXT PUBLISHED. This path rewrites `content` wholesale, so an
  // upsert over a released row would swap already-reviewed prose for never-reviewed model output
  // while it kept syncing to the disclosure audience — the review-and-publish gate bypassed by a
  // background job rather than by a person. Clearing the release here is what makes the gate a
  // property of the row rather than of the order in which two subsystems happened to run: fresh
  // content requires a fresh human publish, always.
  const releaseCleared = {
    publishedAt: null,
    audienceSizeAtPublish: null,
  }

  const fields = {
    status: write.status,
    content: write.content,
    provider: write.provider,
    model: write.model,
    generatedAt: write.generatedAt,
    updatedAt: write.now,
    ...releaseCleared,
  }

  const id = existing?.id ?? write.id
  const retracted = existing !== undefined && existing.publishedAt !== null
  if (existing) {
    await tx.mutate.pm_digest.update({ id, ...fields })
  } else {
    await tx.mutate.pm_digest.insert({
      id,
      teamId: write.teamId,
      cycleId: write.cycleId,
      createdAt: write.now,
      ...fields,
    })
  }

  // The run's own numbers, written through the raw seam IN THE SAME TRANSACTION because they are
  // not in the Zero schema — a PM has no use for a team's token counts, and `estimated_cost_usd` is
  // read in SQL by the one spend accessor. Splitting this into a second transaction would let a
  // crash between the two drop a cost the workspace really spent, which is exactly how a spend cap
  // silently under-fires.
  //
  // `published_by` rides along for the same reason it is not in the Zero schema: the publisher's
  // identity is server-only, and a cleared release that kept its publisher would claim a human
  // released text they never saw.
  const db = (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
  await db
    .updateTable('pm_digest')
    .set({
      input_token: write.inputToken,
      output_token: write.outputToken,
      estimated_cost_usd: write.estimatedCostUsd,
      published_by: null,
    })
    .where('id', '=', id)
    .execute()

  // A forced retraction is a disclosure event like any other, and it is the one nobody chose — so it
  // is recorded under the system principal rather than left as an unexplained gap between a
  // `published` record and the next one.
  if (retracted) {
    await recordDisclosureAudit(db, {
      id: write.auditId,
      workspaceId: write.workspaceId,
      teamId: write.teamId,
      actorId: SYSTEM_ACTOR_ID,
      event: 'unpublished',
      pmDigestId: id,
      detail: { audienceSize: 0, status: write.status },
    })
  }

  return { id, inserted: existing === undefined, retracted }
}
