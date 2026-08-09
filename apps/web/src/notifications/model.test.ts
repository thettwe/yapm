import { expect, test } from 'vitest'
import {
  formatUnreadCount,
  groupNotifications,
  inboxBadgeLabel,
  KIND_LABEL,
  KIND_WORDS,
  type NotificationRowData,
  type NotificationSyncedRow,
  toNotificationRows,
  UNREAD_DISPLAY_CAP,
  unreadCount,
  unreadRows,
} from './model'

const DAY = 86_400_000
const NOON = new Date(2026, 6, 20, 12, 0, 0).getTime()

function synced(overrides: Partial<NotificationSyncedRow> = {}): NotificationSyncedRow {
  return {
    kind: 'issue_assigned',
    teamId: 'team-1',
    subjectType: 'issue',
    subjectId: 'issue-1',
    subjectKey: 'ENG-42',
    subjectTitle: 'Fix the reconnect loop',
    eventKey: '1000',
    actorId: 'user-a',
    readAt: null,
    createdAt: NOON,
    actor: { id: 'user-a', name: 'Dana' },
    ...overrides,
  }
}

function shaped(overrides: Partial<NotificationRowData> = {}): NotificationRowData {
  const [row] = toNotificationRows([synced()])
  if (!row) throw new Error('unreachable')
  return { ...row, ...overrides }
}

test('a shaped row names the actor, the action and the issue', () => {
  const [row] = toNotificationRows([synced()])

  expect(row?.title).toBe('Dana assigned you ENG-42')
  expect(row?.summary).toBe('Fix the reconnect loop')
  expect(row?.read).toBe(false)
})

// The row draws `subjectKey` / `subjectTitle` in their own columns, so the phrase beside them
// carries the actor and the verb and no copy of the subject.
test('a shaped row carries the subject-free phrase beside the full sentence', () => {
  const [row] = toNotificationRows([synced()])

  expect(row?.phrase).toBe('Dana assigned you')
  expect(row?.subjectKey).toBe('ENG-42')
  expect(row?.subjectTitle).toBe('Fix the reconnect loop')
})

test('the digest row names no actor and keeps its stored title', () => {
  const [row] = toNotificationRows([
    synced({
      kind: 'pm_digest_published',
      subjectType: 'pm_digest',
      subjectKey: null,
      subjectTitle: 'Engineering · Cycle 2',
      actor: null,
    }),
  ])

  expect(row?.phrase).toBe('Shared with you')
  expect(row?.subjectKey).toBeNull()
  expect(row?.subjectTitle).toBe('Engineering · Cycle 2')
})

test('every kind reaches assistive technology as a word', () => {
  expect(KIND_LABEL).toEqual({
    issue_assigned: 'Assigned',
    issue_commented: 'Commented',
    mention: 'Mentioned',
    pm_digest_published: 'Digest',
  })
  expect(KIND_WORDS).toEqual(['assigned', 'commented', 'mentioned', 'digests'])
})

test('the unread lens is a pure filter that preserves order and leaves the input alone', () => {
  const rows = toNotificationRows([
    synced({ subjectId: 'issue-1', createdAt: NOON, readAt: NOON }),
    synced({ subjectId: 'issue-2', createdAt: NOON - 1_000 }),
    synced({ subjectId: 'issue-3', createdAt: NOON - 2_000 }),
  ])

  expect(unreadRows(rows).map((row) => row.subjectId)).toEqual(['issue-2', 'issue-3'])
  expect(rows).toHaveLength(3)
  expect(unreadRows([])).toEqual([])
})

test('the shaped row carries no body text of any kind, only the snapshotted subject', () => {
  const rendered = JSON.stringify(toNotificationRows([synced()]))

  // Everything a row can render is derived from these fields; nothing else survives shaping,
  // which is what keeps a comment body structurally unable to reach the inbox.
  expect(Object.keys(shaped()).sort()).toEqual([
    'actorId',
    'actorName',
    'createdAt',
    'eventKey',
    'id',
    'kind',
    'phrase',
    'read',
    'subjectId',
    'subjectKey',
    'subjectTitle',
    'subjectType',
    'summary',
    'teamId',
    'title',
  ])
  expect(rendered).not.toContain('body')
})

test('an actor with no name falls back to the address, then to a neutral noun', () => {
  const [withEmail] = toNotificationRows([
    synced({ actor: { id: 'user-a', name: '  ', email: 'dana@example.com' } }),
  ])
  const [withNothing] = toNotificationRows([synced({ actor: null })])

  expect(withEmail?.title).toBe('dana@example.com assigned you ENG-42')
  expect(withNothing?.title).toBe('Someone assigned you ENG-42')
})

test('a notification whose subject has no key yet still renders from the title alone', () => {
  const [row] = toNotificationRows([synced({ subjectKey: null })])

  expect(row?.subjectKey).toBeNull()
  expect(row?.title).toBe('Dana assigned you an issue')
  expect(row?.summary).toBe('Fix the reconnect loop')
})

test('rows are newest first with a total tiebreak', () => {
  const rows = toNotificationRows([
    synced({ subjectId: 'issue-1', createdAt: NOON - DAY }),
    synced({ subjectId: 'issue-3', createdAt: NOON }),
    synced({ subjectId: 'issue-2', createdAt: NOON }),
  ])

  expect(rows.map((row) => row.subjectId)).toEqual(['issue-2', 'issue-3', 'issue-1'])
})

test('a read row is one with a readAt stamp', () => {
  const rows = toNotificationRows([
    synced({ subjectId: 'issue-1', readAt: NOON }),
    synced({ subjectId: 'issue-2', readAt: null }),
  ])

  expect(unreadCount(rows)).toBe(1)
  expect(rows.find((row) => row.subjectId === 'issue-1')?.read).toBe(true)
})

test('the unread count caps at the display cap', () => {
  expect(formatUnreadCount(0)).toBe('0')
  expect(formatUnreadCount(3)).toBe('3')
  expect(formatUnreadCount(UNREAD_DISPLAY_CAP)).toBe('99')
  expect(formatUnreadCount(UNREAD_DISPLAY_CAP + 1)).toBe('99+')
  expect(formatUnreadCount(1000)).toBe('99+')
})

test('the badge label states the count in one stable sentence', () => {
  expect(inboxBadgeLabel(0)).toBe('Inbox, 0 unread')
  expect(inboxBadgeLabel(3)).toBe('Inbox, 3 unread')
  expect(inboxBadgeLabel(120)).toBe('Inbox, 99+ unread')
})

test('rows bucket into calendar days, empty buckets dropped, flat order preserved', () => {
  const rows = toNotificationRows([
    synced({ subjectId: 'today-1', createdAt: NOON }),
    synced({ subjectId: 'today-2', createdAt: NOON - 3_600_000 }),
    synced({ subjectId: 'old', createdAt: NOON - 9 * DAY }),
  ])

  const groups = groupNotifications(rows, NOON)

  expect(groups.map((group) => group.key)).toEqual(['today', 'earlier'])
  expect(groups[0]?.label).toBe('Today')
  expect(groups[0]?.rows.map((row) => row.subjectId)).toEqual(['today-1', 'today-2'])
  expect(groups[1]?.rows.map((row) => row.subjectId)).toEqual(['old'])
})

test('yesterday is its own bucket', () => {
  const rows = toNotificationRows([synced({ createdAt: NOON - DAY })])

  expect(groupNotifications(rows, NOON).map((group) => group.label)).toEqual(['Yesterday'])
})

test('grouping an empty inbox produces no headings', () => {
  expect(groupNotifications([], NOON)).toEqual([])
})
