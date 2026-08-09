import { useQuery, useZero } from '@rocicorp/zero/react'
import { Link, useNavigate } from '@tanstack/react-router'
import { mutators, queries } from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { cn } from '@yapm/ui/lib/utils'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Masthead as FrameMasthead } from '@/frame/masthead'
import { useAnchorTeam } from '@/frame/team-context'
import { formatRelative } from '@/issues/model'
import { runMutation } from '@/lib/mutation'
import { KindGlyph, SettledLoop } from '@/notifications/kind-glyph'
import {
  formatUnreadCount,
  groupNotifications,
  KIND_LABEL,
  KIND_WORDS,
  type NotificationRowData,
  unreadRows,
} from '@/notifications/model'
import { useInbox } from '@/notifications/use-inbox'

// The workspace-wide inbox: every notification addressed to the signed-in user, newest first,
// across every team they belong to. Keyboard map, mirroring the triage list so the two feel like
// one product: j/k and Down/Up move the cursor, Enter and Right open the subject and mark it
// read, `e` toggles read state.
//
// NOTHING HERE JOINS THE SUBJECT. A notification has no relationship to its issue — the row draws
// the `subjectKey` / `subjectTitle` it snapshotted at write time and nothing else. That absence is
// a permission boundary, not a simplification: a notification is readable only by its recipient
// with no admin bypass, and a joined row would be a second disclosure the predicate does not gate.
// So: no status glyph, no reality track, no assignee, no labels, no second query, and no mark
// claiming the stored title has gone stale — marking staleness would need the live title.
//
// NO BODY EXCERPTS. A row carries the actor, the verb and the issue as it was titled at the time —
// never a line of the comment that caused it.
type Lens = 'all' | 'unread'

export function InboxView() {
  const navigate = useNavigate()
  const zero = useZero()
  const { rows, unread, loaded } = useInbox()
  // Already synced by the frame — the deck resolves its anchor from this same query, so Zero hands
  // back the live result rather than opening a subscription. It names a team; it never joins one.
  const [teams] = useQuery(queries.teams.all())
  const anchor = useAnchorTeam(undefined)

  const [lens, setLens] = useState<Lens>('all')
  // THE CURSOR IS A ROW IDENTITY, NOT A POSITION. This list is live and newest-first, so a
  // notification arriving while somebody reads would re-point a flat index at a different row —
  // and the next Enter or `e` would open or mark the wrong one. The index is derived from the id
  // each render; a clamped position is only the fallback for when the anchored row has left the
  // list (read-filtered away, swept by retention, or hidden by the lens).
  const [focusedId, setFocusedId] = useState<string | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const containerRef = useRef<HTMLElement>(null)
  const lastIndexRef = useRef(0)

  // The lens filters rows the client already holds: no query, no argument, no round trip. Every
  // derivation below reads the VISIBLE list, so the cursor can never point at a row the lens
  // removed from the page.
  const visible = useMemo(() => (lens === 'unread' ? unreadRows(rows) : rows), [lens, rows])
  const groups = useMemo(() => groupNotifications(visible, Date.now()), [visible])
  // The flat position of every drawn row, so the day bands never disturb the `j`/`k` sequence.
  const indexById = useMemo(
    () => new Map(visible.map((row, position) => [row.id, position])),
    [visible],
  )

  const anchored = focusedId === undefined ? -1 : (indexById.get(focusedId) ?? -1)
  const focusIndex =
    anchored === -1 ? Math.min(lastIndexRef.current, Math.max(0, visible.length - 1)) : anchored

  // Workspace-wide, so a row's team is worth naming only where it is NOT the team the deck is
  // pointing at — that is the one row a reader could otherwise misplace. Resolved against the
  // already-synced team list by id; a team this client cannot name draws no tag rather than an id,
  // which is also the whole of the no-anchor case: the anchor is null only when that same list is
  // empty, so every lookup misses and no row can draw a tag anyway.
  const teamNames = useMemo(
    () => new Map((teams as readonly { id: string; name: string }[]).map((t) => [t.id, t.name])),
    [teams],
  )
  const isForeignTeam = useCallback((teamId: string) => teamId !== anchor?.id, [anchor])

  const focusRow = useCallback((index: number) => {
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    el?.focus()
  }, [])

  useEffect(() => {
    lastIndexRef.current = focusIndex
    const container = containerRef.current
    if (!container || visible.length === 0) return
    const active = document.activeElement
    if (active === document.body || container.contains(active)) {
      focusRow(focusIndex)
    }
  }, [visible, focusIndex, focusRow])

  const move = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(visible.length - 1, focusIndex + delta))
      const target = visible[next]
      if (target === undefined) return
      setFocusedId(target.id)
      focusRow(next)
    },
    [visible, focusIndex, focusRow],
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
      // Exhaustive over the subject union so a later subject type is a compile error here rather
      // than an inbox row that reads well and goes nowhere.
      switch (row.subjectType) {
        case 'issue':
          void navigate({
            to: '/teams/$teamId/issues',
            params: { teamId: row.teamId },
            search: { open: row.subjectId },
          })
          return
        // The reader's own surface. Not the team's board or cycle — a named reader can open neither,
        // and the notice deliberately tells them nothing beyond which team and which cycle.
        case 'pm_digest':
          void navigate({ to: '/digests' })
          return
      }
    },
    [navigate, setRead],
  )

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLElement>) => {
      if (visible.length === 0) return
      const current = visible[focusIndex]
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
    [visible, focusIndex, move, open, setRead],
  )

  return (
    <>
      <Masthead
        lens={lens}
        onLens={setLens}
        // An unfinished sync has no count to state: a mono `0` over a loading list is band 2
        // contradicting the body beneath it. An inbox holding NOTHING has none either, and a lens
        // over nothing is a control that cannot act — so band 2 on the empty state is the title
        // alone, which is the mock's second frame. The test is `rows`, never the LENS's own view:
        // clearing the last unread row must not remove the control that gets the reader back.
        loaded={loaded}
        populated={rows.length > 0}
        unread={unread}
        error={error}
        onMarkAllRead={markAllRead}
      />
      <div className="flex min-h-0 flex-1 flex-col bg-bg">
        {/* ONE live region, mounted before its contents ever change. A `role="status"` node that is
            INSERTED with its message already inside it is not reliably spoken, and the transition
            this page most needs announced — still syncing, then empty — is exactly that swap. */}
        <p className="sr-only" role="status" aria-live="polite" data-testid="inbox-announcement">
          {!loaded
            ? 'Loading…'
            : visible.length === 0
              ? 'Nothing waiting'
              : `${visible.length} notifications, ${unread} unread`}
        </p>
        <section
          ref={containerRef}
          className="flex flex-1 flex-col overflow-y-auto outline-none"
          onKeyDown={onKeyDown}
          aria-label="Notifications"
        >
          {visible.length === 0 ? (
            loaded ? (
              <EmptyInbox teamId={anchor?.id} />
            ) : (
              <p className="p-8 text-sm text-text-3">Loading…</p>
            )
          ) : (
            <>
              {groups.map((group) => (
                <section key={group.key} aria-label={group.label}>
                  {/* The list's group band. No count: the unread number in band 2 is the only
                      number this surface states, and a second one beside it would be the
                      redundancy the diet removed. */}
                  <div className="flex h-[var(--density-group-header)] items-center border-t border-row-hairline bg-bg-hover px-5 text-[12.5px] font-semibold tracking-[-0.006em] text-text-1">
                    {group.label}
                  </div>
                  {group.rows.map((row) => {
                    const position = indexById.get(row.id) ?? 0
                    return (
                      <InboxRow
                        key={row.id}
                        index={position}
                        row={row}
                        focused={position === focusIndex}
                        teamName={isForeignTeam(row.teamId) ? teamNames.get(row.teamId) : undefined}
                        onFocusRow={setFocusedId}
                        onOpen={() => open(row)}
                      />
                    )
                  })}
                </section>
              ))}
              <Legend />
            </>
          )}
        </section>
      </div>
    </>
  )
}

// Band 2. Split out so the lens, the count and the absent control read as one anatomy rather than
// as four spread props on the page.
function Masthead({
  lens,
  onLens,
  loaded,
  populated,
  unread,
  error,
  onMarkAllRead,
}: {
  lens: Lens
  onLens: (next: Lens) => void
  loaded: boolean
  populated: boolean
  unread: number
  error: string | undefined
  onMarkAllRead: () => void
}) {
  const settled = loaded && populated
  return (
    <FrameMasthead
      title="Inbox"
      {...(settled ? { count: formatUnreadCount(unread) } : {})}
      {...(settled ? { lens: <InboxLens value={lens} onChange={onLens} /> } : {})}
      // ABSENT, not disabled: chrome that promises what the product cannot deliver at that moment
      // is worse than no chrome.
      {...(unread === 0
        ? {}
        : {
            actions: (
              <Button
                variant="outline"
                size="sm"
                data-testid="inbox-mark-all-read"
                onClick={onMarkAllRead}
              >
                Mark all read
              </Button>
            ),
          })}
      {...(error === undefined
        ? {}
        : {
            meta: (
              <span className="text-xs text-status-urgent-ink" role="alert">
                {error}
              </span>
            ),
          })}
    />
  )
}

const LENS_CLASS =
  'rounded-control px-2 py-0.5 font-ui text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent'

// Both positions are real controls with accessible names, and the current one is marked by
// `aria-pressed` as well as by ink and ground — never by hue alone.
function InboxLens({ value, onChange }: { value: Lens; onChange: (next: Lens) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-control bg-bg-sidebar p-0.5">
      {(['all', 'unread'] as const).map((position) => (
        <button
          key={position}
          type="button"
          aria-pressed={value === position}
          onClick={() => onChange(position)}
          className={cn(
            LENS_CLASS,
            value === position ? 'bg-bg-elevated text-text-1 shadow-sm' : 'text-text-2',
          )}
        >
          {position === 'all' ? 'All' : 'Unread'}
        </button>
      ))}
    </div>
  )
}

function InboxRow({
  index,
  row,
  focused,
  teamName,
  onFocusRow,
  onOpen,
}: {
  index: number
  row: NotificationRowData
  focused: boolean
  teamName: string | undefined
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
      aria-keyshortcuts="Enter e"
      onFocus={() => onFocusRow(row.id)}
      onClick={onOpen}
      className={cn(
        'group/notification-row relative flex min-h-[var(--density-row)] w-full items-center gap-3 border-t border-row-hairline px-4 text-left outline-none transition-colors hover:bg-bg-hover focus-visible:bg-bg-hover focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset',
        focused && 'bg-bg-selected',
      )}
    >
      {/* Position as well as colour: the rail marks the cursor where hue alone would not. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0 left-0 h-full w-[3px] rounded-r-full bg-accent transition-opacity',
          focused ? 'opacity-100' : 'opacity-0 group-focus-visible/notification-row:opacity-100',
        )}
      />

      {/* Channel one of three, and the only one that is a mark: present for unread, absent for
          read. The word beside it is what a screen reader hears. */}
      <span className="flex w-2 shrink-0 justify-center">
        {row.read ? null : <span aria-hidden="true" className="size-2 rounded-full bg-accent" />}
        <span className="sr-only">{row.read ? 'Read' : 'Unread'}</span>
      </span>

      <span className="flex w-4 shrink-0 justify-center">
        <KindGlyph kind={row.kind} className="size-3.5 text-text-2" />
      </span>
      {/* The glyph is a drawing, and a drawing is not a name. */}
      <span className="sr-only">{KIND_LABEL[row.kind]}</span>

      {/* Reserved and empty for a digest, which has no key: the column holds the list's alignment
          whether or not this row has a key to put in it. */}
      <span
        data-testid="notification-key"
        className="w-[62px] shrink-0 truncate font-mono text-xs tabular-nums text-text-2"
      >
        {row.subjectKey ?? ''}
      </span>

      {/* Channels two and three: the title's weight and the title's ink. This is the SNAPSHOT the
          notification stored, never a live read of the issue. */}
      <span
        data-testid="notification-title"
        className={cn(
          'min-w-0 flex-1 truncate text-[13.5px] tracking-[-0.008em]',
          row.read ? 'font-normal text-text-2' : 'font-semibold text-text-1',
        )}
      >
        {row.subjectTitle}
      </span>

      {teamName === undefined ? null : (
        <span
          data-testid="notification-team"
          className="max-w-[110px] shrink-0 truncate rounded-[5px] border border-border-strong px-1.5 py-px font-mono text-[10.5px] text-text-2"
        >
          {teamName}
        </span>
      )}

      {/* Capped like the team tag: the actor's name is free text and falls back to a full email
          address, which unbounded would squeeze the stored title — the row's primary content —
          off the line. */}
      <span
        data-testid="notification-phrase"
        className="max-w-[200px] shrink-0 truncate text-[12.5px] text-text-2"
      >
        {row.phrase}
      </span>

      {/* The shipped list's age column, byte-for-byte: past seven days `formatRelative` emits a
          locale date (`Aug 9`), which needs the width and the nowrap or it stacks two lines. */}
      <span
        data-testid="notification-age"
        className="w-[42px] shrink-0 whitespace-nowrap text-right font-mono text-[10.5px] tabular-nums text-text-3"
      >
        {formatRelative(row.createdAt)}
      </span>
    </button>
  )
}

function Key({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-bg-elevated px-1 py-px font-mono text-[10px] text-text-2">
      {children}
    </kbd>
  )
}

// The keys, drawn — and READ. `j` and `k` are bindings no `aria-keyshortcuts` on this page states,
// so hiding the footline would leave them stated to sighted readers only. Only the dividers, which
// are punctuation rather than words, are hidden.
function Legend() {
  const divider = (
    <span aria-hidden="true" className="text-border-strong">
      ·
    </span>
  )
  return (
    <div className="mt-auto flex items-center gap-[7px] px-5 pt-3 pb-3.5 text-[11.5px] text-text-2">
      <Key>j</Key>
      <Key>k</Key>
      <span>move</span>
      {divider}
      <Key>⏎</Key>
      <span>open</span>
      {divider}
      <Key>e</Key>
      <span>read</span>
    </div>
  )
}

// The mock's second frame. An empty inbox is the state a good one is in most of the time, so it is
// drawn as a composed surface: the settled loop, two words, the kinds that arrive here, and two
// doorways. No explanatory sentence — the word diet's CHROME tier holds here too.
function EmptyInbox({ teamId }: { teamId: string | undefined }) {
  return (
    <div
      data-testid="inbox-empty"
      className="flex flex-1 flex-col items-center justify-center gap-[11px] px-8 py-20"
    >
      <SettledLoop className="size-[34px] text-border-strong" />
      <span className="font-heading text-[15px] font-semibold tracking-[-0.008em] text-text-1">
        Nothing waiting
      </span>
      <span className="font-mono text-[11px] tracking-[0.02em] text-text-2">
        {KIND_WORDS.join(' · ')}
      </span>
      <span className="mt-1.5 flex items-center gap-[18px] text-[12.5px] text-text-2">
        {teamId === undefined ? null : (
          <Doorway to="/teams/$teamId/issues" teamId={teamId} label="Issues" />
        )}
        <Doorway to="/" label="Home" />
      </span>
    </div>
  )
}

function Doorway(
  props:
    | { to: '/teams/$teamId/issues'; teamId: string; label: string }
    | { to: '/'; label: string },
) {
  const className =
    'rounded-control outline-none hover:text-accent-strong focus-visible:ring-2 focus-visible:ring-accent'
  const chevron = (
    <span aria-hidden="true" className="ml-1 text-text-3">
      ›
    </span>
  )
  return props.to === '/' ? (
    <Link to="/" className={className}>
      {props.label}
      {chevron}
    </Link>
  ) : (
    <Link to={props.to} params={{ teamId: props.teamId }} search={{}} className={className}>
      {props.label}
      {chevron}
    </Link>
  )
}
