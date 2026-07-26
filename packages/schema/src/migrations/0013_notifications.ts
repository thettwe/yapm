import { type Kysely, sql } from 'kysely'

const EMAIL_NOTIFICATION_CHECK = sql`email_notifications in ('all', 'assigned_only', 'none')`

// Per-recipient notifications, and the one thing worth reading before the DDL: THE NATURAL KEY IS
// THE PRIMARY KEY. `(recipient_id, kind, subject_id, event_key)` uniquely identifies the event a
// person is being told about, so the fan-out mints nothing — `on conflict do nothing` is answered
// by the primary-key index itself, a mutator re-run during rebase can neither duplicate a row nor
// change one, and CLAUDE.md #4 is never engaged because there is no generated id to corrupt.
//
// TWO ENUM-SHAPED COLUMNS, TWO DIFFERENT ANSWERS ON `CHECK`, both deliberate:
//
//   * `notification.kind` carries NO CHECK. `0012_retro` puts one on every enum column, so its
//     absence here is the thing a reviewer will flag. The reason is that adding the `'mention'`
//     kind must cost a TypeScript union member and a copy string, NOT a forward-only migration in
//     a different change. `kind` is a TS union in `zero/context.ts`, validated by the Zod arg
//     schemas, and the server-only fan-out is its only writer.
//   * `user_preference.email_notifications` DOES carry one. Its value set is closed and owned
//     entirely by this change, so Postgres may as well hold the line.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('notification')
    // No FK: `user` is better-auth's table, created by its own migrator, and this repo's
    // migrations never reference it (matching `retro.facilitator_id` / `retro.created_by`).
    .addColumn('recipient_id', 'text', (col) => col.notNull())
    .addColumn('actor_id', 'text', (col) => col.notNull())
    // Deliberately unconstrained — see the header. Widening the set is a TS change, not a migration.
    .addColumn('kind', 'text', (col) => col.notNull())
    // The team boundary the delivery sweep re-checks membership against, and the cascade that
    // takes every notification with a deleted team. Sound only because an issue can never change
    // team: `issue.routeIssue` refuses team reassignment outright (design D16).
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    // Polymorphic subject: `'issue'` today, so no FK. v1 has no issue-delete mutator at all
    // (`declineTriage` cancels rather than deletes), so there is no dangling-subject path.
    .addColumn('subject_type', 'text', (col) => col.notNull())
    .addColumn('subject_id', 'uuid', (col) => col.notNull())
    // Denormalised snapshots, not joins (design D3): the row renders in one self-scoped query with
    // no permission subtlety, at the cost of showing the title AS IT WAS. `subject_key` is null
    // when the issue has no number yet.
    .addColumn('subject_key', 'text')
    .addColumn('subject_title', 'text', (col) => col.notNull())
    // Deterministic in the triggering mutation's own args — `String(args.updatedAt)` for an
    // assignment, the comment id for a comment. Never `Date.now()`, never a sequence.
    .addColumn('event_key', 'text', (col) => col.notNull())
    .addColumn('read_at', 'timestamptz')
    .addColumn('email_sent_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('notification_pkey', [
      'recipient_id',
      'kind',
      'subject_id',
      'event_key',
    ])
    .execute()

  // The inbox's own read: one recipient's unread rows, newest first. Partial, so it stays small
  // even as the read rows accumulate up to the retention window.
  await sql`
    create index notification_unread_idx
    on notification (recipient_id, created_at desc)
    where read_at is null
  `.execute(db)

  // The delivery sweep's predicate verbatim: unread AND unemailed, bounded by the debounce and the
  // 24-hour window. Partial on the two null tests so the index holds only the candidate set.
  await sql`
    create index notification_pending_email_idx
    on notification (created_at)
    where read_at is null and email_sent_at is null
  `.execute(db)

  await db.schema
    .createIndex('notification_team_id_idx')
    .on('notification')
    .column('team_id')
    .execute()

  // Governs EMAIL only, never the in-app row. `assigned_only` is the default because email is for
  // things addressed at a person (design D13); turning email off never costs you the notification.
  await db.schema
    .alterTable('user_preference')
    .addColumn('email_notifications', 'text', (col) =>
      col.notNull().defaultTo('assigned_only').check(EMAIL_NOTIFICATION_CHECK),
    )
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.alterTable('user_preference').dropColumn('email_notifications').execute()
  await db.schema.dropTable('notification').ifExists().execute()
}
