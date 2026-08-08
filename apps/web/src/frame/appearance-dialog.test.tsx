import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

// The email preference rides the Appearance popover and shares ONE mutator with the theme fields
// (DI-11, DI-4). Two things have to stay true and neither is visible by reading the component:
// changing the email mode must send `emailNotifications`, and it must carry the theme and accent
// the row already has rather than resetting them.
const zero = vi.hoisted(() => ({
  preference: {
    id: 'pref-1',
    theme: 'focused',
    accent: '#22aa55',
    emailNotifications: 'assigned_only',
  } as Record<string, unknown> | undefined,
  mutate: vi.fn((_mutation: { args: Record<string, unknown> }) => ({
    client: Promise.resolve({ type: 'success' }),
    server: Promise.resolve({ type: 'success' }),
  })),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [zero.preference, { type: 'complete' }],
  useZero: () => ({ mutate: zero.mutate }),
}))

import { ThemeProvider } from '@/theme/provider'
import { AppearanceDialog } from './appearance-dialog'

function calls(): Record<string, unknown>[] {
  return zero.mutate.mock.calls.map((call) => call[0].args)
}

async function openPopover() {
  render(
    <ThemeProvider>
      <AppearanceDialog open onOpenChange={() => {}} />
    </ThemeProvider>,
  )
  return await screen.findByTestId('email-notifications')
}

beforeEach(() => {
  zero.mutate.mockClear()
})

test('the email preference is reachable in the Appearance popover and reflects the synced row', async () => {
  const select = await openPopover()

  expect(select).toHaveValue('assigned_only')
  expect(select).toHaveAccessibleName('Email notifications')
})

test('changing it writes emailNotifications through the shared mutator, preserving theme and accent', async () => {
  const select = await openPopover()

  fireEvent.change(select, { target: { value: 'none' } })

  expect(calls()).toHaveLength(1)
  expect(calls()[0]).toMatchObject({
    id: 'pref-1',
    emailNotifications: 'none',
    theme: 'focused',
    accent: '#22aa55',
  })
})

test('changing the theme leaves the email preference alone rather than resetting it', async () => {
  await openPopover()

  fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'editorial' } })

  expect(calls()).toHaveLength(1)
  expect(calls()[0]).toMatchObject({ theme: 'editorial' })
  // Omitted, not defaulted: the mutator preserves whatever mode the row already carries.
  expect(calls()[0]).not.toHaveProperty('emailNotifications')
})
