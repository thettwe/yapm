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
