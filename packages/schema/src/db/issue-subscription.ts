import type { Kysely } from 'kysely'
import type { DB } from './types.js'

// EVERY Kysely statement over `issue_subscription` lives here, mirroring `db/notification.ts`, so
// the table's whole server-side surface is one file a reviewer can read end to end. Nothing else in
// the repo touches it: the only synced read is `queries.subscriptions.mine`, and there is no
// watcher list or follower count anywhere, for anybody.

export interface AutoSubscribeRow {
  readonly issueId: string
  readonly userId: string
  readonly teamId: string
  readonly at: number
}

// Being mentioned subscribes you to the issue's later activity — ONE multi-row statement, inside
// the caller's transaction, a no-op on an empty array.
//
// `DO NOTHING` IS THE STICKY-UNSUBSCRIBE MECHANISM, not an optimisation. The conflict target is the
// primary key, so an existing row always wins: this statement can CREATE a subscription and can
// never resurrect one somebody turned off. If unfollow deleted the row instead of setting a state,
// the next `@` would re-subscribe them and the loop would be worse than never having offered an
// unfollow at all. It is also idempotent under rebase for free, and needs no read-before-write.
export async function autoSubscribeMentioned(
  db: Kysely<DB>,
  rows: readonly AutoSubscribeRow[],
): Promise<void> {
  if (rows.length === 0) return

  // Two rows with the same natural key inside ONE statement are the caller's mistake, not
  // Postgres's problem to arbitrate — collapse them so the insert stays a single statement.
  const unique = new Map<string, AutoSubscribeRow>()
  for (const row of rows) {
    const key = `${row.issueId}:${row.userId}`
    if (!unique.has(key)) unique.set(key, row)
  }

  await db
    .insertInto('issue_subscription')
    .values(
      [...unique.values()].map((row) => ({
        issue_id: row.issueId,
        user_id: row.userId,
        team_id: row.teamId,
        state: 'subscribed' as const,
        created_at: new Date(row.at),
        updated_at: new Date(row.at),
      })),
    )
    .onConflict((oc) => oc.columns(['issue_id', 'user_id']).doNothing())
    .execute()
}

// The subscriber fan-out's own read: one issue's ACTIVE followers, oldest-following first, capped.
// Capped for the same reason the recipient set is — this runs inside the triggering mutation's
// transaction — and ordered so that if the cap ever bites it falls on the most recent followers
// rather than on people who have been on the thread from the start.
//
// Server-only by construction: there is no synced query that returns another person's subscription,
// so who follows an issue never leaves the server.
export async function subscribersOfIssue(
  db: Kysely<DB>,
  issueId: string,
  limit: number,
): Promise<string[]> {
  const rows = await db
    .selectFrom('issue_subscription')
    .select('user_id as userId')
    .where('issue_id', '=', issueId)
    .where('state', '=', 'subscribed')
    .orderBy('created_at', 'asc')
    .limit(limit)
    .execute()
  return rows.map((row) => row.userId)
}

// Leaving the WORKSPACE: every subscription that person holds, across every team. Beside the
// notification cleanup that runs in the same override, for the same reason.
export async function deleteSubscriptionsForMember(db: Kysely<DB>, userId: string): Promise<void> {
  await db.deleteFrom('issue_subscription').where('user_id', '=', userId).execute()
}

export interface DeleteSubscriptionsForTeamMemberOptions {
  readonly userId: string
  readonly teamId: string
}

// Leaving ONE TEAM: only that person's subscriptions for that team. Their subscriptions on every
// other team are untouched — sound only because an issue can never change team.
export async function deleteSubscriptionsForTeamMember(
  db: Kysely<DB>,
  options: DeleteSubscriptionsForTeamMemberOptions,
): Promise<void> {
  await db
    .deleteFrom('issue_subscription')
    .where('user_id', '=', options.userId)
    .where('team_id', '=', options.teamId)
    .execute()
}
