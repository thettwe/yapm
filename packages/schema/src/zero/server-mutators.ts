import { defineMutator, defineMutators, type ServerTransaction } from '@rocicorp/zero'
import { type Kysely, sql } from 'kysely'
import type { DB } from '../db/types.js'
import { createCycleArgs, createIssueArgs, mutators } from './mutators.js'

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

// Server-authoritative overrides layered over the shared client mutators. Only `issue.create`
// differs: it runs the shared create (which leaves `number` null), then, in the same
// authoritative transaction, claims and writes the per-team number. The client never runs
// this path, so its optimistic issue stays number-less until this authoritative row
// replicates back and the key settles.
export function createServerMutators() {
  return defineMutators(mutators, {
    issue: {
      create: defineMutator(createIssueArgs, async ({ tx, args, ctx }) => {
        await mutators.issue.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const db = (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
        const number = await claimNextIssueNumber(db, args.teamId)
        await tx.mutate.issue.update({ id: args.id, number, updatedAt: args.updatedAt })
      }),
    },
    cycle: {
      create: defineMutator(createCycleArgs, async ({ tx, args, ctx }) => {
        await mutators.cycle.create.fn({ tx, args, ctx })
        if (tx.location !== 'server') return
        const db = (tx as ServerTransaction).dbTransaction.wrappedTransaction as Kysely<DB>
        const number = await claimNextCycleNumber(db, args.teamId)
        await tx.mutate.cycle.update({ id: args.id, number, updatedAt: args.updatedAt })
      }),
    },
  })
}
