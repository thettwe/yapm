import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The two menus in the app header, OPENED. A menu popup builds nothing until it opens, so a part
// that throws on mount — a group label without its group, which is what took the account menu and
// every settings entry hanging off it down — renders perfectly in a test that only asserts the
// trigger. These tests click the trigger and read what is inside.

const membership = vi.hoisted(() => ({ canManage: true }))
vi.mock('@/auth/use-membership', () => ({ useMembership: () => membership }))
vi.mock('@/auth/client', () => ({ signOut: vi.fn(() => Promise.resolve()) }))

// The switcher asks for the workspace and then for the teams, in that order, on every render.
const zero = vi.hoisted(() => ({
  workspace: { id: 'workspace-1', name: 'Acme' },
  teams: [
    { id: 'team-1', name: 'Engineering' },
    { id: 'team-2', name: 'Design' },
  ],
  calls: 0,
}))
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => {
    const index = zero.calls++
    return [index % 2 === 0 ? zero.workspace : zero.teams, { type: 'complete' }]
  },
}))

import { Switcher } from './switcher'
import { UserMenu } from './user-menu'

function mount(component: () => React.ReactNode) {
  const rootRoute = createRootRoute()
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: '/', component }),
    createRoute({ getParentRoute: () => rootRoute, path: '/login', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/teams/$teamId', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings/ai', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/settings/connectors',
      component: () => null,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/settings/sso', component: () => null }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/teams/$teamId/members',
      component: () => null,
    }),
    createRoute({ getParentRoute: () => rootRoute, path: '/digests', component: () => null }),
    createRoute({ getParentRoute: () => rootRoute, path: '/showcase', component: () => null }),
  ])
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  render(<RouterProvider router={router} />)
}

beforeEach(() => {
  zero.calls = 0
  membership.canManage = true
})

test('the account menu opens and every entry an admin has is reachable', async () => {
  mount(() => <UserMenu name="Ada" email="ada@example.test" onOpenAppearance={() => {}} />)

  fireEvent.click(await screen.findByRole('button', { name: /account menu for ada/i }))

  expect(await screen.findByRole('menuitem', { name: 'Single sign-on' })).toBeInTheDocument()
  // Appearance is a setting, so it folded into this menu with the rest of them.
  expect(screen.getByRole('menuitem', { name: 'Appearance' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Connectors' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'AI' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  // The label names the group it sits in rather than standing loose in the popup.
  expect(screen.getByText('Signed in as ada@example.test')).toBeInTheDocument()
})

test('a non-admin opens the same menu and finds only what they may do', async () => {
  membership.canManage = false
  mount(() => <UserMenu name="Ada" email="ada@example.test" onOpenAppearance={() => {}} />)

  fireEvent.click(await screen.findByRole('button', { name: /account menu for ada/i }))

  expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument()
  expect(screen.queryByRole('menuitem', { name: 'Single sign-on' })).not.toBeInTheDocument()
})

test('the workspace switcher opens with all three of its labelled groups', async () => {
  mount(() => <Switcher teamName="Engineering" teamId="team-1" />)

  fireEvent.click(await screen.findByRole('button', { name: /switch workspace or team/i }))

  expect(await screen.findByRole('menuitem', { name: 'Acme' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Engineering' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Design' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Members' })).toBeInTheDocument()
  expect(screen.getByText('Workspace')).toBeInTheDocument()
  expect(screen.getByText('Teams')).toBeInTheDocument()
  expect(screen.getByText('This team')).toBeInTheDocument()
})
