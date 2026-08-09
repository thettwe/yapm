import { type NotificationKind, type NotificationSubjectType, notificationCopy } from '@yapm/schema'

// The inbox's read model: synced notification rows in, rendered rows out. Pure — no Zero, no
// React — so the unread count, its cap and the day grouping are unit-testable without a client.
//
// WHAT IS NOT HERE, and must not arrive later: any excerpt of a comment or issue body. A row says
// what happened and which issue it happened to, never what was written (design non-goal, and the
// same cut `notificationCopy` makes on the server side of the seam).

// Beyond this the badge reads "99+". `notifications.mine` is bounded at NOTIFICATION_SYNC_LIMIT
// (100), so a client can never count higher than the cap plus one anyway.
export const UNREAD_DISPLAY_CAP = 99

export interface NotificationActorRow {
  readonly id?: string
  readonly name?: string | null
  readonly email?: string | null
  readonly image?: string | null
}

// The synced row as `queries.notifications.mine` returns it, with its `actor` relationship.
export interface NotificationSyncedRow {
  readonly kind: NotificationKind
  readonly teamId: string
  readonly subjectType: NotificationSubjectType
  readonly subjectId: string
  readonly subjectKey?: string | null
  readonly subjectTitle: string
  readonly eventKey: string
  readonly actorId: string
  readonly readAt?: number | null
  readonly createdAt: number
  readonly actor?: NotificationActorRow | null
}

export interface NotificationRowData {
  // Stable React key and keyboard target: the three primary-key columns that vary within one
  // recipient's inbox. `recipientId` is constant across the whole list by construction.
  readonly id: string
  readonly kind: NotificationKind
  readonly teamId: string
  readonly subjectType: NotificationSubjectType
  readonly subjectId: string
  readonly subjectKey: string | null
  readonly subjectTitle: string
  readonly eventKey: string
  readonly actorId: string
  readonly actorName: string | null
  // The full sentence, unchanged: what a reader outside the app is sent, and what the palette and
  // the email seam still address the event by.
  readonly title: string
  readonly summary: string
  // The actor and the verb alone. The row draws this beside `subjectKey` / `subjectTitle`, which
  // carry the subject in their own columns.
  readonly phrase: string
  readonly read: boolean
  readonly createdAt: number
}

// The kind as a word, for the row's assistive-technology text. The glyph is a drawing and a drawing
// is not a name, so every row states its kind here as well.
export const KIND_LABEL: Record<NotificationKind, string> = {
  issue_assigned: 'Assigned',
  issue_commented: 'Commented',
  mention: 'Mentioned',
  pm_digest_published: 'Digest',
}

// The four kinds as the empty state names them, in the order `NOTIFICATION_KINDS` declares.
export const KIND_WORDS: readonly string[] = ['assigned', 'commented', 'mentioned', 'digests']

const ID_SEPARATOR = '\u0000'

export function notificationRowId(row: {
  kind: NotificationKind
  subjectId: string
  eventKey: string
}): string {
  return [row.kind, row.subjectId, row.eventKey].join(ID_SEPARATOR)
}

function actorNameOf(actor: NotificationActorRow | null | undefined): string | null {
  const name = actor?.name?.trim()
  if (name) return name
  const email = actor?.email?.trim()
  return email ? email : null
}

export function toNotificationRow(row: NotificationSyncedRow): NotificationRowData {
  const actorName = actorNameOf(row.actor)
  const subjectKey = row.subjectKey ?? null
  const copy = notificationCopy({
    kind: row.kind,
    actorName,
    subjectKey,
    subjectTitle: row.subjectTitle,
  })
  return {
    id: notificationRowId(row),
    kind: row.kind,
    teamId: row.teamId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    subjectKey,
    subjectTitle: row.subjectTitle,
    eventKey: row.eventKey,
    actorId: row.actorId,
    actorName,
    title: copy.title,
    summary: copy.summary,
    phrase: copy.phrase,
    read: row.readAt != null,
    createdAt: row.createdAt,
  }
}

// Newest first, with a total tiebreak so two events sharing a millisecond never swap places
// under the cursor between renders.
export function toNotificationRows(
  rows: readonly NotificationSyncedRow[],
): readonly NotificationRowData[] {
  return rows
    .map(toNotificationRow)
    .sort((a, b) =>
      b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : a.id.localeCompare(b.id),
    )
}

// The unread lens, as a pure filter over rows the client already holds: no query, no argument, no
// round trip. Kept here rather than inline in the view so the lens is testable without a client.
export function unreadRows(rows: readonly NotificationRowData[]): readonly NotificationRowData[] {
  return rows.filter((row) => !row.read)
}

export function unreadCount(rows: readonly NotificationRowData[]): number {
  return rows.reduce((count, row) => (row.read ? count : count + 1), 0)
}

export function formatUnreadCount(count: number): string {
  return count > UNREAD_DISPLAY_CAP ? `${UNREAD_DISPLAY_CAP}+` : String(Math.max(0, count))
}

// The badge's accessible name. One sentence whatever the count, so a screen reader user hears
// the same shape every time and the number is the only thing that moves.
export function inboxBadgeLabel(count: number): string {
  return `Inbox, ${formatUnreadCount(count)} unread`
}

export type NotificationGroupKey = 'today' | 'yesterday' | 'earlier'

export interface NotificationGroup {
  readonly key: NotificationGroupKey
  readonly label: string
  readonly rows: readonly NotificationRowData[]
}

const GROUP_LABEL: Record<NotificationGroupKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  earlier: 'Earlier',
}

const GROUP_ORDER: readonly NotificationGroupKey[] = ['today', 'yesterday', 'earlier']

const DAY_MS = 86_400_000

function startOfDay(ts: number): number {
  const date = new Date(ts)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function groupKeyFor(createdAt: number, todayStart: number): NotificationGroupKey {
  if (createdAt >= todayStart) return 'today'
  if (createdAt >= todayStart - DAY_MS) return 'yesterday'
  return 'earlier'
}

// Calendar-day buckets over the already-ordered rows. Empty buckets are dropped, and the flat
// order is preserved inside each bucket so `j`/`k` walking the rendered list never jumps.
export function groupNotifications(
  rows: readonly NotificationRowData[],
  now: number,
): readonly NotificationGroup[] {
  const todayStart = startOfDay(now)
  const buckets = new Map<NotificationGroupKey, NotificationRowData[]>()
  for (const row of rows) {
    const key = groupKeyFor(row.createdAt, todayStart)
    const bucket = buckets.get(key) ?? []
    bucket.push(row)
    buckets.set(key, bucket)
  }
  return GROUP_ORDER.flatMap((key) => {
    const bucket = buckets.get(key)
    return bucket && bucket.length > 0 ? [{ key, label: GROUP_LABEL[key], rows: bucket }] : []
  })
}
