import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const zero = vi.hoisted(() => ({
  row: undefined as { state: string } | undefined,
  resultType: 'complete' as 'complete' | 'unknown' | 'error',
  retry: vi.fn(),
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
      zero.resultType === 'error'
        ? { type: 'error', retry: zero.retry, refetch: zero.retry, error: { type: 'app' } }
        : { type: zero.resultType },
    ],
    useZero: () => ({ mutate: zero.mutate }),
  }
})

import {
  FOLLOWING_HINT,
  FollowControl,
  NOT_FOLLOWING_HINT,
  PENDING_HINT,
  UNAVAILABLE_HINT,
} from './follow-control'

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
  zero.retry.mockClear()
  zero.row = undefined
  zero.resultType = 'complete'
})

// "No row yet" and "no subscription" look identical, and a subscriber opening the issue on a fresh
// client hits the first one. Rendering it as Follow / aria-pressed=false tells them something false
// about their own state and offers a button that would unfollow them.
//
// `aria-disabled`, not `disabled`: a native `disabled` button leaves the tab order and stops
// carrying its description, so the hint saying WHY it is not actionable is announced to nobody and
// the tab stop appears from under a keyboard user the moment zero-cache answers. The guard inside
// the handler — asserted here — is what makes the press harmless.
test('before the query has hydrated the control asserts nothing, stays focusable, and cannot fire', () => {
  zero.resultType = 'unknown'
  render(<FollowControl issueId="issue-1" />)

  const button = screen.getByRole('button')
  expect(button).not.toHaveAttribute('aria-pressed')
  expect(button).toHaveAttribute('aria-disabled', 'true')
  expect(button).not.toBeDisabled()
  expect(button).not.toHaveAttribute('tabindex', '-1')
  expect(button).toHaveAccessibleDescription(PENDING_HINT)
  expect(screen.getByText(PENDING_HINT)).toBeInTheDocument()
  // `aria-disabled` styles nothing on its own — the shared button dresses only the native
  // `disabled:` variant — so the not-actionable state has to be spelled out, or an inert control
  // renders at full strength and still lights up under the pointer.
  expect(button.className).toContain('aria-disabled:opacity-60')
  expect(button.className).toContain('aria-disabled:pointer-events-none')

  button.focus()
  expect(button).toHaveFocus()

  fireEvent.click(button)
  expect(mutatorNames()).toEqual([])
})

// A query that FAILED is not a query that is still loading. Left as "unsettled" the control sat on
// a permanent "checking…" with no way out, so a transient sync error made following an issue
// impossible until a reload.
test('a failed query says so, offers a retry, and still refuses to mutate', () => {
  zero.resultType = 'error'
  render(<FollowControl issueId="issue-1" />)

  const control = screen.getByRole('button', { name: 'Updates' })
  expect(screen.queryByText(PENDING_HINT)).toBeNull()
  expect(screen.getByRole('alert')).toHaveTextContent(UNAVAILABLE_HINT)
  expect(control).toHaveAccessibleDescription(UNAVAILABLE_HINT)

  fireEvent.click(control)
  expect(mutatorNames()).toEqual([])

  const retry = screen.getByRole('button', { name: 'Retry' })
  expect(retry.tagName).toBe('BUTTON')
  retry.focus()
  expect(retry).toHaveFocus()

  fireEvent.click(retry)
  expect(zero.retry).toHaveBeenCalledTimes(1)
})

// Recovery is exactly the moment the retry vanishes, and the keyboard user who pressed it is still
// standing on it. Letting focus fall to `<body>` sends the next Tab back to the top of the
// document — from a control inside the issue Sheet, that is the whole page to walk again.
test('the retry hands focus back to the follow control when the query recovers', () => {
  zero.resultType = 'error'
  const view = render(<FollowControl issueId="issue-1" />)

  const retry = screen.getByRole('button', { name: 'Retry' })
  retry.focus()
  expect(retry).toHaveFocus()

  zero.resultType = 'complete'
  view.rerender(<FollowControl issueId="issue-1" />)

  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Follow' })).toHaveFocus()
})

test('a retry nobody was standing on does not steal focus', () => {
  const elsewhere = document.createElement('button')
  document.body.append(elsewhere)
  zero.resultType = 'error'
  const view = render(<FollowControl issueId="issue-1" />)
  elsewhere.focus()

  zero.resultType = 'complete'
  view.rerender(<FollowControl issueId="issue-1" />)

  expect(elsewhere).toHaveFocus()
  elsewhere.remove()
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
