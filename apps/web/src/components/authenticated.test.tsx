import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import type { SyncSessionState } from '@/zero/provider'

const mocks = vi.hoisted(() => ({
  session: { status: 'pending', userID: null, role: null, unavailable: false } as SyncSessionState,
  refresh: vi.fn(),
  retry: vi.fn(),
}))

vi.mock('@/auth/client', () => ({
  useSession: () => ({ data: { user: { id: 'user-1', email: 'ada@example.com' } } }),
}))

vi.mock('@/zero/provider', () => ({
  useSyncSession: () => mocks.session,
  useSyncControl: () => ({ refresh: mocks.refresh, retry: mocks.retry }),
}))

vi.mock('@tanstack/react-router', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="navigate">{to}</div>,
}))

vi.mock('@/components/access-gate', () => ({
  AccessGate: () => <div data-testid="access-gate" />,
}))

import { Authenticated } from './authenticated'

function show() {
  render(
    <Authenticated>
      <div data-testid="app" />
    </Authenticated>,
  )
}

beforeEach(() => {
  mocks.session = { status: 'pending', userID: null, role: null, unavailable: false }
  mocks.refresh.mockReset()
  mocks.retry.mockReset()
})

test('a member reaches the app', () => {
  mocks.session = { status: 'ready', userID: 'user-1', role: 'member', unavailable: false }
  show()

  expect(screen.getByTestId('app')).toBeInTheDocument()
})

test('a real rejection still redirects to login', () => {
  mocks.session = { status: 'logged-out', userID: null, role: null, unavailable: false }
  show()

  expect(screen.getByTestId('navigate')).toHaveTextContent('/login')
})

test('an authenticated non-member still sees the access gate', () => {
  mocks.session = { status: 'ready', userID: 'user-1', role: null, unavailable: false }
  show()

  expect(screen.getByTestId('access-gate')).toBeInTheDocument()
})

test('the first credential request in flight shows the plain loading state', () => {
  show()

  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  expect(screen.queryByTestId('sync-unavailable')).not.toBeInTheDocument()
})

test('an unreachable server is a retry surface, never a redirect to login', () => {
  mocks.session = { status: 'pending', userID: null, role: null, unavailable: true }
  show()

  expect(screen.queryByTestId('navigate')).not.toBeInTheDocument()
  expect(screen.getByTestId('sync-unavailable')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
})

test('the retry surface never blames the user for an outage it can fix itself', () => {
  mocks.session = { status: 'pending', userID: null, role: null, unavailable: true }
  show()

  expect(screen.getByRole('status')).toHaveTextContent(/retrying/i)
  expect(screen.queryByText(/sign in|signed out|logged out/i)).not.toBeInTheDocument()
})

// Coalescing, not forcing: an outage retry that discarded the answer already in flight and
// queued a fresh request behind it would make pressing the button slower than waiting.
test('the retry button is keyboard-operable and joins the open credential request', () => {
  mocks.session = { status: 'pending', userID: null, role: null, unavailable: true }
  show()

  const retry = screen.getByTestId('sync-unavailable-retry')
  expect(retry.tagName).toBe('BUTTON')
  retry.focus()
  expect(retry).toHaveFocus()

  fireEvent.click(retry)
  expect(mocks.retry).toHaveBeenCalledTimes(1)
  expect(mocks.refresh).not.toHaveBeenCalled()
})
