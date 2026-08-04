import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDatabase, type Database } from '../db/client.js'
import { migrateToLatest } from '../db/migrate.js'
import { setPmDisclosurePolicy } from '../db/pm-disclosure.js'
import { newId } from '../id.js'
import type { AuthContext } from './context.js'
import type { StoredPmDigestContent } from './pm-digest.js'
import { createServerMutators } from './server-mutators.js'
import {
  createPgServerTransaction,
  type PgSchemaMeta,
  readPgSchemaMeta,
} from './testing/pg-transaction.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error('DATABASE_URL is required in CI: the publish fan-out proof must not be skipped')
}

// THE PUBLISH FAN-OUT, RUN RATHER THAN READ.
//
// `fanOutPmDigestNotice` is the one new mutator behaviour in this change, and every claim made for it
// is a claim about rows in `notification` after a real publish against real Postgres:
//
//   (a) one row per CURRENT workspace member named in the audience — an id left on a stale list by a
//       departure gets nothing, because the stored list is a policy and not a membership;
//   (b) the actor is the SYSTEM principal, so no reader can learn which individual released it;
//   (c) the row carries the subject type, the digest, the team/cycle label and the publication
//       instant as its event key — and not a syllable of the digest's content;
//   (d) a re-run carrying the same publication instant writes nothing new (the natural key is the
//       primary key), and a retraction writes nothing at all;
//   (e) a team whose audience is empty produces no notice, and a team whose sharing is off cannot be
//       published at all.
describe.skipIf(DATABASE_URL === undefined)('the PM digest publish fan-out', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })
  const mutators = createServerMutators()

  const workspaceId = newId()
  const sharedTeamId = newId()
  const silentTeamId = newId()
  const emptyTeamId = newId()
  const sharedCycleId = newId()
  const silentCycleId = newId()
  const emptyCycleId = newId()
  const sharedDigestId = newId()
  const silentDigestId = newId()
  const emptyDigestId = newId()

  const PUBLISHER: AuthContext = { userID: `pub-${newId()}`, role: 'member' }
  const ADMIN: AuthContext = { userID: `adm-${newId()}`, role: 'admin' }
  const READER_ONE = `r1-${newId()}`
  const READER_TWO = `r2-${newId()}`
  // Named on the audience and NO LONGER a member of the workspace: nothing prunes a stored audience
  // when somebody leaves, so this id is what a fan-out that trusted the list would have written to.
  const DEPARTED = `gone-${newId()}`

  const HEADLINE = 'Checkout shipped; billing carried'

  const CONTENT: StoredPmDigestContent = {
    headline: HEADLINE,
    sections: [],
    subject: { teamName: 'Delivery', cycleName: 'Cycle 4', startDate: 1, endDate: 2 },
    evidenceLabels: {},
  }

  let meta: PgSchemaMeta

  async function notificationsFor(digestId: string) {
    return await database.db
      .selectFrom('notification')
      .selectAll()
      .where('subject_id', '=', digestId)
      .orderBy('recipient_id', 'asc')
      .execute()
  }

  async function publish(digestId: string, at: number): Promise<void> {
    await database.db.transaction().execute(async (trx) =>
      mutators.pmDigest.publish.fn({
        tx: createPgServerTransaction(trx, meta),
        args: { id: digestId, updatedAt: at },
        ctx: PUBLISHER,
      }),
    )
  }

  async function unpublish(digestId: string, at: number): Promise<void> {
    await database.db.transaction().execute(async (trx) =>
      mutators.pmDigest.unpublish.fn({
        tx: createPgServerTransaction(trx, meta),
        args: { id: digestId, updatedAt: at },
        ctx: PUBLISHER,
      }),
    )
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    meta = await readPgSchemaMeta(database.db)
    const db = database.db
    const stamp = newId().slice(-6)

    await db.insertInto('workspace').values({ id: workspaceId, name: 'fan-out' }).execute()
    await db
      .insertInto('team')
      .values([
        { id: sharedTeamId, workspace_id: workspaceId, name: 'Delivery', key: `FA${stamp}` },
        { id: silentTeamId, workspace_id: workspaceId, name: 'Platform', key: `FB${stamp}` },
        { id: emptyTeamId, workspace_id: workspaceId, name: 'Payments', key: `FC${stamp}` },
      ])
      .execute()
    // The departed reader has NO `workspace_member` row, which is exactly what "departed" means here.
    await db
      .insertInto('workspace_member')
      .values([
        { id: newId(), workspace_id: workspaceId, user_id: PUBLISHER.userID, role: 'member' },
        { id: newId(), workspace_id: workspaceId, user_id: ADMIN.userID, role: 'admin' },
        { id: newId(), workspace_id: workspaceId, user_id: READER_ONE, role: 'viewer' },
        { id: newId(), workspace_id: workspaceId, user_id: READER_TWO, role: 'viewer' },
      ])
      .execute()
    await db
      .insertInto('team_membership')
      .values([
        { id: newId(), team_id: sharedTeamId, user_id: PUBLISHER.userID },
        { id: newId(), team_id: silentTeamId, user_id: PUBLISHER.userID },
        { id: newId(), team_id: emptyTeamId, user_id: PUBLISHER.userID },
      ])
      .execute()

    await db
      .insertInto('cycle')
      .values(
        [
          { id: sharedCycleId, team_id: sharedTeamId, number: 4, name: 'Cycle 4' },
          { id: silentCycleId, team_id: silentTeamId, number: 5, name: 'Cycle 5' },
          { id: emptyCycleId, team_id: emptyTeamId, number: 6, name: 'Cycle 6' },
        ].map((cycle) => ({
          ...cycle,
          status: 'completed' as const,
          start_date: new Date('2026-07-01T00:00:00.000Z'),
          end_date: new Date('2026-07-14T00:00:00.000Z'),
        })),
      )
      .execute()

    await db
      .insertInto('pm_digest')
      .values(
        [
          { id: sharedDigestId, team_id: sharedTeamId, cycle_id: sharedCycleId },
          { id: silentDigestId, team_id: silentTeamId, cycle_id: silentCycleId },
          { id: emptyDigestId, team_id: emptyTeamId, cycle_id: emptyCycleId },
        ].map((digest) => ({
          ...digest,
          status: 'ready' as const,
          content: CONTENT,
          generated_at: new Date(),
        })),
      )
      .execute()

    // Sharing ON with a stale audience for the first team, ON with an EMPTY audience for the third,
    // and OFF for the second — the three shapes the fan-out has to tell apart.
    await setPmDisclosurePolicy(database.db, ADMIN, {
      configId: newId(),
      auditId: newId(),
      workspaceId,
      enabled: true,
      teams: {
        [sharedTeamId]: { pmVisible: true, audience: [READER_ONE, READER_TWO, DEPARTED] },
        [silentTeamId]: { pmVisible: false, audience: [READER_ONE] },
        [emptyTeamId]: { pmVisible: true, audience: [] },
      },
    })
  }, 60_000)

  afterAll(async () => {
    await sql`delete from notification where team_id in (${sql.join([
      sharedTeamId,
      silentTeamId,
      emptyTeamId,
    ])})`.execute(database.db)
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from connector_config where workspace_id = ${workspaceId}`.execute(database.db)
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await database.close()
  })

  it('writes one notice per current member of the audience, from the system and about nothing else', async () => {
    const at = Date.now()
    await publish(sharedDigestId, at)

    const rows = await notificationsFor(sharedDigestId)
    expect(rows.map((row) => row.recipient_id).sort()).toEqual([READER_ONE, READER_TWO].sort())
    // (a) The stale id got nothing, so no row exists for it to be read or mailed.
    expect(rows.map((row) => row.recipient_id)).not.toContain(DEPARTED)

    for (const row of rows) {
      // (b) The anti-leak invariant, asserted where it would fail if it broke.
      expect(row.actor_id).toBe('system')
      // (c) yapm-computed metadata, and the label the delivery sweep splits back into two halves.
      expect(row.kind).toBe('pm_digest_published')
      expect(row.subject_type).toBe('pm_digest')
      expect(row.subject_id).toBe(sharedDigestId)
      expect(row.team_id).toBe(sharedTeamId)
      expect(row.event_key).toBe(String(at))
      expect(row.subject_title).toBe('Delivery · Cycle 4')
      expect(row.subject_key).toBeNull()
    }

    // Not a syllable of the digest in any column of any row, and not the publisher's identity either
    // — which is what the system actor exists to withhold.
    const serialized = JSON.stringify(rows)
    expect(serialized).not.toContain(HEADLINE)
    expect(serialized).not.toContain(PUBLISHER.userID)
  })

  // (d) Idempotence, both ways round: a retraction writes nothing, and a re-publish carrying the same
  // publication instant — which is what a rebased re-run of the mutator looks like — inserts nothing.
  it('writes nothing on retraction and nothing on a re-run of the same publication', async () => {
    const before = await notificationsFor(sharedDigestId)
    const at = Number(before[0]?.event_key)

    await unpublish(sharedDigestId, Date.now())
    expect(await notificationsFor(sharedDigestId)).toHaveLength(before.length)

    await publish(sharedDigestId, at)
    const after = await notificationsFor(sharedDigestId)
    expect(after).toHaveLength(before.length)
    expect(after.map((row) => row.event_key)).toEqual(before.map((row) => row.event_key))
  })

  // (e) The two silent shapes. Neither is a row, and one of them is not even a publication.
  it('writes no notice for an empty audience, and refuses the release for a team that is off', async () => {
    await publish(emptyDigestId, Date.now())
    expect(await notificationsFor(emptyDigestId)).toEqual([])

    await expect(publish(silentDigestId, Date.now())).rejects.toThrow()
    expect(await notificationsFor(silentDigestId)).toEqual([])
  })
})
