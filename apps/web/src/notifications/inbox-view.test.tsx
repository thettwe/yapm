import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { NotificationSyncedRow } from './model'

interface MutateCall {
  args: Record<string, unknown>
}

const zero = vi.hoisted(() => ({
  rows: [] as import('./model').NotificationSyncedRow[],
  mutate: vi.fn((_mutation: { args: Record<string, unknown> }) => ({
    client: Promise.resolve({ type: 'success' }),
    server: Promise.resolve({ type: 'success' }),
  })),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [zero.rows, { type: 'complete' }],
  useZero: () => ({ mutate: zero.mutate }),
}))

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

async function show(rows: NotificationSyncedRow[]) {
  zero.rows = rows
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
  return await screen.findByRole('heading', { name: 'Inbox' })
}

beforeEach(() => {
  zero.mutate.mockClear()
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
  expect(rows[0]).toHaveTextContent('Dana commented on ENG-2')
  expect(rows[1]).toHaveTextContent('Dana assigned you ENG-1')
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

test('mark all read is disabled with nothing unread', async () => {
  await show([row({ subjectId: 'issue-1', readAt: 9_000 })])

  expect(screen.getByTestId('inbox-mark-all-read')).toBeDisabled()
  expect(screen.getByTestId('inbox-unread-count')).toHaveTextContent('0')
})

test('mark all read calls the shared mutator once', async () => {
  await show([row({ subjectId: 'issue-1' }), row({ subjectId: 'issue-2', eventKey: '2000' })])

  fireEvent.click(screen.getByTestId('inbox-mark-all-read'))

  expect(calls()).toHaveLength(1)
  expect(calls()[0]?.args).toEqual({ readAt: expect.any(Number) })
})

test('an empty inbox says so once the query has settled', async () => {
  await show([])

  expect(screen.getByRole('status')).toHaveTextContent("You're all caught up")
})
