import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { NotificationSyncedRow } from './model'

interface MutateCall {
  args: Record<string, unknown>
}

interface TeamRow {
  id: string
  key: string
  name: string
}

const zero = vi.hoisted(() => ({
  rows: [] as import('./model').NotificationSyncedRow[],
  teams: [] as { id: string; key: string; name: string }[],
  complete: true,
  // A sync tick is a push, not a re-render the test performs: the mocked query subscribes, so a
  // changed row set reaches the mounted list the way zero-cache delivers one.
  listeners: new Set<() => void>(),
  // Every named query this surface opens, so a second one arriving unnoticed is visible to the
  // test rather than silently served the notification rows.
  opened: [] as string[],
  mutate: vi.fn((_mutation: { args: Record<string, unknown> }) => ({
    client: Promise.resolve({ type: 'success' }),
    server: Promise.resolve({ type: 'success' }),
  })),
}))

vi.mock('@rocicorp/zero/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useQuery: (request: unknown) => {
      const name = (request as { query: { queryName: string } }).query.queryName
      zero.opened.push(name)
      const rows = useSyncExternalStore(
        (onChange: () => void) => {
          zero.listeners.add(onChange)
          return () => {
            zero.listeners.delete(onChange)
          }
        },
        () => (name === 'teams.all' ? zero.teams : zero.rows),
      )
      return [rows, { type: name === 'teams.all' || zero.complete ? 'complete' : 'unknown' }]
    },
    useZero: () => ({ mutate: zero.mutate }),
  }
})

import { InboxView } from './inbox-view'

function calls(): MutateCall[] {
  return zero.mutate.mock.calls.map((call) => call[0])
}

function row(overrides: Partial<NotificationSyncedRow> = {}): NotificationSyncedRow {
  return {
    kind: 'issue_assigned',
    teamId: 'team-1',
    subjectType: 'issue',
    subjectId: 'issue-1',
    subjectKey: 'ENG-1',
    subjectTitle: 'Fix the reconnect loop',
    eventKey: '1000',
    actorId: 'user-a',
    readAt: null,
    createdAt: 3_000,
    actor: { id: 'user-a', name: 'Dana' },
    ...overrides,
  }
}

let landed: { teamId: string; open: string | undefined } | null = null

async function mount(rows: NotificationSyncedRow[], teams: TeamRow[] = [DEFAULT_TEAM]) {
  zero.rows = rows
  zero.teams = teams
  const rootRoute = createRootRoute()
  const inboxRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: InboxView,
  })
  const issuesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/teams/$teamId/issues',
    validateSearch: (search: Record<string, unknown>) => ({
      open: typeof search.open === 'string' ? search.open : undefined,
    }),
    component: function Landed() {
      const { teamId } = issuesRoute.useParams()
      const { open } = issuesRoute.useSearch()
      landed = { teamId, open }
      return <div data-testid="issue-page" />
    },
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([inboxRoute, issuesRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  await screen.findByRole('heading', { name: 'Inbox' })
  return {
    sync: (next: NotificationSyncedRow[]) => {
      act(() => {
        zero.rows = next
        for (const listener of [...zero.listeners]) listener()
      })
    },
  }
}

const DEFAULT_TEAM: TeamRow = { id: 'team-1', key: 'ENG', name: 'Engineering' }

async function show(rows: NotificationSyncedRow[], teams: TeamRow[] = [DEFAULT_TEAM]) {
  await mount(rows, teams)
}

function titles(): string[] {
  return screen.getAllByTestId('notification-title').map((el) => el.textContent ?? '')
}

beforeEach(() => {
  zero.mutate.mockClear()
  zero.complete = true
  zero.opened = []
  landed = null
})

test('the list renders newest first and shows no body text', async () => {
  await show([
    row({ subjectId: 'issue-1', subjectKey: 'ENG-1', createdAt: 1_000 }),
    row({
      subjectId: 'issue-2',
      subjectKey: 'ENG-2',
      kind: 'issue_commented',
      eventKey: 'comment-1',
      createdAt: 5_000,
    }),
  ])

  const rows = screen.getAllByTestId('notification-row')
  expect(rows).toHaveLength(2)
  expect(rows[0]).toHaveTextContent('Dana commented')
  expect(rows[1]).toHaveTextContent('Dana assigned you')
})

// THE FALSIFIABLE CHECK. On `main` the row's headline is the full sentence — `Dana commented on
// ENG-117`, `A cycle digest was shared with you` — there is no phrase element at all, and the kind
// is nowhere in the accessibility tree. Here the stored snapshot is the title, the actor-and-verb
// is its own column, and the kind is a word.
test('a row draws the stored subject as its title, with the actor-and-verb beside it', async () => {
  await show([
    row({
      kind: 'pm_digest_published',
      subjectType: 'pm_digest',
      subjectId: 'digest-1',
      subjectKey: null,
      subjectTitle: 'Engineering · Cycle 2',
      eventKey: 'digest-1',
      actor: null,
      createdAt: 5_000,
    }),
    row({
      kind: 'issue_commented',
      subjectId: 'issue-117',
      subjectKey: 'ENG-117',
      subjectTitle: 'Rate-limit the coupon endpoint',
      eventKey: 'comment-1',
      actor: { id: 'user-m', name: 'Marta' },
      createdAt: 4_000,
    }),
  ])

  const rows = screen.getAllByTestId('notification-row')
  const digest = within(rows[0] as HTMLElement)
  const comment = within(rows[1] as HTMLElement)

  expect(digest.getByTestId('notification-title')).toHaveTextContent('Engineering · Cycle 2')
  expect(digest.getByTestId('notification-phrase')).toHaveTextContent('Shared with you')
  // Reserved, and empty: a digest has no key, and the column still holds the list's alignment.
  expect(digest.getByTestId('notification-key')).toHaveTextContent('')
  expect(digest.getByText('Digest')).toBeInTheDocument()

  expect(comment.getByTestId('notification-title')).toHaveTextContent(
    'Rate-limit the coupon endpoint',
  )
  expect(comment.getByTestId('notification-key')).toHaveTextContent('ENG-117')
  expect(comment.getByTestId('notification-phrase')).toHaveTextContent('Marta commented')
  expect(comment.getByText('Commented')).toBeInTheDocument()
})

// Read and unread survive the loss of colour: the assertion is on structure — the mark's presence,
// the title's weight class, the attribute and the word — never on a hue.
test('read and unread differ by the gutter mark, the title weight and a word', async () => {
  await show([
    row({ subjectId: 'issue-1', createdAt: 5_000 }),
    row({ subjectId: 'issue-2', eventKey: '2000', createdAt: 4_000, readAt: 9_000 }),
  ])

  const rows = screen.getAllByTestId('notification-row')
  const unread = within(rows[0] as HTMLElement)
  const read = within(rows[1] as HTMLElement)

  expect(rows[0]).toHaveAttribute('data-read', 'false')
  expect(rows[1]).toHaveAttribute('data-read', 'true')
  expect(unread.getByText('Unread')).toBeInTheDocument()
  expect(read.getByText('Read')).toBeInTheDocument()
  expect(unread.getByTestId('notification-title').className).toContain('font-semibold')
  expect(read.getByTestId('notification-title').className).toContain('font-normal')
})

test('j and k walk the list without a pointer', async () => {
  await show([
    row({ subjectId: 'issue-1', createdAt: 5_000 }),
    row({ subjectId: 'issue-2', createdAt: 4_000 }),
  ])

  const list = screen.getByRole('region', { name: 'Notifications' })
  const rows = screen.getAllByTestId('notification-row')

  fireEvent.keyDown(list, { key: 'j' })
  expect(rows[1]).toHaveFocus()

  fireEvent.keyDown(list, { key: 'k' })
  expect(rows[0]).toHaveFocus()

  // The cursor stops at the ends rather than wrapping.
  fireEvent.keyDown(list, { key: 'ArrowUp' })
  expect(rows[0]).toHaveFocus()
})

test('e marks the focused row read, addressing it by its natural key', async () => {
  await show([row({ subjectId: 'issue-1' })])

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'e' })

  expect(calls()[0]?.args).toEqual({
    kind: 'issue_assigned',
    subjectId: 'issue-1',
    eventKey: '1000',
    readAt: expect.any(Number),
  })
})

test('e on an already-read row clears the stamp rather than re-stamping it', async () => {
  await show([row({ subjectId: 'issue-1', readAt: 9_000 })])

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'e' })

  expect(calls()[0]?.args).toMatchObject({ subjectId: 'issue-1', readAt: null })
})

test('Right opens the subject and marks it read', async () => {
  await show([row({ subjectId: 'issue-1', teamId: 'team-7' })])

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'ArrowRight' })

  expect(await screen.findByTestId('issue-page')).toBeInTheDocument()
  expect(landed).toEqual({ teamId: 'team-7', open: 'issue-1' })
  expect(calls()[0]?.args).toMatchObject({ subjectId: 'issue-1', readAt: expect.any(Number) })
})

test('Enter activates the focused row through its own button, exactly once', async () => {
  await show([row({ subjectId: 'issue-1', teamId: 'team-7' })])

  const first = screen.getAllByTestId('notification-row')[0] as HTMLElement
  fireEvent.click(first)

  expect(await screen.findByTestId('issue-page')).toBeInTheDocument()
  expect(calls()).toHaveLength(1)
})

// A control that cannot act is ABSENT, not dimmed.
test('mark all read is absent with nothing unread and present when something is', async () => {
  await show([row({ subjectId: 'issue-1', readAt: 9_000 })])

  expect(screen.queryByTestId('inbox-mark-all-read')).not.toBeInTheDocument()
  // The unread reading is the masthead's count slot now — same capped number, one band-2 anatomy.
  expect(screen.getByTestId('masthead-count')).toHaveTextContent('0')

  screen.getByRole('button', { name: 'Unread' })
})

test('mark all read calls the shared mutator once', async () => {
  await show([row({ subjectId: 'issue-1' }), row({ subjectId: 'issue-2', eventKey: '2000' })])

  fireEvent.click(screen.getByTestId('inbox-mark-all-read'))

  expect(calls()).toHaveLength(1)
  expect(calls()[0]?.args).toEqual({ readAt: expect.any(Number) })
})

// The lens filters rows the client already holds. It opens no query, it changes no count, and the
// cursor cannot be left pointing at a row it removed from the page.
test('the unread lens narrows the drawn rows without a second query or a moved count', async () => {
  await show([
    row({ subjectId: 'issue-1', subjectTitle: 'Still unread', createdAt: 5_000 }),
    row({
      subjectId: 'issue-2',
      eventKey: '2000',
      subjectTitle: 'Already read',
      createdAt: 4_000,
      readAt: 9_000,
    }),
  ])
  const before = [...new Set(zero.opened)]

  const list = screen.getByRole('region', { name: 'Notifications' })
  fireEvent.keyDown(list, { key: 'j' })
  expect(screen.getAllByTestId('notification-row')[1]).toHaveFocus()

  fireEvent.click(screen.getByRole('button', { name: 'Unread' }))

  expect(titles()).toEqual(['Still unread'])
  expect(screen.getByTestId('masthead-count')).toHaveTextContent('1')
  expect([...new Set(zero.opened)]).toEqual(before)
  expect(screen.getByRole('button', { name: 'Unread' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')

  // The cursor was on the read row, which the lens removed; it lands on a drawn row and `e`
  // therefore cannot act on something the reader cannot see.
  const drawn = screen.getAllByTestId('notification-row')
  expect(drawn).toHaveLength(1)
  expect(drawn[0]).toHaveFocus()
  fireEvent.keyDown(list, { key: 'e' })
  expect(calls()[0]?.args).toMatchObject({ subjectId: 'issue-1' })

  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(titles()).toEqual(['Still unread', 'Already read'])
})

// THE CURSOR IS A ROW, NOT A POSITION. This list is live and newest-first, so anything arriving
// while somebody is reading shifts every index below it. Anchored on a flat index, the cursor
// silently re-points at a different notification and the next `e` or Enter acts on the wrong one.
test('a notification arriving above the cursor leaves the cursor on the same notification', async () => {
  const first = row({ subjectId: 'issue-1', eventKey: '1000', createdAt: 5_000 })
  const second = row({ subjectId: 'issue-2', eventKey: '2000', createdAt: 4_000 })
  const { sync } = await mount([first, second])

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'j' })
  expect(screen.getAllByTestId('notification-row')[1]).toHaveFocus()

  sync([row({ subjectId: 'issue-3', eventKey: '3000', createdAt: 9_000 }), first, second])

  const after = screen.getAllByTestId('notification-row')
  expect(after).toHaveLength(3)
  // issue-2 has moved from index 1 to index 2, and the cursor moved with it.
  expect(after[2]).toHaveFocus()

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'e' })
  expect(calls()[0]?.args).toMatchObject({ subjectId: 'issue-2', eventKey: '2000' })
})

test('the cursor falls back to a nearby row when the one it was on leaves the list', async () => {
  const first = row({ subjectId: 'issue-1', eventKey: '1000', createdAt: 5_000 })
  const second = row({ subjectId: 'issue-2', eventKey: '2000', createdAt: 4_000 })
  const { sync } = await mount([first, second])

  fireEvent.keyDown(screen.getByRole('region', { name: 'Notifications' }), { key: 'j' })
  sync([first])

  const after = screen.getAllByTestId('notification-row')
  expect(after).toHaveLength(1)
  expect(after[0]).toHaveFocus()
})

// The composed empty state, and the sentence that is no longer there: `main` renders "You're all
// caught up. Assignments, comments on issues you're involved in, and digests shared with you land
// here." — two sentences of explanation on a work surface.
test('an empty inbox is composed, with the kinds and two doorways and no explanation', async () => {
  await show([])

  const empty = within(screen.getByTestId('inbox-empty'))
  expect(empty.getByText('Nothing waiting')).toBeInTheDocument()
  expect(empty.getByText('assigned · commented · mentioned · digests')).toBeInTheDocument()
  expect(empty.getByRole('link', { name: /Issues/ })).toBeInTheDocument()
  expect(empty.getByRole('link', { name: /Home/ })).toBeInTheDocument()

  expect(screen.getByTestId('inbox-announcement')).toHaveTextContent('Nothing waiting')
  expect(screen.queryByText(/caught up/)).not.toBeInTheDocument()
  expect(screen.queryByText(/land here/)).not.toBeInTheDocument()

  // Band 2 on the mock's second frame is the title alone: no `0` to read, and no lens over
  // nothing. `Mark all read` is already absent by the same rule.
  expect(screen.getByRole('heading', { name: 'Inbox' })).toBeInTheDocument()
  expect(screen.queryByTestId('masthead-count')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Unread' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'All' })).not.toBeInTheDocument()
  expect(screen.queryByTestId('inbox-mark-all-read')).not.toBeInTheDocument()
})

// The lens must survive its own success: a reader who clears the last unread row while looking
// through `Unread` still has the control that gets them back to `All`.
test('clearing the last unread row under the lens keeps the lens drawn', async () => {
  const unread = row({ subjectId: 'issue-1', subjectTitle: 'Still unread', createdAt: 5_000 })
  const read = row({
    subjectId: 'issue-2',
    eventKey: '2000',
    subjectTitle: 'Already read',
    createdAt: 4_000,
    readAt: 9_000,
  })
  const { sync } = await mount([unread, read])

  fireEvent.click(screen.getByRole('button', { name: 'Unread' }))
  expect(titles()).toEqual(['Still unread'])

  sync([{ ...unread, readAt: 9_500 }, read])

  expect(screen.getByTestId('inbox-empty')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'All' }))
  expect(titles()).toEqual(['Still unread', 'Already read'])
})

// An all-clear announced before the answer is known is a lie, and one live region must carry both
// states — a region INSERTED with its message already inside it is not reliably spoken.
test('an incomplete result says it is loading and draws no empty state and no count', async () => {
  zero.complete = false
  const { sync } = await mount([])

  expect(screen.queryByTestId('inbox-empty')).not.toBeInTheDocument()
  expect(screen.queryByTestId('masthead-count')).not.toBeInTheDocument()
  const region = screen.getByTestId('inbox-announcement')
  expect(region).toHaveTextContent('Loading…')

  zero.complete = true
  sync([])

  expect(screen.getByTestId('inbox-empty')).toBeInTheDocument()
  // The SAME node carried both messages.
  expect(screen.getByTestId('inbox-announcement')).toBe(region)
  expect(region).toHaveTextContent('Nothing waiting')
})

test('the day bands are the list’s group header and carry no count', async () => {
  const now = Date.now()
  await show([
    row({ subjectId: 'issue-1', createdAt: now }),
    row({ subjectId: 'issue-2', eventKey: '2000', createdAt: now - 9 * 86_400_000 }),
  ])

  const bands = screen.getAllByRole('region').filter((el) => el.getAttribute('aria-label') !== null)
  const labels = bands
    .map((el) => el.getAttribute('aria-label'))
    .filter((label) => label !== 'Notifications')
  expect(labels).toEqual(['Today', 'Earlier'])
  expect(screen.getByText('Today')).toHaveTextContent(/^Today$/)
})

// The degenerate states, asserted rather than assumed.
test('one row draws one row, with the keys stated on the surface', async () => {
  await show([row({ subjectId: 'issue-1' })])

  expect(screen.getAllByTestId('notification-row')).toHaveLength(1)
  expect(screen.getByText('move')).toBeInTheDocument()
  expect(screen.getByText('open')).toBeInTheDocument()
  expect(screen.getByText('read')).toBeInTheDocument()
})

test('a very long stored title stays on one line and leaves the age column standing', async () => {
  const long = 'A'.repeat(300)
  await show([row({ subjectId: 'issue-1', subjectTitle: long })])

  const title = screen.getByTestId('notification-title')
  expect(title).toHaveTextContent(long)
  expect(title.className).toContain('truncate')
  // The phrase and the age keep their own columns rather than being pushed off the row.
  expect(screen.getByTestId('notification-phrase')).toHaveTextContent('Dana assigned you')
})

// The tag names the team the DECK is not pointing at. On the deck's own team it would be the same
// word on every line, which is the noise the render pass caught.
test('only a row outside the deck’s team draws the tag', async () => {
  await show(
    [
      row({ subjectId: 'issue-1', teamId: 'team-1', createdAt: 5_000 }),
      row({ subjectId: 'issue-2', eventKey: '2000', teamId: 'team-2', createdAt: 4_000 }),
    ],
    [DEFAULT_TEAM, { id: 'team-2', key: 'DES', name: 'Design' }],
  )

  const tags = screen.getAllByTestId('notification-team')
  expect(tags).toHaveLength(1)
  expect(tags[0]).toHaveTextContent('Design')
})

test('a team the client cannot name draws no tag rather than an id', async () => {
  await show([
    row({ subjectId: 'issue-1', teamId: 'team-1', createdAt: 5_000 }),
    row({ subjectId: 'issue-2', eventKey: '2000', teamId: 'team-gone', createdAt: 4_000 }),
  ])

  expect(screen.queryAllByTestId('notification-team')).toHaveLength(0)
  expect(screen.queryByText('team-gone')).toBeNull()
})

test('a single-team list draws no team tag on any row', async () => {
  await show([
    row({ subjectId: 'issue-1', createdAt: 5_000 }),
    row({ subjectId: 'issue-2', eventKey: '2000', createdAt: 4_000 }),
  ])

  expect(screen.queryAllByTestId('notification-team')).toHaveLength(0)
})

// Fifty rows is still one row per notification: no roll-up, no thread, no collapse control.
test('fifty notifications about one issue stay fifty rows', async () => {
  await show(
    Array.from({ length: 50 }, (_, index) =>
      row({
        kind: 'issue_commented',
        subjectId: 'issue-1',
        eventKey: `comment-${index}`,
        createdAt: 5_000 - index,
      }),
    ),
  )

  expect(screen.getAllByTestId('notification-row')).toHaveLength(50)
})

// Nothing on this surface reads the subject entity: one query, and it is the inbox's own.
test('the surface opens no query beyond the inbox and the already-synced team list', async () => {
  await show([row({ subjectId: 'issue-1' })])

  expect([...new Set(zero.opened)].sort()).toEqual(['notifications.mine', 'teams.all'])
})
