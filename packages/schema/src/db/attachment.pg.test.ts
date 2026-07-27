import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import {
  attachAttachment,
  collectOrphanedAttachment,
  listOrphanedAttachments,
} from './attachment.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the orphan-claim proof must not be skipped — it guards a path that destroys bytes',
  )
}

// The sweep's two statements, against real Postgres. `apps/server/src/jobs/attachments.test.ts`
// covers what the JOB does with their answers, and it does that by MOCKING both — which means the
// `for update` claim, the transaction boundary around `removeBytes` and the `created_at` cutoff are
// only ever asserted here. A mock that returns `false` for an attached row proves the job's
// arithmetic; it cannot prove the row was ever locked.
//
// Each case below fails for a different specific defect:
//
//   * the claim returning `true` and the bytes surviving fails if `removeBytes` is moved after the
//     row delete, or outside the transaction;
//   * the row being LOCKED while `removeBytes` runs fails the moment `forUpdate()` is dropped —
//     which is the whole race the claim exists for, and is invisible to any single-connection test;
//   * an attached row refusing the claim WITHOUT calling `removeBytes` fails if the re-check is
//     taken from the listing instead of from under the lock, which is the byte-destroying bug;
//   * a throwing `removeBytes` leaving the row present fails if the delete is committed in its own
//     transaction — the residue would then be an unnameable object, the one thing the ordering is
//     chosen to avoid;
//   * the cutoff and the edge filters on `listOrphanedAttachments` fail if the grace window is
//     applied to rows already fetched, or measured from anything but `created_at`.
describe.skipIf(DATABASE_URL === undefined)(
  'attachment sweep statements over live Postgres',
  () => {
    const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

    // The sweep runs on its OWN connection, tagged, so the probe below can find that backend in
    // `pg_stat_activity` by name instead of guessing which idle-in-transaction session is the one
    // under test. Every Postgres suite in the repo shares one database and turbo runs packages in
    // parallel, so "the only backend holding a transaction" is not a safe assumption.
    const CLAIM_APP_NAME = `yapm-attachment-claim-${newId().slice(-8)}`
    const sweep: Database = createDatabase({
      connectionString: `${DATABASE_URL ?? ''}${(DATABASE_URL ?? '').includes('?') ? '&' : '?'}application_name=${CLAIM_APP_NAME}`,
      maxConnections: 1,
    })

    const workspaceId = newId()
    const teamId = newId()
    const issueId = newId()
    const uploaderId = `u-${newId()}`

    const HOUR_MS = 60 * 60 * 1000
    const NOW = Date.parse('2026-07-27T04:23:00.000Z')
    const cutoff = new Date(NOW - 24 * HOUR_MS)

    async function seedAttachment(id: string, createdAt: Date, edge?: 'issue'): Promise<void> {
      await database.db
        .insertInto('attachment')
        .values({
          id,
          team_id: teamId,
          issue_id: edge === 'issue' ? issueId : null,
          comment_id: null,
          uploader_id: uploaderId,
          filename: 'pasted.png',
          content_type: 'image/png',
          byte_size: 4096,
          has_thumbnail: false,
          created_at: createdAt,
        })
        .execute()
    }

    async function rowExists(id: string): Promise<boolean> {
      const row = await database.db
        .selectFrom('attachment')
        .select('id')
        .where('id', '=', id)
        .executeTakeFirst()
      return row !== undefined
    }

    // Asked from a SECOND connection, so it observes the claim rather than participating in it.
    // `nowait` rather than a blocking lock: a test that waits for the sweep's transaction would hang
    // instead of failing when the lock is absent, and the answer wanted here is immediate.
    async function isLocked(id: string): Promise<boolean> {
      try {
        await sql`select 1 from attachment where id = ${id} for update nowait`.execute(database.db)
        return false
      } catch {
        return true
      }
    }

    // The last statement the sweep's own backend issued, read while it sits idle in its transaction
    // waiting on `removeBytes`. This is the only vantage point from which the ORDER inside that
    // transaction is visible at all: a second connection cannot see an uncommitted delete, so
    // "the row is still there" would be true whichever statement ran first.
    async function statementInFlight(): Promise<string> {
      const result = await sql<{ query: string }>`
      select query from pg_stat_activity
      where application_name = ${CLAIM_APP_NAME} and state = 'idle in transaction'
    `.execute(database.db)
      return result.rows.map((row) => row.query.toLowerCase()).join(' | ')
    }

    beforeAll(async () => {
      await migrateToLatest(database.db)
      const db = database.db
      const stamp = newId().slice(-6)

      await db
        .insertInto('workspace')
        .values({ id: workspaceId, name: 'attachment-sweep' })
        .execute()
      await db
        .insertInto('team')
        .values({ id: teamId, workspace_id: workspaceId, name: 'Sweep', key: `SW${stamp}` })
        .execute()
      await db
        .insertInto('workspace_member')
        .values({ id: newId(), workspace_id: workspaceId, user_id: uploaderId, role: 'member' })
        .execute()
      await db
        .insertInto('team_membership')
        .values({ id: newId(), team_id: teamId, user_id: uploaderId })
        .execute()
      await db
        .insertInto('issue')
        .values({
          id: issueId,
          team_id: teamId,
          number: 1,
          title: 'The issue an attachment can hang off',
          status: 'todo',
          priority: 'medium',
          creator_id: uploaderId,
        })
        .execute()
    })

    afterAll(async () => {
      await database.db.deleteFrom('attachment').where('team_id', '=', teamId).execute()
      await database.db.deleteFrom('workspace').where('id', '=', workspaceId).execute()
      await sweep.close()
      await database.close()
    })

    describe('collectOrphanedAttachment', () => {
      it('claims an unattached row, removes the bytes inside the claim, then deletes the row', async () => {
        const id = newId()
        await seedAttachment(id, new Date(NOW - 48 * HOUR_MS))

        let lockedWhileRemoving: boolean | undefined
        let statementWhileRemoving = ''
        let calls = 0

        const taken = await collectOrphanedAttachment(sweep.db, id, async () => {
          calls += 1
          lockedWhileRemoving = await isLocked(id)
          statementWhileRemoving = await statementInFlight()
        })

        expect(taken).toBe(true)
        expect(calls).toBe(1)
        // Under the claim's lock while the bytes are going — this is what a concurrent attach blocks
        // on, and it is absent the moment `forUpdate()` is.
        expect(lockedWhileRemoving).toBe(true)
        // ORDER, from the only vantage point that can see it: the claim's SELECT is the last thing
        // that backend ran, so the row delete has not been issued yet. Bytes before the row.
        expect(statementWhileRemoving).toContain('for update')
        expect(statementWhileRemoving).not.toContain('delete from')
        expect(await rowExists(id)).toBe(false)
      })

      it('refuses a row that gained an edge and never touches its bytes', async () => {
        const id = newId()
        await seedAttachment(id, new Date(NOW - 48 * HOUR_MS))
        // The database moving underneath a pass that already listed this row as an orphan.
        const attached = await attachAttachment(database.db, { id, userId: uploaderId, issueId })
        expect(attached?.issueId).toBe(issueId)

        let calls = 0
        const taken = await collectOrphanedAttachment(database.db, id, async () => {
          calls += 1
        })

        expect(taken).toBe(false)
        expect(calls).toBe(0)
        expect(await rowExists(id)).toBe(true)
      })

      it('leaves the row present when removing the bytes fails', async () => {
        const id = newId()
        await seedAttachment(id, new Date(NOW - 48 * HOUR_MS))

        await expect(
          collectOrphanedAttachment(database.db, id, () =>
            Promise.reject(new Error('unreachable object')),
          ),
        ).rejects.toThrow('unreachable object')

        // Rolled back with the transaction, so the next pass re-selects it — still an orphan.
        expect(await rowExists(id)).toBe(true)
        expect(await isLocked(id)).toBe(false)
      })

      it('refuses a malformed id without reaching the database', async () => {
        let calls = 0
        const taken = await collectOrphanedAttachment(database.db, 'not-a-uuid', async () => {
          calls += 1
        })
        expect(taken).toBe(false)
        expect(calls).toBe(0)
      })
    })

    describe('listOrphanedAttachments', () => {
      it('returns only unattached rows created before the cutoff, oldest first and bounded', async () => {
        const oldest = newId()
        const older = newId()
        const insideGrace = newId()
        const attachedButOld = newId()
        await seedAttachment(oldest, new Date(NOW - 72 * HOUR_MS))
        await seedAttachment(older, new Date(NOW - 48 * HOUR_MS))
        // Younger than the grace window: an editing session that is still open.
        await seedAttachment(insideGrace, new Date(NOW - 1 * HOUR_MS))
        await seedAttachment(attachedButOld, new Date(NOW - 96 * HOUR_MS), 'issue')

        // Deliberately not scoped to this team — the statement has no team filter, and every Postgres
        // suite in the repo shares one database, so these assertions are about THIS fixture's ids
        // rather than about the size of the result.
        const rows = await listOrphanedAttachments(database.db, {
          createdBefore: cutoff,
          limit: 500,
        })
        const ids = rows.map((row) => row.id)

        expect(ids).toContain(oldest)
        expect(ids).toContain(older)
        expect(ids).not.toContain(insideGrace)
        expect(ids).not.toContain(attachedButOld)
        expect(ids.indexOf(oldest)).toBeLessThan(ids.indexOf(older))
        expect(rows.every((row) => row.issueId === null && row.commentId === null)).toBe(true)

        const bounded = await listOrphanedAttachments(database.db, {
          createdBefore: cutoff,
          limit: 1,
        })
        expect(bounded).toHaveLength(1)

        // The cutoff is the statement's, not a filter over rows it already fetched: moved forward, the
        // row inside the grace window becomes eligible.
        const wider = await listOrphanedAttachments(database.db, {
          createdBefore: new Date(NOW),
          limit: 500,
        })
        expect(wider.map((row) => row.id)).toContain(insideGrace)

        await database.db
          .deleteFrom('attachment')
          .where('id', 'in', [oldest, older, insideGrace, attachedButOld])
          .execute()
      })
    })
  },
)
