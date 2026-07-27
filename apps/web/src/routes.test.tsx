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

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => ({ status: 'logged-out', userID: null, role: null, unavailable: false }),
  useSyncControl: () => ({ retry: vi.fn() }),
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
