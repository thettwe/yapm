import { sql } from 'kysely'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { newId } from '../id.js'
import { createDatabase, type Database } from './client.js'
import { migrateToLatest } from './migrate.js'
import {
  deleteDisclosureAuditOlderThan,
  disclosureAuditLogForWorkspace,
  recordDisclosureAudit,
} from './pm-disclosure.js'

const DATABASE_URL = process.env.DATABASE_URL

if (DATABASE_URL === undefined && process.env.CI) {
  throw new Error(
    'DATABASE_URL is required in CI: the disclosure retention test must not be skipped',
  )
}

const DAY_MS = 24 * 60 * 60 * 1000

// The bound, and what it deliberately does NOT touch. `ai_disclosure_audit` is the only table with
// no other control that removes a row; `pm_digest` and `cycle_digest` grow at one row per cycle per
// team and deleting a published one would silently shrink a reader's list.
describe.skipIf(DATABASE_URL === undefined)('the disclosure audit retention bound', () => {
  const database: Database = createDatabase({ connectionString: DATABASE_URL ?? '' })

  const workspaceId = newId()
  const teamId = newId()
  const cycleId = newId()
  const pmDigestId = newId()
  const actorId = `a-${newId()}`

  const ancient = newId()
  const recent = newId()

  async function backdate(id: string, ageDays: number): Promise<void> {
    await sql`update ai_disclosure_audit set created_at = now() - ${sql.lit(`${ageDays} days`)}::interval where id = ${id}`.execute(
      database.db,
    )
  }

  beforeAll(async () => {
    await migrateToLatest(database.db)
    const stamp = newId().slice(-6)
    await database.db
      .insertInto('workspace')
      .values({ id: workspaceId, name: 'retention' })
      .execute()
    await database.db
      .insertInto('team')
      .values({ id: teamId, workspace_id: workspaceId, name: 'Retention', key: `RT${stamp}` })
      .execute()
    // better-auth owns `user`, so it is not in the Kysely migrator's output. Created here in the
    // shape better-auth's own `getMigrations()` produces, as the notification pg suite does.
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
    `.execute(database.db)
    await sql`insert into "user" (id, name, email, "emailVerified") values (${actorId}, 'Ada', ${`${actorId}@example.test`}, true)`.execute(
      database.db,
    )
    await database.db
      .insertInto('cycle')
      .values({
        id: cycleId,
        team_id: teamId,
        name: 'Cycle 1',
        number: 1,
        start_date: new Date('2026-01-01'),
        end_date: new Date('2026-01-14'),
        status: 'completed',
      })
      .execute()
  }, 60_000)

  beforeEach(async () => {
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from pm_digest where team_id = ${teamId}`.execute(database.db)
    await sql`delete from cycle_digest where team_id = ${teamId}`.execute(database.db)

    await database.db
      .insertInto('pm_digest')
      .values({ id: pmDigestId, cycle_id: cycleId, team_id: teamId, status: 'ready' })
      .execute()
    await database.db
      .insertInto('cycle_digest')
      .values({ id: newId(), cycle_id: cycleId, team_id: teamId, status: 'ready' })
      .execute()

    await recordDisclosureAudit(database.db, {
      id: ancient,
      workspaceId,
      teamId,
      actorId,
      event: 'published',
      pmDigestId,
      detail: { audienceSize: 3 },
    })
    await recordDisclosureAudit(database.db, {
      id: recent,
      workspaceId,
      teamId,
      actorId,
      event: 'unpublished',
      pmDigestId,
      detail: { audienceSize: 0 },
    })
    await backdate(ancient, 400)
    await backdate(recent, 10)
  })

  afterAll(async () => {
    await sql`delete from ai_disclosure_audit where workspace_id = ${workspaceId}`.execute(
      database.db,
    )
    await sql`delete from workspace where id = ${workspaceId}`.execute(database.db)
    await sql`delete from "user" where id = ${actorId}`.execute(database.db)
    await database.close()
  })

  it('deletes a record past the window and keeps one inside it', async () => {
    const deleted = await deleteDisclosureAuditOlderThan(
      database.db,
      new Date(Date.now() - 365 * DAY_MS),
    )
    expect(deleted).toBe(1)

    const remaining = await database.db
      .selectFrom('ai_disclosure_audit')
      .select('id')
      .where('workspace_id', '=', workspaceId)
      .execute()
    expect(remaining.map((row) => row.id)).toEqual([recent])
  })

  // Safe to run twice: the predicate is `created_at < cutoff`, so a second pass in the same window
  // has nothing left to match. A sweep that is not idempotent is a sweep an operator cannot re-run.
  it('is idempotent — a second run in the same window deletes nothing', async () => {
    const before = new Date(Date.now() - 365 * DAY_MS)
    expect(await deleteDisclosureAuditOlderThan(database.db, before)).toBe(1)
    expect(await deleteDisclosureAuditOlderThan(database.db, before)).toBe(0)
  })

  // SCOPE's falsifiable check, asserted against BOTH digest tables. "A disclosure" is the audit
  // record, never the artifact: the team's own digest and the reader's published one both survive.
  it('leaves pm_digest and cycle_digest untouched', async () => {
    await deleteDisclosureAuditOlderThan(database.db, new Date(Date.now() - 365 * DAY_MS))

    const pm = await database.db
      .selectFrom('pm_digest')
      .select('id')
      .where('team_id', '=', teamId)
      .execute()
    const cycle = await database.db
      .selectFrom('cycle_digest')
      .select('id')
      .where('team_id', '=', teamId)
      .execute()
    expect(pm).toHaveLength(1)
    expect(cycle).toHaveLength(1)
  })

  // The audit view reports what was disclosed and to how many readers. What it has no shape for is
  // a reader: no per-actor total, no read event, no audience list.
  it('reports per-team totals and events with no per-person aggregate', async () => {
    const log = await disclosureAuditLogForWorkspace(database.db, workspaceId)

    expect(log.totals).toHaveLength(1)
    expect(log.totals[0]).toMatchObject({
      teamId,
      teamName: 'Retention',
      published: 1,
      unpublished: 1,
      generated: 0,
      policyChanged: 0,
    })
    // Keyed by team, and there is no actor-keyed field for a count to be added to later.
    expect(Object.keys(log.totals[0] ?? {}).sort()).toEqual([
      'generated',
      'policyChanged',
      'published',
      'teamId',
      'teamName',
      'unpublished',
    ])

    expect(log.recent.map((event) => event.event)).toEqual(['unpublished', 'published'])
    expect(log.recent.every((event) => event.actorName === 'Ada')).toBe(true)
    // The whole serialized response, checked for anything that would make this a reading log.
    const serialized = JSON.stringify(log)
    expect(serialized).not.toContain('read')
    expect(serialized).not.toContain('audience"')
  })
})
