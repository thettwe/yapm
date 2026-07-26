import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const zero = vi.hoisted(() => ({
  row: undefined as { state: string } | undefined,
  listeners: new Set<() => void>(),
  mutate: vi.fn(
    (_mutation: { mutator: { mutatorName: string }; args: Record<string, unknown> }) => ({
      client: Promise.resolve({ type: 'success' }),
      server: Promise.resolve({ type: 'success' }),
    }),
  ),
}))

vi.mock('@rocicorp/zero/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    // A sync tick is a push, not a re-render the test performs: the mocked query subscribes, so a
    // changed row reaches the mounted control the way zero-cache delivers one.
    useQuery: () => [
      useSyncExternalStore(
        (onChange: () => void) => {
          zero.listeners.add(onChange)
          return () => {
            zero.listeners.delete(onChange)
          }
        },
        () => zero.row,
      ),
      { type: 'complete' },
    ],
    useZero: () => ({ mutate: zero.mutate }),
  }
})

import { FOLLOWING_HINT, FollowControl, NOT_FOLLOWING_HINT } from './follow-control'

function mutatorNames(): string[] {
  return zero.mutate.mock.calls.map((call) => call[0].mutator.mutatorName)
}

function sync(row: { state: string } | undefined) {
  act(() => {
    zero.row = row
    for (const listener of [...zero.listeners]) listener()
  })
}

beforeEach(() => {
  zero.mutate.mockClear()
  zero.row = undefined
})

test('with no synced row the control offers to follow and says what that does', () => {
  render(<FollowControl issueId="issue-1" />)

  const button = screen.getByRole('button', { name: 'Follow' })
  expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(screen.getByText(NOT_FOLLOWING_HINT)).toBeInTheDocument()
})

test('a subscribed row reads as following and states how to stop', () => {
  zero.row = { state: 'subscribed' }
  render(<FollowControl issueId="issue-1" />)

  const button = screen.getByRole('button', { name: 'Following' })
  expect(button).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByText(FOLLOWING_HINT)).toBeInTheDocument()
})

test('an unsubscribed row reads as not following, so an unfollow sticks visibly', () => {
  zero.row = { state: 'unsubscribed' }
  render(<FollowControl issueId="issue-1" />)

  expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
})

// The keyboard contract here is native `<button>` semantics rather than a hand-rolled key handler:
// in the tab order, no negative tabindex, not disabled, and activated by Enter and Space by the
// browser itself. Asserting the element's nature is the honest jsdom proof; the real keystroke is
// an e2e concern.
test('the control is a real button in the tab order', () => {
  render(<FollowControl issueId="issue-1" />)

  const button = screen.getByRole('button', { name: 'Follow' })
  expect(button.tagName).toBe('BUTTON')
  expect(button).not.toBeDisabled()
  expect(button).not.toHaveAttribute('tabindex', '-1')

  button.focus()
  expect(button).toHaveFocus()
})

test('activating the control toggles through follow and unfollow, reflecting the synced row', () => {
  render(<FollowControl issueId="issue-1" />)

  fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
  expect(mutatorNames()).toEqual(['issueSubscription.follow'])
  expect(zero.mutate.mock.calls[0]?.[0].args).toMatchObject({ issueId: 'issue-1' })

  // Optimistic: the mutator's client pass writes the row, and the control renders the synced value
  // rather than local state, so it never disagrees with what actually landed.
  sync({ state: 'subscribed' })
  expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true')

  fireEvent.click(screen.getByRole('button', { name: 'Following' }))
  expect(mutatorNames()).toEqual(['issueSubscription.follow', 'issueSubscription.unfollow'])

  sync({ state: 'unsubscribed' })
  expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
})

test('no follower count and no subscriber list is rendered', () => {
  zero.row = { state: 'subscribed' }
  render(<FollowControl issueId="issue-1" />)

  expect(screen.queryByRole('list')).toBeNull()
  expect(screen.getByRole('button').textContent).toBe('Following')
})
