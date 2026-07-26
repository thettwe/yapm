import { useZero } from '@rocicorp/zero/react'
import { useNavigate } from '@tanstack/react-router'
import { mutators } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { formatReviewAge } from '@yapm/ui/components/issue-row'
import { BellIcon } from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { runMutation } from '@/lib/mutation'
import {
  formatUnreadCount,
  groupNotifications,
  type NotificationRowData,
} from '@/notifications/model'
import { useInbox } from '@/notifications/use-inbox'

// The workspace-wide inbox: every notification addressed to the signed-in user, newest first,
// across every team they belong to. Keyboard map, mirroring the triage list so the two feel like
// one product: j/k and Down/Up move the cursor, Enter and Right open the subject and mark it
// read, `e` toggles read state.
//
// NO BODY EXCERPTS. A row carries the actor, the verb and the issue as it was titled at the
// time — never a line of the comment that caused it.
export function InboxView() {
  const navigate = useNavigate()
  const zero = useZero()
  const { rows, unread, loaded } = useInbox()

  // THE CURSOR IS A ROW IDENTITY, NOT A POSITION. This list is live and newest-first, so a
  // notification arriving while somebody reads would re-point a flat index at a different row —
  // and the next Enter or `e` would open or mark the wrong one. The index is derived from the id
  // each render; a clamped position is only the fallback for when the anchored row has left the
  // list (read-filtered away, swept by retention).
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const containerRef = useRef<HTMLElement>(null)
  const lastIndexRef = useRef(0)

  const groups = useMemo(() => groupNotifications(rows, Date.now()), [rows])
  // The flat position of every row, so the day headings never disturb the `j`/`k` sequence.
  const indexById = useMemo(() => new Map(rows.map((row, position) => [row.id, position])), [rows])

  const anchored = focusedId === undefined ? -1 : (indexById.get(focusedId) ?? -1)
  const focusIndex =
    anchored === -1 ? Math.min(lastIndexRef.current, Math.max(0, rows.length - 1)) : anchored

  const focusRow = useCallback((index: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.focus()
  }, [])

  useEffect(() => {
    lastIndexRef.current = focusIndex
    const container = containerRef.current
    if (!container || rows.length === 0) return
    const active = document.activeElement
    if (active === document.body || container.contains(active)) {
      focusRow(focusIndex)
    }
  }, [rows, focusIndex, focusRow])

  const move = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, focusIndex + delta))
      const target = rows[next]
      if (target === undefined) return
      setFocusedId(target.id)
      focusRow(next)
    },
    [rows, focusIndex, focusRow],
  )

  const run = useCallback(async (write: ReturnType<typeof zero.mutate>) => {
    const failure = await runMutation(write)
    setError(failure)
  }, [])

  // Optimistic and local: the row's read state flips in this frame and the badge recounts from
  // the same synced rows. Nothing here waits on the network.
  const setRead = useCallback(
    (row: NotificationRowData, read: boolean) =>
      void run(
        zero.mutate(
          mutators.notification.markRead({
            kind: row.kind,
            subjectId: row.subjectId,
            eventKey: row.eventKey,
            readAt: read ? Date.now() : null,
          }),
        ),
      ),
    [run, zero],
  )

  const markAllRead = useCallback(
    () => void run(zero.mutate(mutators.notification.markAllRead({ readAt: Date.now() }))),
    [run, zero],
  )

  const open = useCallback(
    (row: NotificationRowData) => {
      setRead(row, true)
      if (row.subjectType !== 'issue') return
      void navigate({
        to: '/teams/$teamId/issues',
        params: { teamId: row.teamId },
        search: { open: row.subjectId },
      })
    },
    [navigate, setRead],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (rows.length === 0) return
      const current = rows[focusIndex]
      switch (event.key) {
        case 'j':
        case 'ArrowDown':
          event.preventDefault()
          move(1)
          break
        case 'k':
        case 'ArrowUp':
          event.preventDefault()
          move(-1)
          break
        // Enter reaches the row's own button and opens it there; only Right needs handling here,
        // or the two paths would both fire on Enter.
        case 'ArrowRight':
          if (current) {
            event.preventDefault()
            open(current)
          }
          break
        case 'e':
        case 'E':
          if (current) {
            event.preventDefault()
            setRead(current, !current.read)
          }
          break
        default:
          break
      }
    },
    [rows, focusIndex, move, open, setRead],
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-bg">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <BellIcon aria-hidden="true" className="size-4 text-text-3" />
        <h1 className="text-sm font-semibold tracking-tight text-text-1">Inbox</h1>
        <span className="ml-1 font-mono text-xs text-text-3" data-testid="inbox-unread-count">
          {formatUnreadCount(unread)}
        </span>
        {error !== undefined ? (
          <span className="ml-2 text-xs text-status-urgent" role="alert">
            {error}
          </span>
        ) : null}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          disabled={unread === 0}
          data-testid="inbox-mark-all-read"
          onClick={markAllRead}
        >
          Mark all read
        </Button>
      </header>

      <section
        ref={containerRef}
        className="flex-1 overflow-y-auto pb-10 outline-none"
        onKeyDown={onKeyDown}
        aria-label="Notifications"
      >
        {rows.length === 0 ? (
          <p className="p-8 text-center text-sm text-text-3" role="status">
            {loaded
              ? "You're all caught up. Assignments and comments on issues you're involved in land here."
              : 'Loading notifications…'}
          </p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <h2 className="sticky top-0 z-10 border-b border-border bg-bg px-4 py-1.5 font-ui text-[11.5px] font-medium tracking-wide text-text-2">
                {group.label}
              </h2>
              {group.rows.map((row) => {
                const position = indexById.get(row.id) ?? 0
                return (
                  <InboxRow
                    key={row.id}
                    index={position}
                    row={row}
                    focused={position === focusIndex}
                    onFocusRow={setFocusedId}
                    onOpen={() => open(row)}
                  />
                )
              })}
            </div>
          ))
        )}
      </section>
    </div>
  )
}

function InboxRow({
  index,
  row,
  focused,
  onFocusRow,
  onOpen,
}: {
  index: number
  row: NotificationRowData
  focused: boolean
  onFocusRow: (id: string) => void
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      data-index={index}
      data-testid="notification-row"
      data-read={row.read ? 'true' : 'false'}
      tabIndex={focused ? 0 : -1}
      onFocus={() => onFocusRow(row.id)}
      onClick={onOpen}
      className="flex min-h-[var(--density-row)] w-full items-center gap-3 border-b border-border px-4 py-2 text-left outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
    >
      <span className="flex w-2 shrink-0 justify-center">
        {row.read ? null : <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}
        <span className="sr-only">{row.read ? 'Read' : 'Unread'}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium tracking-[-0.008em] text-text-1">
          {row.title}
        </span>
        <span className="block truncate text-xs text-text-2">
          {row.subjectKey ? (
            <span className="mr-1.5 font-mono tabular-nums text-text-3">{row.subjectKey}</span>
          ) : null}
          {row.summary}
        </span>
      </span>
      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-text-3">
        {formatReviewAge(Math.max(0, Date.now() - row.createdAt))}
      </span>
    </button>
  )
}
