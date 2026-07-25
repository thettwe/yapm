import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext, RetroPhase } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { retroColumnTemplate } from './retro/phase.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the retro mutator integration test must not be skipped',
  )
}

// The retro mutators against real Postgres, run exactly as zero-cache runs them: one open
// transaction per mutation, every read seeing the writes before it.
//
// The unit suite stubs the transaction, which makes it blind to the interactions that matter most on
// this board — a card, its group and the dots spent on them are three tables that must stay
// consistent after every write. Those bugs are only visible when a mutator's reads see its own
// writes, so they live here.
describe.skipIf(DATABASE_URL === undefined)('retro mutators against Postgres', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const cycleId = newId()
  const nextCycleId = newId()

  const FACILITATOR: AuthContext = { userID: `facilitator-${newId()}`, role: 'member' }
  const MEMBER: AuthContext = { userID: `member-${newId()}`, role: 'member' }
  const OTHER: AuthContext = { userID: `other-${newId()}`, role: 'member' }
  const ADMIN: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  const VIEWER: AuthContext = { userID: `viewer-${newId()}`, role: 'viewer' }

  let meta: PgSchemaMeta
  let retroId: string
  let columnIds: string[]

  // Each mutation gets its own Postgres transaction, so a rejected one rolls back exactly the way a
  // rejected mutation does in zero-cache.
  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise
    } catch (thrown) {
      return mutationErrorCode(thrown)
    }
    return undefined
  }

  async function rows<T>(query: ReturnType<typeof sql<T>>): Promise<T[]> {
    const { rows: result } = await query.execute(database.db)
    return result
  }

  async function openRetro(over: { isAnonymous?: boolean; votesPerParticipant?: number } = {}) {
    retroId = newId()
    columnIds = retroColumnTemplate('wentwell_didnt_action').map(() => newId())
    await apply((tx) =>
      mutators.retro.openForCycle.fn({
        tx,
        args: {
          id: retroId,
          cycleId,
          nextCycleId,
          format: 'wentwell_didnt_action',
          isAnonymous: over.isAnonymous ?? false,
          votesPerParticipant: over.votesPerParticipant ?? 3,
          columns: retroColumnTemplate('wentwell_didnt_action').map((column, index) => ({
            id: columnIds[index] ?? newId(),
            key: column.key,
            title: column.title,
            accentToken: column.accentToken,
            rank: `a${index}`,
          })),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: ADMIN,
      }),
    )
    await apply((tx) =>
      mutators.retro.claimFacilitator.fn({
        tx,
        args: { id: retroId, updatedAt: Date.now() },
        ctx: FACILITATOR,
      }),
    )
  }

  async function draft(ctx: AuthContext, body: string, rank: string): Promise<string> {
    const id = newId()
    await apply((tx) =>
      mutators.retroDraft.create.fn({
        tx,
        args: {
          id,
          retroId,
          columnId: columnIds[0] ?? '',
          body,
          rank,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx,
      }),
    )
    return id
  }

  // Walks the phase machine one legal step at a time, forwards or back, exactly as a facilitator
  // must — there is no way to jump, in the test helper or in the mutator.
  async function moveTo(phase: RetroPhase): Promise<void> {
    const order: RetroPhase[] = ['brainstorm', 'group', 'vote', 'discuss', 'actions', 'closed']
    const current = await rows(
      sql<{ phase: RetroPhase }>`select phase from retro where id = ${retroId}`,
    )
    let at = order.indexOf(current[0]?.phase ?? 'brainstorm')
    const target = order.indexOf(phase)
    while (at !== target) {
      at += at < target ? 1 : -1
      await apply((tx) =>
        mutators.retro.setPhase.fn({
          tx,
          args: { id: retroId, to: order[at] as RetroPhase, updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
    }
  }

  async function group(cardIds: string[], rank = 'a0'): Promise<string> {
    const id = newId()
    await apply((tx) =>
      mutators.retroGroup.create.fn({
        tx,
        args: {
          id,
          retroId,
          columnId: columnIds[0] ?? '',
          rank,
          cardIds,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        ctx: FACILITATOR,
      }),
    )
    return id
  }

  async function vote(ctx: AuthContext, targetType: 'card' | 'group', targetId: string) {
    const id = newId()
    await apply((tx) =>
      mutators.retroVote.cast.fn({
        tx,
        args: { id, retroId, targetType, targetId, createdAt: Date.now() },
        ctx,
      }),
    )
    return id
  }

  const countOf = async (table: string, where: string, value: string): Promise<number> => {
    const result = await rows(
      sql<{
        n: string
      }>`select count(*) as n from ${sql.table(table)} where ${sql.ref(where)} = ${value}`,
    )
    return Number(result[0]?.n ?? 0)
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'retro-pg-test')`.execute(
      database.db,
    )
    const key = `RP${Date.now() % 10_000}`
    await sql`insert into team (id, workspace_id, name, key) values (${teamId}, ${workspaceId}, 'Retro', ${key})`.execute(
      database.db,
    )
    for (const ctx of [FACILITATOR, MEMBER, OTHER, VIEWER]) {
      await sql`insert into team_membership (id, team_id, user_id) values (${newId()}, ${teamId}, ${ctx.userID})`.execute(
        database.db,
      )
    }
    await sql`
      insert into cycle (id, team_id, number, name, status, start_date, end_date)
      values
        (${cycleId}, ${teamId}, 1, 'Cycle 1', 'completed', now() - interval '14 days', now()),
        (${nextCycleId}, ${teamId}, 2, 'Cycle 2', 'active', now(), now() + interval '14 days')
    `.execute(database.db)
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  beforeEach(async () => {
    await sql`delete from retro where team_id = ${teamId}`.execute(database.db)
    await sql`delete from issue where team_id = ${teamId}`.execute(database.db)
    await openRetro()
  })

  describe('a group never outlives its last card', () => {
    // The regression: emptying a group by DELETING its last card left the group alive and still
    // votable, with the dots spent on it charged against their voters forever.
    it('dissolves the group and refunds its dots when its last card is deleted', async () => {
      const draftId = await draft(MEMBER, 'One lonely card', 'a1')
      await moveTo('group')
      const groupId = await group([draftId])
      await moveTo('vote')
      await vote(OTHER, 'group', groupId)

      await apply((tx) =>
        mutators.retroCard.delete.fn({ tx, args: { id: draftId }, ctx: FACILITATOR }),
      )

      expect(await countOf('retro_card', 'id', draftId)).toBe(0)
      expect(await countOf('retro_group', 'id', groupId)).toBe(0)
      expect(await countOf('retro_vote', 'target_id', groupId)).toBe(0)
      expect(await countOf('retro_vote_tally', 'target_id', groupId)).toBe(0)
      expect(await countOf('retro_vote', 'voter_id', OTHER.userID)).toBe(0)
    })

    it('keeps the group when a sibling card remains, with its dots intact', async () => {
      const first = await draft(MEMBER, 'First', 'a1')
      const second = await draft(MEMBER, 'Second', 'a2')
      await moveTo('group')
      const groupId = await group([first, second])
      await moveTo('vote')
      await vote(OTHER, 'group', groupId)

      await apply((tx) =>
        mutators.retroCard.delete.fn({ tx, args: { id: first }, ctx: FACILITATOR }),
      )

      expect(await countOf('retro_group', 'id', groupId)).toBe(1)
      expect(await countOf('retro_card', 'group_id', groupId)).toBe(1)
      const tally = await rows(
        sql<{ count: number }>`select count from retro_vote_tally where target_id = ${groupId}`,
      )
      expect(tally[0]?.count).toBe(1)
    })

    it('dissolves the group when its last card is moved out', async () => {
      const only = await draft(MEMBER, 'Only', 'a1')
      await moveTo('group')
      const groupId = await group([only])
      await apply((tx) =>
        mutators.retroCard.move.fn({
          tx,
          args: { id: only, groupId: null, rank: 'a5', updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )

      expect(await countOf('retro_group', 'id', groupId)).toBe(0)
      expect(await countOf('retro_card', 'id', only)).toBe(1)
    })

    it('releases the cards and their dots when a group is dissolved outright', async () => {
      const first = await draft(MEMBER, 'First', 'a1')
      const second = await draft(MEMBER, 'Second', 'a2')
      await moveTo('group')
      const groupId = await group([first, second])
      await moveTo('vote')
      await vote(OTHER, 'group', groupId)
      await moveTo('group')

      await apply((tx) =>
        mutators.retroGroup.dissolve.fn({
          tx,
          args: { id: groupId, updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )

      expect(await countOf('retro_group', 'id', groupId)).toBe(0)
      expect(await countOf('retro_vote_tally', 'target_id', groupId)).toBe(0)
      expect(await countOf('retro_vote', 'voter_id', OTHER.userID)).toBe(0)
      const ungrouped = await rows(
        sql<{
          group_id: string | null
        }>`select group_id from retro_card where retro_id = ${retroId}`,
      )
      expect(ungrouped.every((row) => row.group_id === null)).toBe(true)
    })

    // The mirror case: a card that already carries dots is absorbed into a group, which is the only
    // thing that can be voted on afterwards. Reachable by stepping back from `vote` to `group`.
    it('retires a card as a vote target when it joins a group', async () => {
      const first = await draft(MEMBER, 'First', 'a1')
      const second = await draft(MEMBER, 'Second', 'a2')
      await moveTo('vote')
      await vote(OTHER, 'card', first)
      await moveTo('group')
      const groupId = await group([first, second])

      expect(await countOf('retro_vote', 'target_id', first)).toBe(0)
      expect(await countOf('retro_vote_tally', 'target_id', first)).toBe(0)
      expect(await countOf('retro_vote', 'voter_id', OTHER.userID)).toBe(0)
      expect(await countOf('retro_card', 'group_id', groupId)).toBe(2)
    })
  })

  describe('the phase machine is enforced by the server', () => {
    it('refuses a skipped phase', async () => {
      const code = await rejection(
        apply((tx) =>
          mutators.retro.setPhase.fn({
            tx,
            args: { id: retroId, to: 'vote', updatedAt: Date.now() },
            ctx: FACILITATOR,
          }),
        ),
      )
      expect(code).toBe(MutationErrorCode.invalidPhase)
      const phase = await rows(
        sql<{ phase: string }>`select phase from retro where id = ${retroId}`,
      )
      expect(phase[0]?.phase).toBe('brainstorm')
    })

    it('refuses a long rewind but allows one step back', async () => {
      await moveTo('vote')
      const skipped = await rejection(
        apply((tx) =>
          mutators.retro.setPhase.fn({
            tx,
            args: { id: retroId, to: 'brainstorm', updatedAt: Date.now() },
            ctx: FACILITATOR,
          }),
        ),
      )
      expect(skipped).toBe(MutationErrorCode.invalidPhase)

      await apply((tx) =>
        mutators.retro.setPhase.fn({
          tx,
          args: { id: retroId, to: 'group', updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
      const phase = await rows(
        sql<{ phase: string }>`select phase from retro where id = ${retroId}`,
      )
      expect(phase[0]?.phase).toBe('group')
    })

    it('refuses a phase change from a member who is not the facilitator', async () => {
      const code = await rejection(
        apply((tx) =>
          mutators.retro.setPhase.fn({
            tx,
            args: { id: retroId, to: 'group', updatedAt: Date.now() },
            ctx: MEMBER,
          }),
        ),
      )
      expect(code).toBe(MutationErrorCode.notAuthorized)
    })

    it('refuses a draft written after brainstorm has closed', async () => {
      await moveTo('group')
      const code = await rejection(
        apply((tx) =>
          mutators.retroDraft.create.fn({
            tx,
            args: {
              id: newId(),
              retroId,
              columnId: columnIds[0] ?? '',
              body: 'Too late',
              rank: 'a9',
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            ctx: MEMBER,
          }),
        ),
      )
      expect(code).toBe(MutationErrorCode.invalidPhase)
      expect(await countOf('retro_draft', 'retro_id', retroId)).toBe(0)
    })

    it('refuses a dot cast outside the vote phase', async () => {
      const cardId = await draft(MEMBER, 'Card', 'a1')
      await moveTo('group')
      const code = await rejection(vote(OTHER, 'card', cardId))
      expect(code).toBe(MutationErrorCode.invalidPhase)
      expect(await countOf('retro_vote', 'retro_id', retroId)).toBe(0)
    })

    it('closes and reopens the retro, stamping and clearing closed_at', async () => {
      await moveTo('closed')
      const closed = await rows(
        sql<{ closed_at: Date | null }>`select closed_at from retro where id = ${retroId}`,
      )
      expect(closed[0]?.closed_at).not.toBeNull()

      await apply((tx) =>
        mutators.retro.setPhase.fn({
          tx,
          args: { id: retroId, to: 'actions', updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
      const reopened = await rows(
        sql<{ closed_at: Date | null }>`select closed_at from retro where id = ${retroId}`,
      )
      expect(reopened[0]?.closed_at).toBeNull()
    })
  })

  describe('publish is the anonymity boundary', () => {
    it('publishes every draft into a card reusing the draft id, exactly once', async () => {
      const mine = await draft(MEMBER, 'Mine', 'a1')
      const theirs = await draft(OTHER, 'Theirs', 'a2')

      await moveTo('group')
      const cards = await rows(
        sql<{ id: string }>`select id from retro_card where retro_id = ${retroId} order by rank`,
      )
      expect(cards.map((card) => card.id).sort()).toEqual([mine, theirs].sort())

      // Stepping back and forward again must not fork a second copy of anybody's card.
      await apply((tx) =>
        mutators.retro.setPhase.fn({
          tx,
          args: { id: retroId, to: 'brainstorm', updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
      await moveTo('group')
      expect(await countOf('retro_card', 'retro_id', retroId)).toBe(2)
    })

    it('leaves an anonymous card with no author on any synced row', async () => {
      await sql`delete from retro where team_id = ${teamId}`.execute(database.db)
      await openRetro({ isAnonymous: true })
      const cardId = await draft(MEMBER, 'Anonymous truth', 'a1')
      await moveTo('group')

      const card = await rows(
        sql<{ is_anonymous: boolean; author_display_id: string | null }>`
          select is_anonymous, author_display_id from retro_card where id = ${cardId}
        `,
      )
      expect(card[0]).toMatchObject({ is_anonymous: true, author_display_id: null })

      const binding = await rows(
        sql<{
          author_id: string
        }>`select author_id from retro_card_author where card_id = ${cardId}`,
      )
      expect(binding[0]?.author_id).toBe(MEMBER.userID)
    })

    // `retro_card_author` is absent from the Zero schema, so no ZQL query can even name it. The
    // harness refuses the same way a client would: there is no such table to sync from.
    it('cannot be reached through any synced query', async () => {
      const zeroTables = [...meta.keys()]
      expect(zeroTables).not.toContain('retro_card_author')
      await expect(
        apply(async (tx) => await tx.run({ ast: { table: 'retro_card_author' } } as never)),
      ).rejects.toThrow(/unknown table retro_card_author/u)
    })

    it('names an author on the card only when the retro is not anonymous', async () => {
      const cardId = await draft(MEMBER, 'Attributed', 'a1')
      await moveTo('group')
      const card = await rows(
        sql<{
          author_display_id: string | null
        }>`select author_display_id from retro_card where id = ${cardId}`,
      )
      expect(card[0]?.author_display_id).toBe(MEMBER.userID)
    })
  })

  describe('the vote budget is counted from real rows', () => {
    it('stops the voter at the budget and refunds it on retract', async () => {
      const cardId = await draft(MEMBER, 'Popular', 'a1')
      await moveTo('vote')

      const first = await vote(OTHER, 'card', cardId)
      await vote(OTHER, 'card', cardId)
      await vote(OTHER, 'card', cardId)
      const overspent = await rejection(vote(OTHER, 'card', cardId))
      expect(overspent).toBe(MutationErrorCode.voteBudget)

      const stacked = await rows(
        sql<{ count: number }>`select count from retro_vote_tally where target_id = ${cardId}`,
      )
      expect(stacked[0]?.count).toBe(3)

      await apply((tx) =>
        mutators.retroVote.retract.fn({
          tx,
          args: { id: first, updatedAt: Date.now() },
          ctx: OTHER,
        }),
      )
      const refunded = await rows(
        sql<{ count: number }>`select count from retro_vote_tally where target_id = ${cardId}`,
      )
      expect(refunded[0]?.count).toBe(2)
      expect(await countOf('retro_vote', 'voter_id', OTHER.userID)).toBe(2)
    })

    it('refuses a dot on a grouped card, and refuses another voter’s retraction', async () => {
      const first = await draft(MEMBER, 'First', 'a1')
      const second = await draft(MEMBER, 'Second', 'a2')
      await moveTo('group')
      const groupId = await group([first, second])
      await moveTo('vote')

      expect(await rejection(vote(OTHER, 'card', first))).toBe(MutationErrorCode.invalidTarget)

      const dot = await vote(OTHER, 'group', groupId)
      expect(
        await rejection(
          apply((tx) =>
            mutators.retroVote.retract.fn({
              tx,
              args: { id: dot, updatedAt: Date.now() },
              ctx: MEMBER,
            }),
          ),
        ),
      ).toBe(MutationErrorCode.notAuthorized)
      expect(await countOf('retro_vote', 'id', dot)).toBe(1)
    })

    it('refuses a viewer entirely', async () => {
      const cardId = await draft(MEMBER, 'Card', 'a1')
      await moveTo('vote')
      expect(await rejection(vote(VIEWER, 'card', cardId))).toBe(MutationErrorCode.notAuthorized)
    })
  })

  describe('an action becomes a real issue', () => {
    async function action(body: string): Promise<string> {
      const id = newId()
      await apply((tx) =>
        mutators.retroAction.create.fn({
          tx,
          args: { id, retroId, body, createdAt: Date.now(), updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
      return id
    }

    it('creates a numbered issue in the next cycle and is idempotent', async () => {
      await moveTo('discuss')
      const actionId = await action('Split the deploy step in two')
      const issueId = newId()

      await apply((tx) =>
        mutators.retro.convertActionToIssue.fn({
          tx,
          args: { actionId, issueId, createdAt: Date.now(), updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )

      const issue = await rows(
        sql<{
          id: string
          number: number | null
          cycle_id: string | null
          title: string
          needs_triage: boolean
        }>`
          select id, number, cycle_id, title, needs_triage from issue where id = ${issueId}
        `,
      )
      expect(issue[0]).toMatchObject({
        id: issueId,
        cycle_id: nextCycleId,
        title: 'Split the deploy step in two',
        needs_triage: false,
      })
      expect(issue[0]?.number).toBeGreaterThan(0)

      await apply((tx) =>
        mutators.retro.convertActionToIssue.fn({
          tx,
          args: { actionId, issueId: newId(), createdAt: Date.now(), updatedAt: Date.now() },
          ctx: FACILITATOR,
        }),
      )
      expect(await countOf('issue', 'team_id', teamId)).toBe(1)
    })

    it('refuses a viewer', async () => {
      await moveTo('discuss')
      const actionId = await action('Never converted')
      const code = await rejection(
        apply((tx) =>
          mutators.retro.convertActionToIssue.fn({
            tx,
            args: { actionId, issueId: newId(), createdAt: Date.now(), updatedAt: Date.now() },
            ctx: VIEWER,
          }),
        ),
      )
      expect(code).toBe(MutationErrorCode.notAuthorized)
      expect(await countOf('issue', 'team_id', teamId)).toBe(0)
    })
  })

  describe('card deletion authority', () => {
    it('lets a card’s own author delete it, and nobody else', async () => {
      const mine = await draft(MEMBER, 'Mine', 'a1')
      const theirs = await draft(OTHER, 'Theirs', 'a2')
      await moveTo('group')

      const stranger = await rejection(
        apply((tx) => mutators.retroCard.delete.fn({ tx, args: { id: theirs }, ctx: MEMBER })),
      )
      expect(stranger).toBe(MutationErrorCode.notAuthorized)
      expect(await countOf('retro_card', 'id', theirs)).toBe(1)

      await apply((tx) => mutators.retroCard.delete.fn({ tx, args: { id: mine }, ctx: MEMBER }))
      expect(await countOf('retro_card', 'id', mine)).toBe(0)
      expect(await countOf('retro_card_author', 'card_id', mine)).toBe(0)
    })
  })

  describe('one retro per cycle', () => {
    it('is a no-op when the cycle already has one', async () => {
      const second = newId()
      await apply((tx) =>
        mutators.retro.openForCycle.fn({
          tx,
          args: {
            id: second,
            cycleId,
            format: 'wentwell_didnt_action',
            columns: retroColumnTemplate('wentwell_didnt_action').map((column, index) => ({
              id: newId(),
              key: column.key,
              title: column.title,
              accentToken: column.accentToken,
              rank: `a${index}`,
            })),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ctx: ADMIN,
        }),
      )
      expect(await countOf('retro', 'cycle_id', cycleId)).toBe(1)
      expect(await countOf('retro', 'id', second)).toBe(0)
    })
  })
})
