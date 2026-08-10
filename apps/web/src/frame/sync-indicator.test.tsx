import { fireEvent, render, screen } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import type { ConnectionSummary } from '@/zero/connection'
import { RECOVERY_IDLE, SyncRecoveryContext } from '@/zero/recovery'
import { SyncIndicator } from './sync-indicator'

const CONNECTED: ConnectionSummary = {
  state: 'connected',
  recovery: 'idle',
  condition: 'none',
  label: 'Synced',
  writable: true,
  retryOffered: false,
  refreshOffered: false,
}

function show(connection: ConnectionSummary, retryNow = vi.fn()) {
  render(
    <SyncRecoveryContext.Provider value={{ ...RECOVERY_IDLE, retryNow }}>
      <SyncIndicator connection={connection} />
    </SyncRecoveryContext.Provider>,
  )
  return { retryNow, pill: screen.getByTestId('connection-status') }
}

test('the statusline segment keeps the data-connection hook the existing suites assert on', () => {
  const { pill } = show(CONNECTED)

  expect(pill).toHaveAttribute('data-connection', 'connected')
  expect(screen.getByText('Synced')).toBeInTheDocument()
})

test('the recovery phase is exposed for tests without disturbing data-connection', () => {
  const { pill } = show({
    ...CONNECTED,
    state: 'error',
    recovery: 'waiting',
    label: 'Sync error — retrying',
    writable: false,
  })

  expect(pill).toHaveAttribute('data-connection', 'error')
  expect(pill).toHaveAttribute('data-recovery', 'waiting')
})

test('the status text is a polite live region so recovery is announced', () => {
  show({ ...CONNECTED, recovery: 'retrying', label: 'Reconnecting…', state: 'connecting' })

  const region = screen.getByRole('status')
  expect(region).toHaveAttribute('aria-live', 'polite')
  expect(region).toHaveTextContent('Reconnecting…')
})

test('the failure reason reaches assistive tech without cluttering the pill', () => {
  show({
    ...CONNECTED,
    state: 'error',
    writable: false,
    label: 'Sync error — retrying',
    detail: 'InvalidConnectionRequest',
  })

  expect(screen.getByText('InvalidConnectionRequest')).toHaveClass('sr-only')
})

test('no retry escape hatch until recovery has been waiting a while', () => {
  show(CONNECTED)
  expect(screen.queryByTestId('connection-retry')).not.toBeInTheDocument()
})

test('the retry escape hatch is a real button, reachable by keyboard alone', () => {
  const { retryNow } = show({
    ...CONNECTED,
    state: 'error',
    recovery: 'waiting',
    label: 'Sync error — retrying',
    writable: false,
    retryOffered: true,
  })

  const retry = screen.getByTestId('connection-retry')
  expect(retry.tagName).toBe('BUTTON')
  expect(retry).toHaveAttribute('type', 'button')
  expect(retry).not.toHaveAttribute('tabindex')
  expect(retry).toHaveAccessibleName('Retry now')

  retry.focus()
  expect(retry).toHaveFocus()
  expect(retry.className).toContain('focus-visible:ring-accent')

  // Enter and Space both reach a native button's activation behaviour.
  fireEvent.click(retry)
  expect(retryNow).toHaveBeenCalledTimes(1)
})

const OFFERED: ConnectionSummary = {
  ...CONNECTED,
  state: 'error',
  recovery: 'waiting',
  label: 'Sync error — retrying',
  writable: false,
  retryOffered: true,
}

// Recovery is exactly the moment the button vanishes, and the keyboard user who pressed it
// is still standing on it. Letting focus fall to `<body>` sends the next Tab back to the top
// of the document — from a control in the app header, that is the whole page again.
test('the retry control hands focus to the pill when recovery removes it', () => {
  const view = render(<SyncIndicator connection={OFFERED} />)

  const retry = screen.getByTestId('connection-retry')
  retry.focus()
  expect(retry).toHaveFocus()

  view.rerender(<SyncIndicator connection={CONNECTED} />)

  expect(screen.queryByTestId('connection-retry')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveFocus()
})

test('a retry control nobody was standing on does not steal focus', () => {
  const elsewhere = document.createElement('button')
  document.body.append(elsewhere)
  const view = render(<SyncIndicator connection={OFFERED} />)
  elsewhere.focus()

  view.rerender(<SyncIndicator connection={CONNECTED} />)

  expect(elsewhere).toHaveFocus()
  elsewhere.remove()
})

const UPDATE_NEEDED: ConnectionSummary = {
  ...CONNECTED,
  state: 'error',
  condition: 'update-needed',
  label: 'Update required',
  writable: false,
  refreshOffered: true,
  detail: 'VersionNotSupported',
}

test('a sync condition is rendered distinctly from an ordinary outage', () => {
  const { pill } = show(UPDATE_NEEDED)

  expect(pill).toHaveAttribute('data-sync-condition', 'update-needed')
  expect(screen.getByText('Update required')).toBeInTheDocument()
  // The reason reaches assistive tech the same way an outage's detail does.
  expect(screen.getByText('VersionNotSupported')).toHaveClass('sr-only')
  // No retry: retrying cannot end this state, only the user's refresh can.
  expect(screen.queryByTestId('connection-retry')).not.toBeInTheDocument()
})

test('the refresh escape hatch is a real button, reachable by keyboard alone', () => {
  show(UPDATE_NEEDED)

  const refresh = screen.getByTestId('connection-refresh')
  expect(refresh.tagName).toBe('BUTTON')
  expect(refresh).toHaveAttribute('type', 'button')
  expect(refresh).not.toHaveAttribute('tabindex')
  expect(refresh).toHaveAccessibleName('Refresh')

  refresh.focus()
  expect(refresh).toHaveFocus()
  expect(refresh.className).toContain('focus-visible:ring-accent')
})

test('a client reset shows work in progress, not an outage, and offers nothing to press', () => {
  const { pill } = show({
    ...CONNECTED,
    state: 'disconnected',
    condition: 'client-reset',
    label: 'Restoring local data',
    writable: false,
  })

  expect(pill).toHaveAttribute('data-sync-condition', 'client-reset')
  expect(screen.getByText('Restoring local data')).toBeInTheDocument()
  const dot = pill.querySelector('[aria-hidden="true"]')
  expect(dot?.className).toContain('bg-status-in-progress')
  expect(screen.queryByTestId('connection-retry')).not.toBeInTheDocument()
  expect(screen.queryByTestId('connection-refresh')).not.toBeInTheDocument()
})

test('condition dot colours come from theme tokens too', () => {
  for (const connection of [UPDATE_NEEDED, { ...CONNECTED, condition: 'client-reset' as const }]) {
    const { unmount } = render(
      <SyncRecoveryContext.Provider value={{ ...RECOVERY_IDLE, retryNow: vi.fn() }}>
        <SyncIndicator connection={connection} />
      </SyncRecoveryContext.Provider>,
    )
    const dot = screen.getByTestId('connection-status').querySelector('[aria-hidden="true"]')
    expect(dot?.className).toMatch(/bg-status-[a-z-]+\b/)
    expect(dot?.className).not.toMatch(
      /bg-(emerald|amber|red|green|yellow|blue|orange|slate|gray)-\d/,
    )
    unmount()
  }
})

test('every dot colour comes from a theme token, never a raw palette shade', () => {
  const states: ConnectionSummary['state'][] = [
    'connected',
    'connecting',
    'disconnected',
    'needs-auth',
    'error',
    'closed',
  ]

  for (const state of states) {
    const { unmount } = render(
      <SyncRecoveryContext.Provider value={{ ...RECOVERY_IDLE, retryNow: vi.fn() }}>
        <SyncIndicator connection={{ ...CONNECTED, state }} />
      </SyncRecoveryContext.Provider>,
    )
    const dot = screen.getByTestId('connection-status').querySelector('[aria-hidden="true"]')
    expect(dot?.className).toMatch(/bg-(status-[a-z-]+|muted-foreground)\b/)
    expect(dot?.className).not.toMatch(
      /bg-(emerald|amber|red|green|yellow|blue|orange|slate|gray)-\d/,
    )
    unmount()
  }
})
