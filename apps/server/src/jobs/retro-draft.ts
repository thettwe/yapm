import type { DB } from '@yapm/schema/db'
import { retroFactsForCycle } from '@yapm/schema/db'
import { upsertRetroAiDraft } from '@yapm/schema/server'
import { type Kysely, sql } from 'kysely'
import type { AiGateway } from '../ai/gateway.js'
import { runRetroAiDraft } from '../ai/retro-draft.js'
import type { ZeroDatabase } from '../zero/db-provider.js'

export const RETRO_AI_DRAFT_QUEUE = 'retro-ai-draft'

// One pass's worth of pending drafts. A retro reveal is a human-paced event, so the queue is never
// deep; the limit exists so a first-enable on an instance with a backlog of `pending` rows drains
// steadily rather than firing every provider call at once.
export const RETRO_AI_DRAFT_BATCH = 5

// How long the tail waits before re-arming. A constant rather than an env var for the same reason the
// watchdog cron is one: there is no reason an operator would turn it. The draft appears a few seconds
// after the reveal, which is the trade design §D1 accepted in exchange for generating nothing at all
// for a retro nobody opens.
export const RETRO_AI_DRAFT_INTERVAL_SECONDS = 5

// How long a claim is honoured before another worker may take the row. Long enough that a slow model
// call is not stolen mid-flight, short enough that a worker killed mid-generation heals without a
// fifth status value and without a lock held across a model call.
const CLAIM_TTL = sql.raw("interval '5 minutes'")

export interface RetroDraftJobLogger {
  info: (obj: object, msg: string) => void
  warn: (obj: object, msg: string) => void
  error: (obj: object, msg: string) => void
}

export interface RetroDraftTailOptions {
  db: Kysely<DB>
  dbProvider: ZeroDatabase
  gateway: AiGateway
  logger: RetroDraftJobLogger
  limit?: number
}

export interface RetroDraftTailResult {
  readonly claimed: number
  readonly ready: number
  readonly aiOff: number
  readonly failed: number
}

interface PendingDraft {
  readonly id: string
  readonly retro_id: string
  readonly team_id: string
  readonly cycle_id: string | null
  readonly workspace_id: string
  readonly ai_retro_draft_since: Date | null
}

// THE CLAIM, and why it is one statement. Two app replicas both run this tail (the scheduler supports
// multi-replica), so two workers can select the same `pending` row and spend a user's BYO key twice
// for one retro. The predicate and the write are therefore atomic: no row returned means somebody
// else owns this pass. The five-minute reclaim window heals a crashed worker.
//
// This runs BEFORE any provider call, always. A unit test asserts the ordering.
async function claim(db: Kysely<DB>, id: string): Promise<boolean> {
  const { rows } = await sql<{ id: string }>`
    update retro_ai_draft set claimed_at = now()
     where id = ${id} and status = 'pending'
       and (claimed_at is null or claimed_at < now() - ${CLAIM_TTL})
    returning id
  `.execute(db)
  return rows.length > 0
}

export async function runRetroAiDraftTail(
  options: RetroDraftTailOptions,
): Promise<RetroDraftTailResult> {
  const { db, dbProvider, gateway, logger } = options
  const limit = options.limit ?? RETRO_AI_DRAFT_BATCH

  const pending = await db
    .selectFrom('retro_ai_draft')
    .innerJoin('retro', 'retro.id', 'retro_ai_draft.retro_id')
    .innerJoin('team', 'team.id', 'retro_ai_draft.team_id')
    .select([
      'retro_ai_draft.id as id',
      'retro_ai_draft.retro_id as retro_id',
      'retro_ai_draft.team_id as team_id',
      'retro.cycle_id as cycle_id',
      'team.workspace_id as workspace_id',
      'team.ai_retro_draft_since as ai_retro_draft_since',
    ])
    .where('retro_ai_draft.status', '=', 'pending')
    .orderBy('retro_ai_draft.created_at', 'asc')
    .limit(limit)
    .execute()

  const result = { claimed: 0, ready: 0, aiOff: 0, failed: 0 }

  for (const row of pending as PendingDraft[]) {
    if (!(await claim(db, row.id))) continue
    result.claimed += 1

    // A retro with no cycle, or a team that opted back out between the advance and this pass, is
    // written `ai_off` rather than left `pending` forever. There is no fact assembly and no provider
    // call in either case.
    if (row.cycle_id === null || row.ai_retro_draft_since === null) {
      await writeAiOff({ dbProvider, row })
      result.aiOff += 1
      continue
    }

    const facts = await retroFactsForCycle(db, row.team_id, row.cycle_id)
    if (facts === null) {
      await writeAiOff({ dbProvider, row })
      result.aiOff += 1
      continue
    }

    const run = await runRetroAiDraft(
      {
        gateway,
        db,
        dbProvider,
        onError: (error) =>
          logger.error({ err: error, retroId: row.retro_id }, 'retro AI draft run failed'),
      },
      { workspaceId: row.workspace_id, retroId: row.retro_id, facts },
    )
    if (run.status === 'ready') result.ready += 1
    else if (run.status === 'ai_off') result.aiOff += 1
    else result.failed += 1

    logger.info(
      { retroId: row.retro_id, status: run.status, proposals: run.proposals },
      'retro AI draft computed',
    )
  }

  return result
}

// Written through the same server-only Zero path as every other status, so the row a client reads is
// always produced by the authoritative writer.
async function writeAiOff(input: { dbProvider: ZeroDatabase; row: PendingDraft }): Promise<void> {
  const { dbProvider, row } = input
  const now = Date.now()
  await dbProvider.transaction(async (tx) => {
    await upsertRetroAiDraft(tx, {
      id: row.id,
      teamId: row.team_id,
      retroId: row.retro_id,
      status: 'ai_off',
      now,
    })
  })
}
