import type { Transaction } from '@rocicorp/zero'
import type { CycleDigestStatus } from './context.js'
import type { DigestContent } from './digest.js'
import { zql } from './schema.js'

// The server-only authoritative write path for `cycle_digest`, mirroring `applyWorkGraphMutation`:
// it uses the shared Zero `Transaction` (`tx.mutate`) — the same path human edits use — but is
// NEVER registered in the client `mutators` map, so a client can never forge a digest. The digest
// is thus client-read-only (synced via `queries.digests`), and the "numbers computed by yapm"
// guarantee holds because only this path, driven by the pre-compute job under the system principal,
// can write one. One row per cycle (unique on `cycleId`); re-running upserts idempotently.

export interface CycleDigestWrite {
  // Client-minted UUIDv7, minted at the call site (used only if the row is inserted).
  readonly id: string
  readonly teamId: string
  readonly cycleId: string
  readonly status: CycleDigestStatus
  readonly content: DigestContent | null
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

export async function upsertCycleDigest(tx: Transaction, write: CycleDigestWrite): Promise<void> {
  const existing = (await tx.run(zql.cycle_digest.where('cycleId', write.cycleId).one())) as
    | { id: string }
    | undefined

  const fields = {
    status: write.status,
    content: write.content,
    provider: write.provider,
    model: write.model,
    generatedAt: write.generatedAt,
    inputToken: write.inputToken,
    outputToken: write.outputToken,
    estimatedCostUsd: write.estimatedCostUsd,
    updatedAt: write.now,
  }

  if (existing) {
    await tx.mutate.cycle_digest.update({ id: existing.id, ...fields })
    return
  }
  await tx.mutate.cycle_digest.insert({
    id: write.id,
    teamId: write.teamId,
    cycleId: write.cycleId,
    createdAt: write.now,
    ...fields,
  })
}
