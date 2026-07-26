import { useQuery } from '@rocicorp/zero/react'
import { queries } from '@yapm/schema'
import { useMemo } from 'react'
import {
  type NotificationRowData,
  type NotificationSyncedRow,
  toNotificationRows,
  unreadCount,
} from '@/notifications/model'

export interface Inbox {
  readonly rows: readonly NotificationRowData[]
  readonly unread: number
  readonly loaded: boolean
}

// ONE subscription for the whole app (design D18). The shell badge and the `/inbox` list both
// call this hook and Zero dedupes the identical active query, so the inbox costs one bounded
// subscription per client rather than one per surface. Never open a second `notifications.mine`.
export function useInbox(): Inbox {
  const [raw, result] = useQuery(queries.notifications.mine())
  const rows = useMemo(() => toNotificationRows(raw as readonly NotificationSyncedRow[]), [raw])
  return { rows, unread: unreadCount(rows), loaded: result.type === 'complete' }
}
