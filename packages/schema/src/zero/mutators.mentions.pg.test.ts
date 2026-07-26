import type { ReadonlyJSONValue } from '@rocicorp/zero'
import { type Kysely, sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import type { DB } from '../db/types.js'
import { newId } from '../id.js'
import { buildMutatorToolSpecs } from './ai-tools.js'
import type { AuthContext } from './context.js'
import { queries } from './queries.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'
import type { BuiltQuery } from './testing/query-ast.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the mention fan-out proof must not be skipped')
}

// THE FALSIFIABLE CHECK for the mentions change (design.md "How we will know this worked").
//
// Every claim here is a claim about POSTGRES, which is why it is an integration test rather than a
// mocked transaction: the composite primary key that makes an edit notify once, the
// `on conflict do nothing` that makes an unfollow stick, and the cross-producer dedup between the
// mention fan-out and the involvement fan-out are all database behaviours. A stubbed transaction
// would assert them into existence rather than verify them.
//
// Each numbered step fails for a DIFFERENT specific defect:
//
//   * step 1 fails if eligibility is not enforced server-side (C, who cannot read the issue, is
//     told) or if a self-mention notifies its own author.
//   * step 2 fails if the diff is a set of ALL mentions rather than the newly ADDED ones.
//   * step 3 is the `event_key` proof: it fails under `String(args.updatedAt)`, the plausible and
//     wrong choice, which re-notifies on every save.
//   * step 4 is the mail-trap proof: it fails under a `DELETE`-based unfollow, the plausible and
//     wrong refactor, which lets the next `@` silently resurrect the subscription.
//   * step 5 fails if the subscriber producer invents its own kind — a different kind is a
//     different primary key, so a subscriber who is also the assignee would get two rows.
//   * step 6 fails if the fan-out escapes the `tx.location === 'server'` guard and writes during
//     the optimistic rebase pass.
describe.skipIf(DATABASE_URL === undefined)('mention fan-out against Postgres', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const teamId = newId()

  // A, B and E are on team T. C is a workspace member who is NOT — mentioning them must be
  // impossible. D is a workspace ADMIN who is not on T: an admin genuinely can read the issue, so
  // the eligibility rule mirrors `teamScoped` INCLUDING its bypass, and D is the assertion that
  // proves the bypass was not quietly dropped.
  const A: AuthContext = { userID: `actor-a-${newId()}`, role: 'member' }
  const B: AuthContext = { userID: `member-b-${newId()}`, role: 'member' }
  const C: AuthContext = { userID: `outsider-c-${newId()}`, role: 'member' }
  const D: AuthContext = { userID: `admin-d-${newId()}`, role: 'admin' }
  const E: AuthContext = { userID: `member-e-${newId()}`, role: 'member' }
  const everyone = [A, B, C, D, E]

  let meta: PgSchemaMeta
  let issueId: string

  async function apply<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db
      .transaction()
      .execute(async (trx) => await run(createPgServerTransaction(trx, meta)))
  }

  // The same Postgres-backed transaction relabelled as the OPTIMISTIC pass. `dbTransaction` is
  // still present and still usable, so an unguarded fan-out would write real rows here — which is
  // what makes "zero rows" a fact about the guard rather than about a transaction that could not
  // have written anyway.
  async function applyAsClient<T>(
    run: (tx: ReturnType<typeof createPgServerTransaction>) => Promise<T>,
  ): Promise<T> {
    return await database.db.transaction().execute(async (trx) => {
      const server = createPgServerTransaction(trx, meta)
      return await run({ ...server, location: 'client', reason: 'optimistic' } as typeof server)
    })
  }

  async function rows<T>(query: ReturnType<typeof sql<T>>): Promise<T[]> {
    const { rows: result } = await query.execute(database.db)
    return result
  }

  interface NotificationRow {
    recipient_id: string
    kind: string
    event_key: string
    subject_key: string | null
  }

  async function notifications(kind?: string): Promise<NotificationRow[]> {
    const filter = kind === undefined ? sql`true` : sql`kind = ${kind}`
    return await rows(
      sql<NotificationRow>`
        select recipient_id, kind, event_key, subject_key from notification
        where team_id = ${teamId}::uuid and ${filter}
        order by recipient_id, event_key
      `,
    )
  }

  async function recipientsOf(kind: string): Promise<string[]> {
    return (await notifications(kind)).map((row) => row.recipient_id).sort()
  }

  interface SubscriptionRow {
    user_id: string
    state: string
  }

  async function subscriptions(): Promise<SubscriptionRow[]> {
    return await rows(
      sql<SubscriptionRow>`
        select user_id, state from issue_subscription
        where team_id = ${teamId}::uuid order by user_id
      `,
    )
  }

  async function subscribed(): Promise<string[]> {
    return (await subscriptions())
      .filter((row) => row.state === 'subscribed')
      .map((row) => row.user_id)
      .sort()
  }

  // A document exactly as the editor stores one: mention nodes are inline atoms carrying the
  // mentioned person's ID, never their name — a name would rot on the next rename and could not be
  // permission-checked at render.
  function doc(...parts: (string | AuthContext)[]): ReadonlyJSONValue {
    return {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: parts.map((part) =>
            typeof part === 'string'
              ? { type: 'text', text: part }
              : {
                  type: 'mention',
                  attrs: { id: part.userID, label: part.userID, mentionSuggestionChar: '@' },
                },
          ),
        },
      ],
    }
  }

  async function createAuthUserTable(db: Kysely<DB>): Promise<void> {
    await sql`
      create table if not exists "user" (
        "id" text not null primary key,
        "name" text not null,
        "email" text not null unique,
        "emailVerified" boolean not null,
        "image" text,
        "createdAt" timestamptz default current_timestamp not null,
        "updatedAt" timestamptz default current_timestamp not null
      )
    `.execute(db)
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await createAuthUserTable(database.db)
    meta = await readPgSchemaMeta(database.db)

    await sql`insert into workspace (id, name) values (${workspaceId}, 'mention-pg-test')`.execute(
      database.db,
    )
    const stamp = Date.now() % 10_000
    await sql`
      insert into team (id, workspace_id, name, key) values (${teamId}, ${workspaceId}, 'Engineering', ${`MN${stamp}`})
    `.execute(database.db)

    for (const ctx of everyone) {
      await sql`
        insert into "user" (id, name, email, "emailVerified")
        values (${ctx.userID}, ${ctx.userID}, ${`${ctx.userID}@example.test`}, true)
      `.execute(database.db)
    }
    await sql`
      insert into workspace_member (id, workspace_id, user_id, role) values
        (${newId()}, ${workspaceId}, ${A.userID}, 'member'),
        (${newId()}, ${workspaceId}, ${B.userID}, 'member'),
        (${newId()}, ${workspaceId}, ${C.userID}, 'member'),
        (${newId()}, ${workspaceId}, ${D.userID}, 'admin'),
        (${newId()}, ${workspaceId}, ${E.userID}, 'member')
    `.execute(database.db)
    await sql`
      insert into team_membership (id, team_id, user_id) values
        (${newId()}, ${teamId}, ${A.userID}),
        (${newId()}, ${teamId}, ${B.userID}),
        (${newId()}, ${teamId}, ${E.userID})
    `.execute(database.db)
  }, 60_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    for (const ctx of everyone) {
      await sql`delete from "user" where id = ${ctx.userID}`.execute(database.db)
    }
    await database.close()
  })

  // Every test starts from an issue A created through the real mutator, so its per-team number is
  // claimed and `subject_key` is the `MN1234-1` a recipient actually reads.
  beforeEach(async () => {
    await sql`delete from notification where team_id = ${teamId}::uuid`.execute(database.db)
    await sql`delete from issue_subscription where team_id = ${teamId}::uuid`.execute(database.db)
    await sql`delete from comment where team_id = ${teamId}::uuid`.execute(database.db)
    await sql`delete from issue where team_id = ${teamId}::uuid`.execute(database.db)

    issueId = newId()
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id: issueId,
          teamId,
          title: 'Reconnect loop freezes the board',
          status: 'todo' as const,
          priority: 'no_priority' as const,
          createdAt: 1000,
          updatedAt: 1000,
        },
        ctx: A,
      }),
    )
    await sql`delete from notification where team_id = ${teamId}::uuid`.execute(database.db)
  })

  // The sequence from design.md, asserted in order in ONE test because each step's precondition is
  // the previous step's effect — splitting it would either re-run the whole prefix per assertion or
  // silently depend on test ordering.
  it('runs the whole sequence: eligibility, added-only, stable key, sticky unfollow, dedup', async () => {
    const commentId = newId()

    // 1. A posts a comment mentioning B, C, D and A.
    await apply((tx) =>
      mutators.comment.create.fn({
        tx,
        args: {
          id: commentId,
          issueId,
          body: doc('ping ', B, ' ', C, ' ', D, ' and ', A),
          createdAt: 2000,
          updatedAt: 2000,
        },
        ctx: A,
      }),
    )

    // B is on the team and D is a workspace admin, so both can read the issue. C cannot, and is not
    // told — enforced server-side, because the document is user-controlled JSON that a paste or a
    // stale client would carry straight past a typeahead check. A is the author.
    expect(await recipientsOf('mention')).toEqual([B.userID, D.userID].sort())
    expect(await subscribed()).toEqual([B.userID, D.userID].sort())
    // The key the inbox renders, snapshotted at write time rather than left null.
    for (const row of await notifications('mention')) {
      expect(row.subject_key).toMatch(/^MN\d+-\d+$/u)
      expect(row.event_key).toBe(commentId)
    }

    // 2. A edits the comment, keeping B's mention and adding E's.
    await apply((tx) =>
      mutators.comment.edit.fn({
        tx,
        args: { id: commentId, body: doc('ping ', B, ' and ', E), updatedAt: 3000 },
        ctx: A,
      }),
    )
    expect(await recipientsOf('mention')).toEqual([B.userID, D.userID, E.userID].sort())
    expect(await subscribed()).toEqual([B.userID, D.userID, E.userID].sort())

    // 3. A re-saves the identical body. Nothing at all.
    const beforeResave = await notifications()
    await apply((tx) =>
      mutators.comment.edit.fn({
        tx,
        args: { id: commentId, body: doc('ping ', B, ' and ', E), updatedAt: 4000 },
        ctx: A,
      }),
    )
    expect(await notifications()).toEqual(beforeResave)

    // 4. B unfollows. Then A removes B's mention and adds it back — the exact edit that would
    // resurrect a DELETE-based subscription, and the exact edit whose second half a per-save
    // `event_key` would notify on.
    await apply((tx) =>
      mutators.issueSubscription.unfollow.fn({ tx, args: { issueId, updatedAt: 5000 }, ctx: B }),
    )
    await apply((tx) =>
      mutators.comment.edit.fn({
        tx,
        args: { id: commentId, body: doc('ping ', E), updatedAt: 6000 },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.comment.edit.fn({
        tx,
        args: { id: commentId, body: doc('ping ', B, ' and ', E), updatedAt: 7000 },
        ctx: A,
      }),
    )

    const afterReAdd = await subscriptions()
    expect(afterReAdd.find((row) => row.user_id === B.userID)?.state).toBe('unsubscribed')
    expect(await subscribed()).toEqual([D.userID, E.userID].sort())
    // And B was not told a second time: the comment's own id is the event key, so the primary key
    // absorbs the re-add.
    expect(
      (await notifications('mention')).filter((row) => row.recipient_id === B.userID),
    ).toHaveLength(1)

    // B reads their own subscription through the registered synced query and sees it turned off —
    // which is what keeps the unfollow control visible and the mail trap closed.
    const mine = (await runQueryAs(queries.subscriptions.mine, { issueId }, B)) as unknown as
      | { userId: string; state: string }
      | undefined
    expect(mine).toMatchObject({ userId: B.userID, state: 'unsubscribed' })
    // Nobody reads anybody else's: D's row exists, and B's self-scoped query does not return it.
    expect(mine?.userId).not.toBe(D.userID)

    // 5. A becomes the assignee AND an explicit follower, then E comments.
    await apply((tx) =>
      mutators.issue.assign.fn({
        tx,
        args: { id: issueId, assigneeId: A.userID, updatedAt: 8000 },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issueSubscription.follow.fn({ tx, args: { issueId, updatedAt: 8100 }, ctx: A }),
    )
    await sql`delete from notification where team_id = ${teamId}::uuid and kind <> 'mention'`.execute(
      database.db,
    )

    const secondCommentId = newId()
    await apply((tx) =>
      mutators.comment.create.fn({
        tx,
        args: {
          id: secondCommentId,
          issueId,
          body: doc('no names here'),
          createdAt: 9000,
          updatedAt: 9000,
        },
        ctx: E,
      }),
    )

    // Read WITHOUT filtering on the event key, so a producer that invented its own key shows up as
    // an extra row rather than disappearing from the query that was meant to catch it.
    const commented = await notifications('issue_commented')
    const told = commented.map((row) => row.recipient_id).sort()
    // D is subscribed and otherwise uninvolved — not the creator, not the assignee, never commented
    // — so this row exists only because the subscriber fan-out ran, and only because eligibility
    // kept the admin bypass. A is the creator, the assignee AND a follower. B unsubscribed and is
    // uninvolved, E is the actor, and C could never read the issue in the first place.
    expect(told).toEqual([A.userID, D.userID].sort())
    // THE CROSS-PRODUCER DEDUP. A is reached by BOTH producers for this one comment — the
    // involvement fan-out (creator and assignee) and the subscriber fan-out — and gets exactly one
    // row, because both emit the same kind with the SAME natural key. A separate `issue_activity`
    // kind, or a key the subscriber producer decorates, is the obvious alternative and doubles this.
    expect(commented.filter((row) => row.recipient_id === A.userID)).toHaveLength(1)
    for (const row of commented) expect(row.event_key).toBe(secondCommentId)

    // 5b. THE OTHER HALF OF "ONE COMMENT, ONE ROW". A comment that names an existing subscriber
    // reaches them twice unless the ambient producers are told to stand down: `mention` and
    // `issue_commented` are different kinds, so they are different primary keys and nothing
    // collapses them. Reading the subscriber set before subscribing anyone only covers the person
    // who was not already following.
    const thirdCommentId = newId()
    await apply((tx) =>
      mutators.comment.create.fn({
        tx,
        args: {
          id: thirdCommentId,
          issueId,
          body: doc('over to ', D),
          createdAt: 10_000,
          updatedAt: 10_000,
        },
        ctx: E,
      }),
    )

    const forThird = (await notifications()).filter((row) => row.event_key === thirdCommentId)
    // D was already subscribed AND is named by this comment: the mention, and nothing else.
    expect(forThird.filter((row) => row.recipient_id === D.userID).map((row) => row.kind)).toEqual([
      'mention',
    ])
    // A follows and is the assignee and the creator, and is not named — the ambient row still
    // reaches them, so the exclusion is targeted rather than a blanket suppression.
    expect(forThird.filter((row) => row.recipient_id === A.userID).map((row) => row.kind)).toEqual([
      'issue_commented',
    ])
  })

  // 6. The optimistic pass. The mutation lands; not one row of fan-out does.
  it('writes no notification and no subscription on the optimistic client pass', async () => {
    const commentId = newId()
    await applyAsClient((tx) =>
      mutators.comment.create.fn({
        tx,
        args: {
          id: commentId,
          issueId,
          body: doc('ping ', B, ' ', D),
          createdAt: 2000,
          updatedAt: 2000,
        },
        ctx: A,
      }),
    )
    await applyAsClient((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', E), updatedAt: 2100 },
        ctx: A,
      }),
    )

    expect(await notifications()).toEqual([])
    expect(await subscriptions()).toEqual([])
    // Both writes themselves landed, so the emptiness above is the guard and not a dead transaction.
    expect(
      await rows(sql<{ n: string }>`select count(*) as n from comment where id = ${commentId}`),
    ).toEqual([{ n: '1' }])
  })

  // Task 9.3 — the description path, which has no comment id to key on and therefore uses the
  // `'description'` sentinel. Its whole risk is the opposite of the comment's: a per-save key looks
  // natural here, and would re-notify on every keystroke-batch save.
  it('notifies once for a description mention and never again for the same person', async () => {
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', B), updatedAt: 3000 },
        ctx: A,
      }),
    )
    expect(await recipientsOf('mention')).toEqual([B.userID])
    expect((await notifications('mention'))[0]?.event_key).toBe('description')
    expect(await subscribed()).toEqual([B.userID])

    // Adding E notifies E and nobody else.
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', B, ' with ', E), updatedAt: 4000 },
        ctx: A,
      }),
    )
    expect(await recipientsOf('mention')).toEqual([B.userID, E.userID].sort())

    // Re-saving the identical description notifies nobody.
    const before = await notifications()
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', B, ' with ', E), updatedAt: 5000 },
        ctx: A,
      }),
    )
    expect(await notifications()).toEqual(before)

    // And removing then re-adding B does not notify B a second time either — the sentinel key makes
    // a description a single lifetime event per person.
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', E), updatedAt: 6000 },
        ctx: A,
      }),
    )
    await apply((tx) =>
      mutators.issue.update.fn({
        tx,
        args: { id: issueId, description: doc('owner ', B, ' with ', E), updatedAt: 7000 },
        ctx: A,
      }),
    )
    expect(await notifications()).toEqual(before)
  })

  it('notifies for a description written at issue creation, with the claimed number', async () => {
    const createdId = newId()
    await apply((tx) =>
      mutators.issue.create.fn({
        tx,
        args: {
          id: createdId,
          teamId,
          title: 'Filed with an owner named in the body',
          status: 'todo' as const,
          priority: 'no_priority' as const,
          description: doc('over to ', E),
          createdAt: 8000,
          updatedAt: 8000,
        },
        ctx: A,
      }),
    )

    const told = (await notifications('mention')).filter((row) => row.event_key === 'description')
    expect(told.map((row) => row.recipient_id)).toEqual([E.userID])
    // The fan-out runs AFTER the per-team number is claimed, so the key is never null on the very
    // notification the mentioned person reads.
    expect(told[0]?.subject_key).not.toBeNull()
  })

  // Task 9.2 / design D15's write direction. `comment.create` is an agent tool, so a prompt-injected
  // or hallucinated mention is a real path into this fan-out. The tool wrapper resolves the mutator
  // BY NAME out of the same `createServerMutators()` registry and validates arguments with the same
  // exported Zod schema, so resolving it the same way here is the agent's path rather than a
  // paraphrase of it.
  it('gives an agent-authored mention no more reach than a person’s', async () => {
    const spec = buildMutatorToolSpecs().find((entry) => entry.name === 'comment.create')
    if (spec === undefined) throw new Error('comment.create is not registered as an agent tool')
    const fn = mutatorByName('comment.create')

    const args = spec.args.parse({
      id: newId(),
      issueId,
      // The model names two people. Only one of them can read the issue.
      body: doc('summarising for ', C, ' and ', B),
      createdAt: 9000,
      updatedAt: 9000,
    })
    await apply((tx) => fn({ tx, args, ctx: A }))

    expect(await recipientsOf('mention')).toEqual([B.userID])
    expect(await subscribed()).toEqual([B.userID])
  })

  function mutatorByName(
    name: string,
  ): (input: { tx: unknown; args: unknown; ctx: AuthContext }) => Promise<void> {
    for (const group of Object.values(mutators as unknown as Record<string, unknown>)) {
      if (typeof group !== 'object' || group === null) continue
      for (const entry of Object.values(group as Record<string, unknown>)) {
        const mutator = entry as {
          mutatorName?: string
          fn?: (input: { tx: unknown; args: unknown; ctx: AuthContext }) => Promise<void>
        }
        if (mutator.mutatorName === name && mutator.fn) return mutator.fn
      }
    }
    throw new Error(`no mutator named ${name}`)
  }

  async function runQueryAs(
    query: { fn: (input: { args: never; ctx: AuthContext }) => unknown },
    args: unknown,
    ctx: AuthContext,
  ): Promise<unknown> {
    const built = query.fn({ args: args as never, ctx }) as unknown as BuiltQuery
    return await apply(async (tx) => await tx.run(built as never))
  }
})
