import {
  defineMutator,
  defineMutators,
  type ReadonlyJSONValue,
  type ServerTransaction,
  type Transaction,
} from '@rocicorp/zero'
import { type Kysely, sql } from 'kysely'
import type { DB } from '../db/types.js'
import type { AuthContext } from './context.js'
import { MutationError, MutationErrorCode } from './errors.js'
import {
  castRetroVoteArgs,
  convertRetroActionToIssueArgs,
  createCycleArgs,
  createIssueArgs,
  deleteRetroCardArgs,
  isRetroFacilitator,
  mutators,
  retractRetroVoteArgs,
  setRetroPhaseArgs,
  startRetroTimerArgs,
} from './mutators.js'
import {
  bumpRetroVoteTally,
  isRetroCardAuthor,
  lockRetroVoteBudget,
  recordRetroCardAuthor,
} from './retro/server-writes.js'
import { zql } from './schema.js'

// Atomically claim the next per-team issue number. The row lock on `issue_sequence`
// serializes concurrent creates within a team; different teams take different rows and never
// contend. On first insert `next_number` starts at 2 and we return 1; each subsequent
// conflict bumps it and returns the prior value — a gapless monotonic sequence per team.
// Takes a bare Kysely executor (the wrapped transaction) so it is directly testable.
export async function claimNextIssueNumber(db: Kysely<DB>, teamId: string): Promise<number> {
  const { rows } = await sql<{ number: number | string }>`
    insert into issue_sequence (team_id, next_number)
    values (${teamId}, 2)
    on conflict (team_id) do update set next_number = issue_sequence.next_number + 1
    returning next_number - 1 as number
  `.execute(db)
  return Number(rows[0]?.number)
}

// The cycle counterpart to `claimNextIssueNumber` — same row-locked, gapless, per-team
// monotonic sequence, over `cycle_sequence`.
export async function claimNextCycleNumber(db: Kysely<DB>, teamId: string): Promise<number> {
  const { rows } = await sql<{ number: number | string }>`
    insert into cycle_sequence (team_id, next_number)
    values (${teamId}, 2)
    on conflict (team_id) do update set next_number = cycle_sequence.next_number + 1
    returning next_number - 1 as number
  `.execute(db)
  return Number(rows[0]?.number)
}

function serverDb(tx: Transaction): Kysely<DB> {
  return (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
}

export interface PublishableDraft {
  id: string
  retroId: string
  teamId: string
  columnId: string
  authorId: string
  body: string
  rank: string
  seedRef: ReadonlyJSONValue | null
  createdAt: number
}

// Draft -> card, the one mapping the anonymity guarantee turns on. Pure, so it is unit-testable on
// its own: the card REUSES THE DRAFT'S ID (nothing minted, publish idempotent) and carries an author
// ONLY when the retro is not anonymous.
export function publishedCardFromDraft(
  draft: PublishableDraft,
  retro: { isAnonymous: boolean },
  at: number,
) {
  return {
    id: draft.id,
    retroId: draft.retroId,
    teamId: draft.teamId,
    columnId: draft.columnId,
    groupId: null,
    body: draft.body,
    rank: draft.rank,
    isAnonymous: retro.isAnonymous,
    authorDisplayId: retro.isAnonymous ? null : draft.authorId,
    seedRef: draft.seedRef ?? null,
    createdAt: draft.createdAt,
    updatedAt: at,
  }
}

// The publish step, and the only place the card -> author binding is ever written.
//
// It runs ONLY on the server, because a client's `tx.run` sees only its own drafts and would publish
// a partial board optimistically. Each card REUSES ITS DRAFT'S ID, so nothing is minted inside a
// mutator and a re-run is an idempotent upsert. `author_display_id` is written only when the retro is
// not anonymous — for an anonymous retro the synced row carries no author value at all, and the true
// author goes to `retro_card_author`, which is absent from the Zero schema.
async function publishRetroDrafts(
  tx: Transaction,
  retro: { id: string; isAnonymous: boolean },
  at: number,
): Promise<void> {
  const drafts = (await tx.run(
    zql.retro_draft.where('retroId', retro.id).where('publishedAt', 'IS', null),
  )) as PublishableDraft[]
  const db = serverDb(tx)

  for (const draft of drafts) {
    await tx.mutate.retro_card.upsert(publishedCardFromDraft(draft, retro, at))
    await tx.mutate.retro_draft.update({ id: draft.id, publishedAt: at, updatedAt: at })
    await recordRetroCardAuthor(db, {
      cardId: draft.id,
      retroId: draft.retroId,
      authorId: draft.authorId,
    })
  }
}

// Every case this leaves to the shared mutator (no caller, no card, no retro) is one the shared
// mutator itself rejects with a generic not-authorized, so a card's existence never leaks here either.
async function assertCardDeleteAuthority(
  tx: Transaction,
  cardId: string,
  ctx: AuthContext | undefined,
): Promise<void> {
  if (ctx === undefined) return
  const card = (await tx.run(zql.retro_card.where('id', cardId).one())) as
    | { id: string; retroId: string }
    | undefined
  if (card === undefined) return
  const retro = (await tx.run(zql.retro.where('id', card.retroId).one())) as
    | { id: string; facilitatorId: string | null }
    | undefined
  if (retro === undefined) return
  if (isRetroFacilitator(retro, ctx)) return
  if (await isRetroCardAuthor(serverDb(tx), cardId, ctx.userID)) return
  throw new MutationError(
    'Not authorized to perform this action',
    MutationErrorCode.notAuthorized,
    cardId,
  )
}

// Server-authoritative overrides layered over the shared client mutators. Each one adds exactly the
// work a client cannot do correctly — claim a gapless per-team number, publish every participant's
// drafts, increment a tally atomically, or stamp the server clock — and nothing else: the
// authorization and phase checks live in the shared mutator so client and server agree.
export function createServerMutators() {
  return defineMutators(mutators, {
    issue: {
      create: defineMutator(createIssueArgs, async ({ tx, args, ctx }) => {
        await mutators.issue.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const number = await claimNextIssueNumber(serverDb(tx), args.teamId)
        await tx.mutate.issue.update({ id: args.id, number, updatedAt: args.updatedAt })
      }),
    },
    cycle: {
      create: defineMutator(createCycleArgs, async ({ tx, args, ctx }) => {
        await mutators.cycle.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const number = await claimNextCycleNumber(serverDb(tx), args.teamId)
        await tx.mutate.cycle.update({ id: args.id, number, updatedAt: args.updatedAt })
      }),
    },
    retro: {
      // Advancing forward out of `brainstorm` reveals every participant's cards at once. The phase
      // flip itself stays in the shared mutator, so the interaction is still instant; the rest of the
      // board arrives a sync tick later.
      setPhase: defineMutator(setRetroPhaseArgs, async ({ tx, args, ctx }) => {
        const before = (await tx.run(zql.retro.where('id', args.id).one())) as
          | { id: string; phase: string; isAnonymous: boolean }
          | undefined
        await mutators.retro.setPhase.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (before === undefined) return
        if (before.phase !== 'brainstorm' || args.to !== 'group') return
        await publishRetroDrafts(
          tx,
          { id: args.id, isAnonymous: before.isAnonymous },
          args.updatedAt,
        )
      }),
      // The timer's end is recomputed from the SERVER clock, which is authoritative, so a skewed
      // client cannot shift the moment every other client counts down to.
      startTimer: defineMutator(startRetroTimerArgs, async ({ tx, args, ctx }) => {
        await mutators.retro.startTimer.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        await tx.mutate.retro.update({
          id: args.id,
          timerEndsAt: Date.now() + args.durationS * 1000,
          updatedAt: args.updatedAt,
        })
      }),
      // A converted action's issue claims the same per-team number as any hand-created issue, in the
      // same authoritative pass, so the two are indistinguishable. Skipped when the action was
      // already converted (the shared mutator returned without creating anything).
      convertActionToIssue: defineMutator(
        convertRetroActionToIssueArgs,
        async ({ tx, args, ctx }) => {
          const before = (await tx.run(zql.retro_action.where('id', args.actionId).one())) as
            | { id: string; issueId: string | null }
            | undefined
          await mutators.retro.convertActionToIssue.fn({ tx, args, ctx })
          if (tx.location !== 'server') return
          if (before === undefined || before.issueId !== null) return
          const issue = (await tx.run(zql.issue.where('id', args.issueId).one())) as
            | { id: string; teamId: string }
            | undefined
          if (issue === undefined) return
          const number = await claimNextIssueNumber(serverDb(tx), issue.teamId)
          await tx.mutate.issue.update({ id: args.issueId, number, updatedAt: args.updatedAt })
        },
      ),
    },
    retroCard: {
      // The self-delete path is re-verified against the server-only author table, which is the final
      // authority on who wrote a card (the shared mutator's client-checkable proof is the caller's own
      // retained draft row). The facilitator/admin moderation path needs no author at all. Checked
      // BEFORE the shared mutator, which deletes the row.
      delete: defineMutator(deleteRetroCardArgs, async ({ tx, args, ctx }) => {
        if (tx.location === 'server') await assertCardDeleteAuthority(tx, args.id, ctx)
        await mutators.retroCard.delete.fn({ tx, args, ctx })
      }),
    },
    retroVote: {
      // The tally is incremented in ONE statement rather than read-then-written, because a whole team
      // voting at once would otherwise lose updates. The shared mutator writes the optimistic tally
      // on the client only, so this is the single authoritative write.
      //
      // The caller's budget is locked FIRST, before the shared mutator counts their dots: that count
      // and the insert that follows it are two statements, and two casts racing under READ COMMITTED
      // would otherwise both read the same pre-insert count and both land, past the budget.
      cast: defineMutator(castRetroVoteArgs, async ({ tx, args, ctx }) => {
        if (tx.location === 'server' && ctx !== undefined) {
          await lockRetroVoteBudget(serverDb(tx), args.retroId, ctx.userID)
        }
        await mutators.retroVote.cast.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const vote = (await tx.run(zql.retro_vote.where('id', args.id).one())) as
          | { id: string; teamId: string }
          | undefined
        if (vote === undefined) return
        await bumpRetroVoteTally(serverDb(tx), {
          targetId: args.targetId,
          retroId: args.retroId,
          teamId: vote.teamId,
          targetType: args.targetType,
          delta: 1,
        })
      }),
      retract: defineMutator(retractRetroVoteArgs, async ({ tx, args, ctx }) => {
        const before = (await tx.run(zql.retro_vote.where('id', args.id).one())) as
          | {
              id: string
              retroId: string
              teamId: string
              targetType: 'card' | 'group'
              targetId: string
            }
          | undefined
        await mutators.retroVote.retract.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        if (before === undefined) return
        await bumpRetroVoteTally(serverDb(tx), {
          targetId: before.targetId,
          retroId: before.retroId,
          teamId: before.teamId,
          targetType: before.targetType,
          delta: -1,
        })
      }),
    },
  })
}
