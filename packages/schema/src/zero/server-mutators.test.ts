import type { Transaction } from '@rocicorp/zero'
import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import {
  claimNextCycleNumber,
  claimNextIssueNumber,
  createServerMutators,
} from './server-mutators.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the numbering test must not be skipped')
}

describe.skipIf(DATABASE_URL === undefined)('per-team issue numbering', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const workspaceId = newId()
  const teamA = newId()
  const teamB = newId()

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'numbering-test')`.execute(
      database.db,
    )
    for (const [id, key] of [
      [teamA, `NA${Date.now() % 1000}`],
      [teamB, `NB${Date.now() % 1000}`],
    ] as const) {
      await sql`insert into team (id, workspace_id, name, key) values (${id}, ${workspaceId}, ${key}, ${key})`.execute(
        database.db,
      )
    }
  }, 30_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('assigns a gapless monotonic sequence per team starting at 1', async () => {
    const first = await claimNextIssueNumber(database.db, teamA)
    const second = await claimNextIssueNumber(database.db, teamA)
    const third = await claimNextIssueNumber(database.db, teamA)
    expect([first, second, third]).toEqual([1, 2, 3])
  })

  it('advances each team independently', async () => {
    const b1 = await claimNextIssueNumber(database.db, teamB)
    const b2 = await claimNextIssueNumber(database.db, teamB)
    expect([b1, b2]).toEqual([1, 2])
    // team A is unaffected by team B's claims
    const a4 = await claimNextIssueNumber(database.db, teamA)
    expect(a4).toBe(4)
  })

  it('gives distinct sequential numbers under concurrent claims in one team', async () => {
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimNextIssueNumber(database.db, teamB)),
    )
    const sorted = [...claims].sort((a, b) => a - b)
    // team B already advanced to 2, so the next ten are 3..12, all distinct
    expect(new Set(claims).size).toBe(10)
    expect(sorted).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

describe.skipIf(DATABASE_URL === undefined)('per-team cycle numbering', () => {
  const database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const workspaceId = newId()
  const teamA = newId()
  const teamB = newId()

  beforeAll(async () => {
    await migrateToLatest(database.db)
    await sql`insert into workspace (id, name) values (${workspaceId}, 'cycle-numbering-test')`.execute(
      database.db,
    )
    for (const [id, key] of [
      [teamA, `CA${Date.now() % 1000}`],
      [teamB, `CB${Date.now() % 1000}`],
    ] as const) {
      await sql`insert into team (id, workspace_id, name, key) values (${id}, ${workspaceId}, ${key}, ${key})`.execute(
        database.db,
      )
    }
  }, 30_000)

  afterAll(async () => {
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('assigns a gapless monotonic sequence per team starting at 1', async () => {
    const first = await claimNextCycleNumber(database.db, teamA)
    const second = await claimNextCycleNumber(database.db, teamA)
    const third = await claimNextCycleNumber(database.db, teamA)
    expect([first, second, third]).toEqual([1, 2, 3])
  })

  it('advances each team independently', async () => {
    const b1 = await claimNextCycleNumber(database.db, teamB)
    const b2 = await claimNextCycleNumber(database.db, teamB)
    expect([b1, b2]).toEqual([1, 2])
    // team A is unaffected by team B's claims
    const a4 = await claimNextCycleNumber(database.db, teamA)
    expect(a4).toBe(4)
  })

  it('gives distinct sequential numbers under concurrent claims in one team', async () => {
    const claims = await Promise.all(
      Array.from({ length: 10 }, () => claimNextCycleNumber(database.db, teamB)),
    )
    const sorted = [...claims].sort((a, b) => a - b)
    // team B already advanced to 2, so the next ten are 3..12, all distinct
    expect(new Set(claims).size).toBe(10)
    expect(sorted).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })
})

// THE REBASE GUARD, at every site that writes a notification.
//
// Client mutators re-run during rebase, so a fan-out on the client path could duplicate rows or
// fabricate them against an optimistic state that never lands. Every notification write in this
// module is behind `if (tx.location !== 'server') return`, and this suite proves it by running the
// server mutators with a CLIENT-location transaction whose `dbTransaction` is absent: reaching
// `serverDb(tx)` at all would throw, and writing to `notification` would be recorded. Neither
// happens.
describe('the notification fan-out never runs on the client path', () => {
  const ADMIN: AuthContext = { userID: 'user-admin', role: 'admin' }
  const ISSUE_ID = '019f8f00-0000-7000-8000-0000000000e1'
  const TEAM_ID = '019f8f00-0000-7000-8000-0000000000e2'
  const ASSIGNEE = 'user-assignee'

  interface RecordedWrite {
    table: string
    verb: string
  }

  // Table-aware rather than a queue, so the canned rows survive a mutator growing a read.
  function clientTx(): { tx: Transaction; writes: RecordedWrite[] } {
    const writes: RecordedWrite[] = []
    const rowFor = (table: string): unknown => {
      switch (table) {
        case 'issue':
          return {
            id: ISSUE_ID,
            teamId: TEAM_ID,
            title: 'Flaky login redirect',
            number: 7,
            assigneeId: ASSIGNEE,
            creatorId: 'user-creator',
          }
        case 'team':
          return { id: TEAM_ID, key: 'ENG' }
        case 'team_membership':
          return { id: 'membership-1', teamId: TEAM_ID, userId: ASSIGNEE }
        case 'workspace_member':
          return { id: 'member-1', userId: ASSIGNEE, role: 'member' }
        case 'comment':
          return { id: 'comment-1', authorId: 'user-creator' }
        default:
          return undefined
      }
    }

    const tableMutator = (table: string) => ({
      insert: (_value: unknown) => {
        writes.push({ table, verb: 'insert' })
        return Promise.resolve()
      },
      update: (_value: unknown) => {
        writes.push({ table, verb: 'update' })
        return Promise.resolve()
      },
      delete: (_value: unknown) => {
        writes.push({ table, verb: 'delete' })
        return Promise.resolve()
      },
      upsert: (_value: unknown) => {
        writes.push({ table, verb: 'upsert' })
        return Promise.resolve()
      },
    })

    const tx = {
      location: 'client',
      reason: 'optimistic',
      // Deliberately absent: `serverDb(tx)` would throw, so a missing guard fails loudly rather
      // than silently writing nothing for some other reason.
      run: (query: unknown) => {
        const { ast, format } = query as { ast: { table: string }; format?: { singular?: boolean } }
        const row = rowFor(ast.table)
        return Promise.resolve(format?.singular === true ? row : row === undefined ? [] : [row])
      },
      mutate: new Proxy({}, { get: (_target, table: string) => tableMutator(table) }),
    } as unknown as Transaction

    return { tx, writes }
  }

  const mutators = createServerMutators()
  const at = 1_784_820_335_919

  it.each([
    [
      'issue.create',
      (tx: Transaction) =>
        mutators.issue.create.fn({
          tx,
          args: {
            id: ISSUE_ID,
            teamId: TEAM_ID,
            title: 'Flaky login redirect',
            status: 'todo' as const,
            priority: 'no_priority' as const,
            assigneeId: ASSIGNEE,
            createdAt: at,
            updatedAt: at,
          },
          ctx: ADMIN,
        }),
    ],
    [
      'issue.assign',
      (tx: Transaction) =>
        mutators.issue.assign.fn({
          tx,
          args: { id: ISSUE_ID, assigneeId: ASSIGNEE, updatedAt: at },
          ctx: ADMIN,
        }),
    ],
    [
      'issue.routeIssue',
      (tx: Transaction) =>
        mutators.issue.routeIssue.fn({
          tx,
          args: { id: ISSUE_ID, assigneeId: ASSIGNEE, updatedAt: at },
          ctx: ADMIN,
        }),
    ],
    [
      'comment.create',
      (tx: Transaction) =>
        mutators.comment.create.fn({
          tx,
          args: {
            id: 'comment-2',
            issueId: ISSUE_ID,
            body: { type: 'doc', content: [] },
            createdAt: at,
            updatedAt: at,
          },
          ctx: ADMIN,
        }),
    ],
  ])('%s writes no notification row optimistically', async (_name, run) => {
    const { tx, writes } = clientTx()
    await run(tx)
    expect(writes.filter((write) => write.table === 'notification')).toEqual([])
    // The shared mutator still did its own work — this is a guard, not a disabled mutator.
    expect(writes.length).toBeGreaterThan(0)
  })

  it.each([
    [
      'member.remove',
      (tx: Transaction) => mutators.member.remove.fn({ tx, args: { id: 'member-1' }, ctx: ADMIN }),
    ],
    [
      'team.removeMember',
      (tx: Transaction) =>
        mutators.team.removeMember.fn({ tx, args: { id: 'membership-1' }, ctx: ADMIN }),
    ],
  ])('%s deletes no notification row optimistically', async (_name, run) => {
    const { tx, writes } = clientTx()
    await run(tx)
    expect(writes.filter((write) => write.table === 'notification')).toEqual([])
    expect(writes.length).toBeGreaterThan(0)
  })

  it('notification.markAllRead adds no raw statement on the client', async () => {
    const { tx, writes } = clientTx()
    await mutators.notification.markAllRead.fn({
      tx,
      args: { readAt: at },
      ctx: { userID: ASSIGNEE, role: 'member' },
    })
    // The shared loop ran (the client's own bounded optimistic pass) and nothing reached Kysely.
    expect(writes.every((write) => write.table === 'notification')).toBe(true)
  })
})
