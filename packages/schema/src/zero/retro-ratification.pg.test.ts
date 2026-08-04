import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext, RetroPhase, RetroProposalVerdict } from './context.js'
import { MutationErrorCode, mutationErrorCode } from './errors.js'
import { queries } from './queries.js'
import { retroColumnTemplate } from './retro/phase.js'
import { retroProposalVerdict } from './retro/ratify.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the ratification proof must not be skipped')
}

// THE RATIFICATION PROOF (change 19). Four claims, none of which a stubbed transaction can settle,
// because each is about what real rows do to one another:
//
//   1. Two members react at the same moment and the verdict computed at `vote -> discuss` matches a
//      hand-count of the reaction rows — AND the recorded SQL contains no counter write of any
//      shape, so "tallies are never incrementally maintained" is a fact about the statements this
//      code issues rather than a claim in a comment.
//   2. A member's reaction row reaches its author and NOBODY else: not another member of the team,
//      and — the deviation this change is most likely to lose in review — not a workspace admin.
//   3. A converted improvement's issue carries a NULL assignee, through the shipped conversion path
//      with its server-assigned per-team number.
//   4. Stepping back to `vote` clears the derived stamp and keeps every reaction, so the next
//      advance recounts rather than remembering.
describe.skipIf(DATABASE_URL === undefined)('retro ratification against Postgres', () => {
  // Every statement Kysely issues, including the ones the mutators issue through the wrapped
  // transaction. Snapshotted around a call so a test can assert on what the reaction path itself
  // did, rather than on the whole run.
  const statements: string[] = []
  const database: Database = createDatabase({
    connectionString: DATABASE_URL ?? '',
    log: (event) => {
      if (event.level === 'query') statements.push(event.message)
    },
  })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()
  const cycleId = newId()
  const nextCycleId = newId()

  const FACILITATOR: AuthContext = { userID: `facilitator-${newId()}`, role: 'member' }
  const A: AuthContext = { userID: `member-a-${newId()}`, role: 'member' }
  const B: AuthContext = { userID: `member-b-${newId()}`, role: 'member' }
  const C: AuthContext = { userID: `member-c-${newId()}`, role: 'member' }
  const D: AuthContext = { userID: `member-d-${newId()}`, role: 'member' }
  const VIEWER: AuthContext = { userID: `viewer-${newId()}`, role: 'viewer' }
  // A workspace admin who is deliberately NOT in the team: `teamScoped` would hand this principal
  // every team's work data, and the whole point of the reaction query is that it does not.
  const ADMIN: AuthContext = { userID: `admin-${newId()}`, role: 'admin' }
  // A workspace member in no team at all — denied by the `isMember` gate's empty query rather than
  // by a scope, which is the other way this query can go wrong.
  const OUTSIDER: AuthContext = { userID: `outsider-${newId()}`, role: 'member' }

  let meta: PgSchemaMeta
  let retroId: string
  let draftId: string
  let proposalIds: string[]

  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  async function rows<T>(query: ReturnType<typeof sql<T>>): Promise<T[]> {
    const { rows: result } = await query.execute(database.db)
    return result
  }

  async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
    try {
      await promise
    } catch (thrown) {
      return mutationErrorCode(thrown)
    }
    return undefined
  }

  // Records every statement issued while `run` is in flight. The reaction path is small enough that
  // an exhaustive assertion over this list is meaningful rather than a substring hunt.
  async function record(run: () => Promise<unknown>): Promise<string[]> {
    const from = statements.length
    await run()
    return statements.slice(from)
  }

  async function react(ctx: AuthContext, proposalId: string, value: 'agree' | 'disagree') {
    const now = Date.now()
    await apply((tx) =>
      mutators.retroAiReaction.set.fn({
        tx,
        args: { proposalId, value, createdAt: now, updatedAt: now },
        ctx,
      }),
    )
  }

  async function clearReaction(ctx: AuthContext, proposalId: string) {
    await apply((tx) => mutators.retroAiReaction.clear.fn({ tx, args: { proposalId }, ctx }))
  }

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

  interface StampedProposal {
    id: string
    category: string
    verdict: RetroProposalVerdict | null
    agree_count: number | null
    disagree_count: number | null
    ratified_at: Date | null
  }

  async function stamped(): Promise<StampedProposal[]> {
    return await rows(
      sql<StampedProposal>`
        select id, category, verdict, agree_count, disagree_count, ratified_at
        from retro_ai_proposal where retro_id = ${retroId} order by rank
      `,
    )
  }

  // The hand-count the stored verdict is compared against: read straight off the reaction rows and
  // reduced in the test, then handed to the SAME pure rule the server used. If the rule and the
  // stored value ever disagree, one of them wrote a number nobody counted.
  async function handCount(proposalId: string): Promise<{
    agree: number
    disagree: number
    verdict: RetroProposalVerdict
  }> {
    const reactions = await rows(
      sql<{
        value: 'agree' | 'disagree'
      }>`select value from retro_ai_reaction where proposal_id = ${proposalId}`,
    )
    const agree = reactions.filter((row) => row.value === 'agree').length
    const disagree = reactions.length - agree
    return { agree, disagree, verdict: retroProposalVerdict(agree, disagree) }
  }

  async function myReactions(
    ctx: AuthContext | undefined,
  ): Promise<{ proposalId: string; userId: string; value: string }[]> {
    const query = queries.retroAiReactions.mine.fn({
      args: { retroId },
      ctx,
    }) as unknown as BuiltQuery
    const result = await apply(async (tx) => await tx.run(query as never))
    return result as unknown as { proposalId: string; userId: string; value: string }[]
  }

  async function openRetro(): Promise<void> {
    retroId = newId()
    const columnIds = retroColumnTemplate('wentwell_didnt_action').map(() => newId())
    await apply((tx) =>
      mutators.retro.openForCycle.fn({
        tx,
        args: {
          id: retroId,
          cycleId,
          nextCycleId,
          format: 'wentwell_didnt_action',
          isAnonymous: false,
          votesPerParticipant: 3,
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

  // The draft is seeded straight into Postgres, exactly as the e2e seeds one: the generating tail
  // needs a provider key, and everything this file is about happens downstream of the rows.
  async function seedDraft(): Promise<void> {
    draftId = newId()
    await sql`
      insert into retro_ai_draft (id, retro_id, team_id, status, provider, model, estimated_cost_usd)
      values (${draftId}, ${retroId}, ${teamId}, 'ready', 'anthropic', 'test-model', 0.01)
    `.execute(database.db)
    proposalIds = [newId(), newId(), newId()]
    const categories = ['win', 'loss', 'improvement']
    for (const [rank, id] of proposalIds.entries()) {
      await sql`
        insert into retro_ai_proposal (id, draft_id, retro_id, team_id, category, summary, confidence, rank)
        values (
          ${id}, ${draftId}, ${retroId}, ${teamId}, ${categories[rank] as string},
          ${`Proposal ${rank}`}, 'high', ${rank}
        )
      `.execute(database.db)
    }
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'retro-ratification')`.execute(
      database.db,
    )
    const stamp = `${Date.now() % 1_000}`.padStart(3, '0')
    await sql`
      insert into team (id, workspace_id, name, key)
      values (${teamId}, ${workspaceId}, 'Ratify', ${`RR${stamp}`})
    `.execute(database.db)
    for (const ctx of [FACILITATOR, A, B, C, D, VIEWER, ADMIN, OUTSIDER]) {
      await sql`
        insert into workspace_member (id, workspace_id, user_id, role)
        values (${newId()}, ${workspaceId}, ${ctx.userID}, ${ctx.role})
      `.execute(database.db)
    }
    for (const ctx of [FACILITATOR, A, B, C, D, VIEWER]) {
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
    statements.length = 0
    await openRetro()
    await seedDraft()
  })

  describe('the verdict is computed once, and matches a hand-count', () => {
    // THE FALSIFIABLE CHECK. Two members react to the SAME proposal from two transactions started
    // together, then the facilitator advances. There is no shared row for them to contend on —
    // `(proposal_id, user_id)` gives each of them their own — so both survive and both are counted.
    it('counts two concurrent reactions on one proposal, writing no counter on the way', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]

      const issued = await record(async () => {
        await Promise.all([react(A, first, 'agree'), react(B, first, 'disagree')])
      })

      const stored = await rows(
        sql<{
          user_id: string
          value: string
        }>`select user_id, value from retro_ai_reaction where proposal_id = ${first} order by value`,
      )
      expect(stored).toEqual([
        { user_id: A.userID, value: 'agree' },
        { user_id: B.userID, value: 'disagree' },
      ])

      // The reaction path touched ONE table and issued no aggregate write of any kind. The shape
      // being ruled out is `bumpRetroVoteTally`'s — `set count = count + n` — and, more broadly,
      // any write at all to the proposal row while a reaction is being recorded.
      const writes = issued.filter((line) => /^\s*(insert|update|delete)\b/i.test(line.trim()))
      expect(writes.length).toBeGreaterThan(0)
      for (const write of writes) {
        expect(write, 'a reaction wrote a table other than retro_ai_reaction').toMatch(
          /retro_ai_reaction/i,
        )
      }
      expect(issued.filter((line) => /set\s+[\w".]*count/i.test(line))).toEqual([])
      expect(issued.filter((line) => /retro_vote_tally/i.test(line))).toEqual([])
      expect(issued.filter((line) => /update\s+"?retro_ai_proposal"?/i.test(line))).toEqual([])

      await moveTo('discuss')
      const [proposal] = await stamped()
      const counted = await handCount(first)
      expect(proposal?.agree_count).toBe(counted.agree)
      expect(proposal?.disagree_count).toBe(counted.disagree)
      expect(proposal?.verdict).toBe(counted.verdict)
      expect(proposal?.verdict).toBe('contested')
      expect(proposal?.ratified_at).not.toBeNull()
    })

    // The rule, exercised over real rows rather than in the unit table: every proposal in one retro,
    // each with a different distribution, all stamped in the one pass.
    it('stamps every proposal from the same single read, each by the fixed rule', async () => {
      await moveTo('vote')
      const [win, loss] = proposalIds as [string, string, string]
      // Unanimous among responders.
      await react(A, win, 'agree')
      await react(B, win, 'agree')
      // A strict majority against.
      await react(A, loss, 'disagree')
      await react(B, loss, 'disagree')
      await react(C, loss, 'agree')
      // Nobody responded to `improvement`.

      await moveTo('discuss')
      const stamps = await stamped()

      for (const proposal of stamps) {
        const counted = await handCount(proposal.id)
        expect(proposal.agree_count).toBe(counted.agree)
        expect(proposal.disagree_count).toBe(counted.disagree)
        expect(proposal.verdict).toBe(counted.verdict)
      }
      expect(stamps.map((proposal) => proposal.verdict)).toEqual(['agreed', 'rejected', 'unrated'])
      // Silence is never rendered as consent.
      expect(stamps[2]).toMatchObject({ agree_count: 0, disagree_count: 0 })
    })

    // The minority veto, which is the entire reason the ceremony exists — and there is no setting
    // anywhere that could turn four-against-one into agreement.
    it('makes one disagree among four agrees contested, not agreed', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]
      for (const ctx of [A, B, C, FACILITATOR]) await react(ctx, first, 'agree')
      await react(D, first, 'disagree')

      await moveTo('discuss')
      const [proposal] = await stamped()
      const counted = await handCount(first)
      expect(counted).toMatchObject({ agree: 4, disagree: 1 })
      expect(proposal?.verdict).toBe('contested')
      expect(proposal?.agree_count).toBe(4)
      expect(proposal?.disagree_count).toBe(1)
    })

    it('replaces a member’s reaction rather than accumulating it', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]
      await react(A, first, 'agree')
      await react(A, first, 'disagree')

      const stored = await rows(
        sql<{
          value: string
        }>`select value from retro_ai_reaction where proposal_id = ${first} and user_id = ${A.userID}`,
      )
      expect(stored).toEqual([{ value: 'disagree' }])
    })

    it('counts a reaction made during group alongside one made during vote', async () => {
      await moveTo('group')
      const [first] = proposalIds as [string, string, string]
      await react(A, first, 'agree')
      await moveTo('vote')
      await react(B, first, 'agree')

      await moveTo('discuss')
      const [proposal] = await stamped()
      expect(proposal).toMatchObject({ verdict: 'agreed', agree_count: 2, disagree_count: 0 })
    })

    it('refuses a reaction once the window is shut, leaving the stamp alone', async () => {
      await moveTo('discuss')
      const [first] = proposalIds as [string, string, string]
      const code = await rejection(react(A, first, 'agree'))
      expect(code).toBe(MutationErrorCode.invalidPhase)
      expect(
        await rows(
          sql<{
            n: string
          }>`select count(*) as n from retro_ai_reaction where proposal_id = ${first}`,
        ),
      ).toEqual([{ n: '0' }])
    })

    it('refuses a viewer, with no row written', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]
      expect(await rejection(react(VIEWER, first, 'agree'))).toBe(MutationErrorCode.notAuthorized)
      expect(await rejection(react(OUTSIDER, first, 'agree'))).toBe(MutationErrorCode.notAuthorized)
      expect(
        await rows(
          sql<{
            n: string
          }>`select count(*) as n from retro_ai_reaction where proposal_id = ${first}`,
        ),
      ).toEqual([{ n: '0' }])
    })

    // The opted-out case: a retro with no draft advances exactly as it did before this change.
    it('does no ratification work for a retro with no proposals', async () => {
      await sql`delete from retro_ai_draft where retro_id = ${retroId}`.execute(database.db)
      await moveTo('vote')
      const issued = await record(async () => {
        await moveTo('discuss')
      })
      expect(issued.filter((line) => /retro_ai_reaction/i.test(line))).toEqual([])
      expect(issued.filter((line) => /update\s+"?retro_ai_proposal"?/i.test(line))).toEqual([])
    })
  })

  describe('stepping back clears the stamp and keeps every reaction', () => {
    it('nulls all four columns, survives every reaction row, and recounts on the way forward', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]
      await react(A, first, 'agree')
      await moveTo('discuss')
      expect((await stamped())[0]).toMatchObject({ verdict: 'agreed', agree_count: 1 })

      await moveTo('vote')
      const cleared = (await stamped())[0]
      expect(cleared).toMatchObject({
        verdict: null,
        agree_count: null,
        disagree_count: null,
        ratified_at: null,
      })
      // The reactions are what each member SAID. Only the derived stamp is cleared.
      expect(
        await rows(
          sql<{
            n: string
          }>`select count(*) as n from retro_ai_reaction where retro_id = ${retroId}`,
        ),
      ).toEqual([{ n: '1' }])

      // The window is open again, and the second advance counts the reaction added in between.
      await react(B, first, 'disagree')
      await moveTo('discuss')
      const recounted = (await stamped())[0]
      const counted = await handCount(first)
      expect(recounted?.agree_count).toBe(counted.agree)
      expect(recounted?.disagree_count).toBe(counted.disagree)
      expect(recounted?.verdict).toBe('contested')
    })

    it('lets a member withdraw, and counts them as not having responded', async () => {
      await moveTo('vote')
      const [first] = proposalIds as [string, string, string]
      await react(A, first, 'agree')
      await clearReaction(A, first)
      // Clearing twice is a no-op, not an error: the palette acts on a focus snapshot that can be
      // stale by the time it is used.
      await clearReaction(A, first)

      await moveTo('discuss')
      expect((await stamped())[0]).toMatchObject({
        verdict: 'unrated',
        agree_count: 0,
        disagree_count: 0,
      })
    })
  })

  describe('a reaction row reaches its author and nobody else', () => {
    beforeEach(async () => {
      await moveTo('vote')
      const [first, second] = proposalIds as [string, string, string]
      await react(A, first, 'agree')
      await react(B, first, 'disagree')
      await react(B, second, 'agree')
    })

    it('gives the author their own row and only their own', async () => {
      const mine = await myReactions(A)
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({ userId: A.userID, value: 'agree' })
    })

    it('gives another member of the same team none of the author’s rows', async () => {
      const theirs = await myReactions(B)
      // Not a query that returns nothing for everyone: B reads B's two rows and neither is A's.
      expect(theirs).toHaveLength(2)
      expect(theirs.every((row) => row.userId === B.userID)).toBe(true)
      expect(theirs.some((row) => row.userId === A.userID)).toBe(false)
    })

    // THE NO-ADMIN-BYPASS DEVIATION, ASSERTED EXPLICITLY. Written as `teamScoped` this query would
    // look completely normal in review and this is the only test that would notice: an admin who
    // reads every issue in the workspace reads not one reaction here.
    it('gives a workspace admin zero rows, unlike every teamScoped query', async () => {
      expect(await myReactions(ADMIN)).toEqual([])
      // The same admin's blanket read really does reach this retro's AI rows — otherwise the line
      // above would pass for a principal who reads nothing anywhere and prove nothing at all. The
      // proposals are `teamScoped` and arrive; the reactions on those very proposals do not.
      const proposals = (await apply(
        async (tx) =>
          await tx.run(
            queries.retroAiProposals.byRetro.fn({
              args: { retroId },
              ctx: ADMIN,
            }) as unknown as never,
          ),
      )) as unknown[]
      expect(proposals).toHaveLength(3)
    })

    it('gives a member who reacted to nothing an empty result rather than the team’s', async () => {
      expect(await myReactions(C)).toEqual([])
    })

    it('denies a non-member and an unauthenticated caller by empty query', async () => {
      expect(await myReactions(OUTSIDER)).toEqual([])
      expect(await myReactions(undefined)).toEqual([])
      expect(await myReactions({ userID: A.userID, role: null })).toEqual([])
    })
  })

  describe('an agreed improvement becomes an issue with no owner', () => {
    // THE FALSIFIABLE CHECK. `retro_action.assignee_id` exists and the create path accepts one; the
    // AI path passes none, and `convertActionToIssue` forwards that null unchanged. A suggested
    // owner would be the first per-person output anywhere in the AI layer.
    it('converts to a numbered issue whose assignee is null', async () => {
      await moveTo('vote')
      const improvement = (proposalIds as [string, string, string])[2]
      await react(A, improvement, 'agree')
      await moveTo('discuss')
      expect((await stamped())[2]).toMatchObject({ verdict: 'agreed' })

      const actionId = newId()
      await apply((tx) =>
        mutators.retroAction.create.fn({
          tx,
          args: {
            id: actionId,
            retroId,
            body: 'Hold scope where it was this cycle',
            aiProposalId: improvement,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ctx: A,
        }),
      )
      const action = await rows(
        sql<{
          assignee_id: string | null
          ai_proposal_id: string | null
        }>`select assignee_id, ai_proposal_id from retro_action where id = ${actionId}`,
      )
      expect(action[0]).toEqual({ assignee_id: null, ai_proposal_id: improvement })

      const issueId = newId()
      await apply((tx) =>
        mutators.retro.convertActionToIssue.fn({
          tx,
          args: { actionId, issueId, createdAt: Date.now(), updatedAt: Date.now() },
          ctx: A,
        }),
      )
      const issue = await rows(
        sql<{
          assignee_id: string | null
          number: number | null
          cycle_id: string | null
        }>`select assignee_id, number, cycle_id from issue where id = ${issueId}`,
      )
      expect(issue[0]?.assignee_id).toBeNull()
      // Through the SHIPPED path, unchanged: the number is the server's, not the client's.
      expect(issue[0]?.number).toBeGreaterThan(0)
      expect(issue[0]?.cycle_id).toBe(nextCycleId)

      // Idempotent, exactly as it already was.
      await apply((tx) =>
        mutators.retro.convertActionToIssue.fn({
          tx,
          args: { actionId, issueId: newId(), createdAt: Date.now(), updatedAt: Date.now() },
          ctx: A,
        }),
      )
      expect(
        await rows(sql<{ n: string }>`select count(*) as n from issue where team_id = ${teamId}`),
      ).toEqual([{ n: '1' }])
    })

    // `on delete set null`, not cascade: the facilitator's step back discards the AI draft, and the
    // human's action item is not the AI's to delete.
    it('keeps the action when the draft is discarded, losing only the provenance', async () => {
      await moveTo('discuss')
      const improvement = (proposalIds as [string, string, string])[2]
      const actionId = newId()
      await apply((tx) =>
        mutators.retroAction.create.fn({
          tx,
          args: {
            id: actionId,
            retroId,
            body: 'Survives the discard',
            aiProposalId: improvement,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
          ctx: A,
        }),
      )

      await moveTo('group')
      await moveTo('brainstorm')

      expect(
        await rows(
          sql<{
            n: string
          }>`select count(*) as n from retro_ai_proposal where retro_id = ${retroId}`,
        ),
      ).toEqual([{ n: '0' }])
      const action = await rows(
        sql<{
          body: string
          ai_proposal_id: string | null
        }>`select body, ai_proposal_id from retro_action where id = ${actionId}`,
      )
      expect(action[0]).toEqual({ body: 'Survives the discard', ai_proposal_id: null })
    })

    // A proposal id is a client-supplied argument like any other, so it is validated to name a
    // proposal in THIS retro — provenance never crosses a retro boundary.
    it('refuses a proposal that belongs to another retro', async () => {
      const thisRetro = retroId
      await moveTo('discuss')

      // A second retro on the same team, opened through the real mutator, with its own proposal.
      const foreignRetroId = newId()
      const template = retroColumnTemplate('wentwell_didnt_action')
      await apply((tx) =>
        mutators.retro.openForCycle.fn({
          tx,
          args: {
            id: foreignRetroId,
            cycleId: nextCycleId,
            format: 'wentwell_didnt_action',
            columns: template.map((column, index) => ({
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
      const foreignDraft = newId()
      const foreign = newId()
      await sql`
        insert into retro_ai_draft (id, retro_id, team_id, status)
        values (${foreignDraft}, ${foreignRetroId}, ${teamId}, 'ready')
      `.execute(database.db)
      await sql`
        insert into retro_ai_proposal (id, draft_id, retro_id, team_id, category, summary, confidence, rank)
        values (${foreign}, ${foreignDraft}, ${foreignRetroId}, ${teamId}, 'improvement', 'Elsewhere', 'high', 0)
      `.execute(database.db)

      const code = await rejection(
        apply((tx) =>
          mutators.retroAction.create.fn({
            tx,
            args: {
              id: newId(),
              retroId: thisRetro,
              body: 'Wrong retro',
              aiProposalId: foreign,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
            ctx: A,
          }),
        ),
      )
      expect(code).toBe(MutationErrorCode.invalidTarget)
    })
  })
})
