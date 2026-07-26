import { type Kysely, sql } from 'kysely'

const SUBSCRIPTION_STATE_CHECK = sql`state in ('subscribed', 'unsubscribed')`

// A standing intent to be told about one issue. Three things here are load-bearing and none of them
// is visible from the DDL alone.
//
// THE NATURAL KEY IS THE PRIMARY KEY — `(issue_id, user_id)`, no generated id column. Following
// `0013_notifications`: nothing is minted at a call site or inside a mutator body, so CLAUDE.md #4
// is never engaged rather than argued around; `on conflict do nothing` is answered by the
// primary-key index itself with no separate unique constraint to drift; and a mutator re-run during
// rebase addresses exactly the same row. One half of the key is always the verified `ctx.userID`,
// which makes a caller structurally unable to name somebody else's subscription.
//
// `state`, NOT ROW EXISTENCE. Unfollow sets `state = 'unsubscribed'`; it does not DELETE. If it
// deleted, the next `@` would re-subscribe you and the loop is worse than never having offered an
// unfollow at all — the user did the documented thing and it did not hold. With a state column the
// auto-subscribe write is a single `insert … on conflict (issue_id, user_id) do nothing`, which can
// create a subscription and can NEVER resurrect one you turned off.
//
// `state` DOES CARRY A CHECK while `notification.kind` deliberately does not. Not an inconsistency:
// `kind` must be widenable for the price of a TypeScript union member in a later change, whereas
// this value set is closed and owned entirely by this change, so Postgres may as well hold the line.
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('issue_subscription')
    .addColumn('issue_id', 'uuid', (col) =>
      col.notNull().references('issue.id').onDelete('cascade'),
    )
    // No FK: `user` is better-auth's table, created by its own migrator, and this repo's migrations
    // never reference it (matching `notification.recipient_id`).
    .addColumn('user_id', 'text', (col) => col.notNull())
    // Denormalised from the issue for the two membership cleanups and for indexing — never a sync
    // scope. Sound only because an issue can never change team: `issue.routeIssue` refuses team
    // reassignment outright.
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('team.id').onDelete('cascade'))
    .addColumn('state', 'text', (col) =>
      col.notNull().defaultTo('subscribed').check(SUBSCRIPTION_STATE_CHECK),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('issue_subscription_pkey', ['issue_id', 'user_id'])
    .execute()

  // The fan-out's own read: one issue's active subscribers, inside the triggering mutation's
  // transaction. Partial, so an issue whose followers have all unsubscribed costs nothing.
  await sql`
    create index issue_subscription_active_idx
    on issue_subscription (issue_id)
    where state = 'subscribed'
  `.execute(db)

  // The two membership cleanups: leaving one team clears that team's rows, leaving the workspace
  // clears them all.
  await db.schema
    .createIndex('issue_subscription_team_user_idx')
    .on('issue_subscription')
    .columns(['team_id', 'user_id'])
    .execute()

  await db.schema
    .createIndex('issue_subscription_user_idx')
    .on('issue_subscription')
    .column('user_id')
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('issue_subscription').ifExists().execute()
}
