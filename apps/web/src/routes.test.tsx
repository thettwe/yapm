import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { routeTree } from './routeTree.gen'

vi.mock('@/auth/client', () => ({
  authClient: {},
  signIn: { email: vi.fn(), social: vi.fn(), sso: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  useSession: () => ({ data: null, isPending: false }),
}))

vi.mock('@/auth/use-auth-methods', () => ({
  useAuthMethods: () => ({ emailPassword: true, github: false, sso: true }),
}))

// Every `/teams/$teamId/*` route reads the connection pill in its own body, above `Authenticated`,
// so the hook runs even for a caller who is about to be redirected to login. It talks to the live
// Zero client; the routing facts this file asserts do not.
vi.mock('@/zero/connection', () => ({
  useConnectionSummary: () => ({
    state: 'connected',
    recovery: 'idle',
    label: 'Live',
    writable: true,
    retryOffered: false,
  }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({
    status: 'logged-out',
    userID: null,
    role: null,
    pmAudienceTeamIds: [],
    unavailable: false,
  }),
  useSyncControl: () => ({ retry: vi.fn(), refresh: vi.fn() }),
}))

test('the login route presents the sign-in surface to unauthenticated users', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()
  expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
  expect(screen.getByTestId('login-submit')).toBeInTheDocument()
})

// `/search` carries its query in the URL so a search is shareable and the back button behaves.
// The route is registered, it parses `q`, and — like every other in-app surface — it is behind
// `Authenticated`, so an unauthenticated caller lands on the sign-in surface instead of it.
test('the search route is registered, parses its query and is gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/search?q=qzt-alpha'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()

  const match = router.matchRoutes('/search', { q: 'qzt-alpha' })
  expect(match.at(-1)?.routeId).toBe('/search')
  expect(match.at(-1)?.search).toEqual({ q: 'qzt-alpha' })
})

// `/digests` is registered like any other route and is behind `Authenticated` first — whether the
// caller has an audience is decided AFTER that, inside the route, and never by the router. A route
// that existed only for named readers would be a permission fact encoded in the URL table, which
// every client downloads. `pm-digest.test.tsx` owns the audience gate itself.
test('the digests route is registered and gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/digests'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()
  expect(router.matchRoutes('/digests', {}).at(-1)?.routeId).toBe('/digests')
})

// The team Delivery view carries its window in the URL, so a reading is shareable and the back
// button behaves — the same reason `/search` carries `q`. `validateSearch` narrows to the three
// offered sizes, so a hand-typed window cannot ask for an unbounded one.
test('the delivery route is registered, narrows its window and is gated behind authentication', async () => {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/teams/team-1/delivery?window=6'] }),
  })

  render(<RouterProvider router={router} />)

  expect(await screen.findByRole('heading', { name: /sign in to yapm/i })).toBeInTheDocument()

  const match = router.matchRoutes('/teams/$teamId/delivery', { window: 6 })
  expect(match.at(-1)?.routeId).toBe('/teams/$teamId/delivery')
  expect(match.at(-1)?.search).toEqual({ window: 6 })

  // Anything outside 3 / 6 / 12 falls back to the default rather than reaching the builder.
  expect(
    router.matchRoutes('/teams/$teamId/delivery', { window: 999 } as never).at(-1)?.search,
  ).toEqual({ window: 6 })
})
