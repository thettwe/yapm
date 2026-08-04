import type { Kysely, SqlBool } from 'kysely'
import { sql } from 'kysely'
import type {
  EmailNotificationMode,
  NotificationKind,
  NotificationSubjectType,
  SubscriptionState,
} from '../zero/context.js'
import type { DB } from './types.js'

// EVERY Kysely statement over `notification` lives here (mirroring `db/cycle-digest.ts`), so the
// table's whole server-side surface is one file a reviewer can read end to end.

// The public write seam. `mentions` binds to THIS — imported from `@yapm/schema/server`, which
// re-exports it — rather than to the private trigger map, because its recipient computation is a
// document diff rather than a subject-involvement rule.
export interface NotificationEvent {
  readonly recipientId: string
  readonly actorId: string
  readonly kind: NotificationKind
  readonly teamId: string
  readonly subjectType: NotificationSubjectType
  readonly subjectId: string
  readonly subjectKey: string | null
  readonly subjectTitle: string
  readonly eventKey: string
  readonly createdAt: number
}

// The four columns that identify an event for one person — and the table's primary key.
export interface NotificationKey {
  readonly recipientId: string
  readonly kind: NotificationKind
  readonly subjectId: string
  readonly eventKey: string
}

function keyOf(event: NotificationEvent): string {
  return `${event.recipientId}\u0000${event.kind}\u0000${event.subjectId}\u0000${event.eventKey}`
}

// ONE multi-row `insert … on conflict do nothing`, inside the caller's transaction, a no-op on an
// empty array. The conflict target is the primary key itself, so no separate unique index exists to
// drift out of agreement with it, and a mutator re-run during rebase writes exactly the same rows
// and changes nothing.
export async function recordNotifications(
  db: Kysely<DB>,
  events: readonly NotificationEvent[],
): Promise<void> {
  if (events.length === 0) return

  // Two events with the same natural key inside ONE statement are the caller's mistake, not
  // Postgres's problem to arbitrate — collapse them here so the insert stays a single statement.
  const unique = new Map<string, NotificationEvent>()
  for (const event of events) {
    if (!unique.has(keyOf(event))) unique.set(keyOf(event), event)
  }

  await db
    .insertInto('notification')
    .values(
      [...unique.values()].map((event) => ({
        recipient_id: event.recipientId,
        actor_id: event.actorId,
        kind: event.kind,
        team_id: event.teamId,
        subject_type: event.subjectType,
        subject_id: event.subjectId,
        subject_key: event.subjectKey,
        subject_title: event.subjectTitle,
        event_key: event.eventKey,
        created_at: new Date(event.createdAt),
      })),
    )
    .onConflict((oc) => oc.columns(['recipient_id', 'kind', 'subject_id', 'event_key']).doNothing())
    .execute()
}

export interface MarkAllNotificationsReadOptions {
  readonly recipientId: string
  readonly readAt: number
}

// The authoritative half of `notification.markAllRead`: the shared mutator's loop only ever sees
// the rows the caller synced, so the server stamps the rest in one statement.
export async function markAllNotificationsRead(
  db: Kysely<DB>,
  options: MarkAllNotificationsReadOptions,
): Promise<void> {
  await db
    .updateTable('notification')
    .set({ read_at: new Date(options.readAt) })
    .where('recipient_id', '=', options.recipientId)
    .where('read_at', 'is', null)
    .execute()
}

// Leaving the WORKSPACE: every notification addressed to that person, across every team.
export async function deleteNotificationsForMember(
  db: Kysely<DB>,
  recipientId: string,
): Promise<void> {
  await db.deleteFrom('notification').where('recipient_id', '=', recipientId).execute()
}

export interface DeleteNotificationsForTeamMemberOptions {
  readonly recipientId: string
  readonly teamId: string
}

// Leaving ONE TEAM: only that person's notifications for that team. Their inbox for every other
// team is untouched — which is the whole distinction design D11 turns on.
export async function deleteNotificationsForTeamMember(
  db: Kysely<DB>,
  options: DeleteNotificationsForTeamMemberOptions,
): Promise<void> {
  await db
    .deleteFrom('notification')
    .where('recipient_id', '=', options.recipientId)
    .where('team_id', '=', options.teamId)
    .execute()
}

export interface PendingNotificationEmailsOptions {
  // The debounce: only rows settled for long enough that a person had a chance to read them in-app.
  readonly createdBefore: Date
  // Never resurrect a backlog when email is enabled on an existing instance.
  readonly createdAfter: Date
  // The kinds `assigned_only` (the default preference) emails, passed IN from
  // `ACTIONABLE_NOTIFICATION_KINDS` rather than named here, so the classification still lives in
  // TypeScript and a new kind still costs no migration.
  readonly actionableKinds: readonly NotificationKind[]
  readonly limit: number
}

export interface PendingNotificationEmail extends NotificationKey {
  readonly actorId: string
  // LEFT-joined, so a deleted actor degrades the copy to "Someone" instead of dropping the row.
  readonly actorName: string | null
  readonly teamId: string
  readonly subjectType: NotificationSubjectType
  readonly subjectKey: string | null
  readonly subjectTitle: string
  readonly email: string
  readonly name: string
  readonly mode: EmailNotificationMode
  // The recipient's OWN subscription to the subject issue, or null when they have none. LEFT-joined
  // so a notification is never dropped for want of a subscription row. It exists so the sender can
  // tell a recipient something true about their own state — a mention's follow line is a
  // disclosure, and disclosing a subscription to somebody who unfollowed the issue is a lie the
  // sticky-unfollow design guarantees it would keep telling.
  readonly subscriptionState: SubscriptionState | null
  readonly createdAt: Date
}

// The delivery sweep's source query. Four things it does that are each load-bearing:
//
//   1. `read_at is null` — a notification already read in-app is never emailed. This is the single
//      most effective defence against email storms.
//   2. `email_sent_at is null` — sent once, ever.
//   3. The debounce and the 24-hour window, so a burst becomes one message and enabling email does
//      not mail a month of history.
//   4. A CURRENT-ACCESS predicate — membership can change between the write and the send, and the
//      denormalised `subject_title` would otherwise outlive the access that authorised it. It is
//      the SAME disjunction the write side uses (`eligibleMentionees`, `teamScoped`): a current
//      member of the notification's team, OR a current workspace admin, who can read every issue in
//      the workspace. A bare join to `team_membership` would drop an off-team admin's mention row
//      on the floor — written in-app, never emailed, with nothing to see. A plain ex-member still
//      matches neither arm and is still never emailed.
//
// The subscription is LEFT-joined for the recipient's own state only, and only so the sender can
// word a mention's follow line truthfully: a person who unfollowed the issue and is mentioned again
// is still notified, still emailed, and must not be told they now follow something the sticky
// unfollow guarantees they do not.
//
// The actor is LEFT-joined for its display name only: `notificationCopy` is what words the email,
// and it needs the same actor name the inbox row shows. Left, not inner, because `actor_id` carries
// no FK — a vanished actor must degrade the copy, never drop the notification.
//
// The preference filter is applied HERE, in SQL, against the same coalesced `mode` expression the
// result carries — and that placement is the point, not a micro-optimisation. Filtered in
// TypeScript after the `limit`, every row a `none`-mode recipient accumulates occupies the batch
// budget and is then discarded unstamped, so one such recipient with more pending rows than the
// limit starves every other recipient's email for the whole recency window. The kind list is passed
// in, so the actionable/ambient classification still lives in TypeScript.
export async function pendingNotificationEmails(
  db: Kysely<DB>,
  options: PendingNotificationEmailsOptions,
): Promise<PendingNotificationEmail[]> {
  const mode = sql<EmailNotificationMode>`coalesce(${sql.ref(
    'user_preference.email_notifications',
  )}, 'assigned_only')`
  const actionable =
    options.actionableKinds.length === 0
      ? sql<SqlBool>`false`
      : sql<SqlBool>`${sql.ref('notification.kind')} in (${sql.join(
          options.actionableKinds.map((kind) => sql`${kind}`),
        )})`

  return await db
    .selectFrom('notification')
    .innerJoin('user', 'user.id', 'notification.recipient_id')
    .leftJoin('user as actor', 'actor.id', 'notification.actor_id')
    .leftJoin('user_preference', 'user_preference.user_id', 'notification.recipient_id')
    // The recipient's own subscription to the subject. LEFT, and on the composite natural key, so
    // it can add no row and drop none: `(issue_id, user_id)` is the subscription's primary key, so
    // this matches at most once.
    .leftJoin('issue_subscription', (join) =>
      join
        .onRef('issue_subscription.issue_id', '=', 'notification.subject_id')
        .onRef('issue_subscription.user_id', '=', 'notification.recipient_id'),
    )
    .select([
      'notification.recipient_id as recipientId',
      'notification.actor_id as actorId',
      'actor.name as actorName',
      'notification.kind as kind',
      'notification.team_id as teamId',
      'notification.subject_type as subjectType',
      'notification.subject_id as subjectId',
      'notification.subject_key as subjectKey',
      'notification.subject_title as subjectTitle',
      'notification.event_key as eventKey',
      'notification.created_at as createdAt',
      'user.email as email',
      'user.name as name',
      'issue_subscription.state as subscriptionState',
      mode.as('mode'),
    ])
    .where('notification.read_at', 'is', null)
    .where('notification.email_sent_at', 'is', null)
    // The clause that makes this selection and `pendingPmDigestReadyEmails`' PROVABLY DISJOINT, so a
    // workspace admin who is also a named PM reader is mailed once rather than by both sweeps. It
    // removes no row today — `'issue'` was the only subject type before the PM digest notice — and
    // it is the narrowing, not a widening: the access predicate below stays exactly as strict.
    .where('notification.subject_type', '=', 'issue')
    // The write-time predicate, mirrored: on the team, or an admin of the workspace.
    .where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('team_membership')
            .select('team_membership.id')
            .whereRef('team_membership.team_id', '=', 'notification.team_id')
            .whereRef('team_membership.user_id', '=', 'notification.recipient_id'),
        ),
        eb.exists(
          eb
            .selectFrom('workspace_member')
            .select('workspace_member.id')
            .whereRef('workspace_member.user_id', '=', 'notification.recipient_id')
            .where('workspace_member.role', '=', 'admin'),
        ),
      ]),
    )
    .where(sql<SqlBool>`${mode} <> 'none' and (${mode} = 'all' or ${actionable})`)
    // `created_at` is a DB-defaulted (`Generated<Timestamp>`) column whose operand typing does not
    // accept a plain `Date` under this project's TS config; a raw predicate compares it cleanly.
    .where(sql<SqlBool>`${sql.ref('notification.created_at')} < ${options.createdBefore}`)
    .where(sql<SqlBool>`${sql.ref('notification.created_at')} > ${options.createdAfter}`)
    .orderBy('notification.recipient_id', 'asc')
    .orderBy('notification.created_at', 'asc')
    .limit(options.limit)
    .execute()
}

// Stamps exactly the rows a transport accepted — never a whole selection — so a partial failure
// leaves the rest for the next window rather than swallowing them.
export async function stampNotificationsEmailed(
  db: Kysely<DB>,
  keys: readonly NotificationKey[],
  at: Date,
): Promise<void> {
  if (keys.length === 0) return
  await db
    .updateTable('notification')
    .set({ email_sent_at: at })
    .where((eb) =>
      eb.or(
        keys.map((key) =>
          eb.and([
            eb('recipient_id', '=', key.recipientId),
            eb('kind', '=', key.kind),
            eb('subject_id', '=', key.subjectId),
            eb('event_key', '=', key.eventKey),
          ]),
        ),
      ),
    )
    .execute()
}

// Retention. Bounds the synced set, which is what keeps a per-user table from becoming a hydration
// cost on every client forever — hygiene it is not.
export async function deleteNotificationsOlderThan(db: Kysely<DB>, before: Date): Promise<number> {
  const result = await db
    .deleteFrom('notification')
    .where(sql<SqlBool>`${sql.ref('notification.created_at')} < ${before}`)
    .executeTakeFirst()
  return Number(result?.numDeletedRows ?? 0)
}

export interface PendingPmDigestReadyEmailsOptions {
  readonly createdBefore: Date
  readonly createdAfter: Date
  readonly limit: number
}

export interface PendingPmDigestReadyEmail extends NotificationKey {
  readonly teamId: string
  // The baked team/cycle label the fan-out stamped. yapm-computed metadata, never content.
  readonly subjectTitle: string
  readonly email: string
  readonly mode: EmailNotificationMode
}

// The PM-digest notice's delivery selection, written BESIDE `pendingNotificationEmails` rather than
// inside it — the one real duplication in this change, and a chosen one.
//
// `pendingNotificationEmails` carries a CURRENT-ACCESS predicate: a member of the notification's team
// OR a workspace admin. A named PM reader is neither, so a `pm_digest_published` row selected through
// it would be written, never mailed, and never explained. Teaching that SQL about the disclosure axis
// means a jsonb read of `connector_config.config` inside the notification query — a second place
// deciding "is this person allowed", which `db/pm-disclosure.ts` opens by naming as how two answers
// drift — and widening it for one kind would weaken it for every kind, because the predicate is
// shared.
//
// So this query applies NO ACCESS PREDICATE AT ALL. Entitlement is re-resolved in TypeScript, per
// recipient, through `resolvePmAudienceTeamIds` — the ONE resolver — before anything is sent. That
// is the same "current access at delivery time" property the shipped sweep has, obtained through the
// single resolver rather than through a copy of it: a reader removed from an audience, a team whose
// `pmVisible` was turned off, or a workspace whose kill switch was set between publish and sweep gets
// nothing.
//
// Everything else is the shipped sweep's shape: unread, unstamped, inside the debounce and the
// recency window, and the same `email_notifications` preference applied in the SAME SQL position, so
// a `none`-mode recipient's backlog can never consume the batch budget.
export async function pendingPmDigestReadyEmails(
  db: Kysely<DB>,
  options: PendingPmDigestReadyEmailsOptions,
): Promise<PendingPmDigestReadyEmail[]> {
  const mode = sql<EmailNotificationMode>`coalesce(${sql.ref(
    'user_preference.email_notifications',
  )}, 'assigned_only')`

  return await db
    .selectFrom('notification')
    .innerJoin('user', 'user.id', 'notification.recipient_id')
    .leftJoin('user_preference', 'user_preference.user_id', 'notification.recipient_id')
    .select([
      'notification.recipient_id as recipientId',
      'notification.kind as kind',
      'notification.team_id as teamId',
      'notification.subject_id as subjectId',
      'notification.subject_title as subjectTitle',
      'notification.event_key as eventKey',
      'user.email as email',
      mode.as('mode'),
    ])
    .where('notification.subject_type', '=', 'pm_digest')
    .where('notification.read_at', 'is', null)
    .where('notification.email_sent_at', 'is', null)
    // `pm_digest_published` is actionable, so `assigned_only` (the default) covers it and only an
    // explicit `none` suppresses it. Spelled as the two modes rather than through the kind list,
    // because this selection has exactly one kind in it.
    .where(sql<SqlBool>`${mode} <> 'none'`)
    .where(sql<SqlBool>`${sql.ref('notification.created_at')} < ${options.createdBefore}`)
    .where(sql<SqlBool>`${sql.ref('notification.created_at')} > ${options.createdAfter}`)
    .orderBy('notification.recipient_id', 'asc')
    .orderBy('notification.created_at', 'asc')
    .limit(options.limit)
    .execute()
}
