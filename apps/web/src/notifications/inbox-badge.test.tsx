import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { NotificationSyncedRow } from './model'

const inbox = vi.hoisted(() => ({ rows: [] as NotificationSyncedRow[] }))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [inbox.rows, { type: 'complete' }],
}))

import { InboxBadge } from './inbox-badge'

function unread(subjectId: string): NotificationSyncedRow {
  return {
    kind: 'issue_assigned',
    teamId: 'team-1',
    subjectType: 'issue',
    subjectId,
    subjectKey: 'ENG-1',
    subjectTitle: 'A title',
    eventKey: '1',
    actorId: 'user-a',
    readAt: null,
    createdAt: 1_000,
    actor: { id: 'user-a', name: 'Dana' },
  }
}

async function show(rows: NotificationSyncedRow[]) {
  inbox.rows = rows
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component: InboxBadge }),
    createRoute({ getParentRoute: () => rootRoute, path: '/inbox', component: () => null }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
  return await screen.findByTestId('inbox-badge')
}

test('the badge states the unread count in its accessible name', async () => {
  const badge = await show([unread('issue-1'), unread('issue-2'), unread('issue-3')])

  expect(badge).toHaveAccessibleName('Inbox, 3 unread')
  expect(badge).toHaveTextContent('3')
})

test('an empty inbox still announces a count and shows no pill', async () => {
  const badge = await show([])

  expect(badge).toHaveAccessibleName('Inbox, 0 unread')
  expect(badge).toHaveTextContent('')
})

test('read rows do not count', async () => {
  const badge = await show([unread('issue-1'), { ...unread('issue-2'), readAt: 2_000 }])

  expect(badge).toHaveAccessibleName('Inbox, 1 unread')
})

test('the badge is a keyboard-reachable link to the inbox', async () => {
  const badge = await show([unread('issue-1')])

  expect(badge.tagName).toBe('A')
  expect(badge).toHaveAttribute('href', '/inbox')
})
