import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const zero = vi.hoisted(() => ({
  teams: [] as { id: string; name: string; key: string; aiRetroDraftSince: number | null }[],
  listeners: new Set<() => void>(),
  result: { type: 'success' } as { type: string; error?: { type: string; message: string } },
  mutate: vi.fn((mutation: { mutator: { mutatorName: string }; args: Record<string, unknown> }) => {
    void mutation
    return { client: Promise.resolve(zero.result), server: Promise.resolve(zero.result) }
  }),
}))

const membership = vi.hoisted(() => ({ canManage: true }))

vi.mock('@rocicorp/zero/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useQuery: () => [
      useSyncExternalStore(
        (onChange: () => void) => {
          zero.listeners.add(onChange)
          return () => {
            zero.listeners.delete(onChange)
          }
        },
        () => zero.teams,
      ),
      { type: 'complete' },
    ],
    useZero: () => ({ mutate: zero.mutate }),
  }
})

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({ canManage: membership.canManage }),
}))

// The provider card above the section is REST-backed and irrelevant here; stubbing its fetch keeps
// this test about the one surface it names — and proves the section renders independently of it.
vi.mock('@/settings/ai', () => ({
  fetchAiConfig: () =>
    Promise.resolve({ canStoreKeys: false, missingEnv: [], envProviders: [], status: null }),
  fetchAiDisclosureLog: () => Promise.resolve({ totals: [], recent: [] }),
  fetchAiVerdictLog: () => Promise.resolve({ totals: [], recent: [] }),
  removeAiProviderKey: () => Promise.resolve(),
  setAiProviderKey: () => Promise.resolve(),
  updateAiConfig: () => Promise.resolve(),
}))

import { AiSettingsView } from './ai-view'

const NOW = Date.UTC(2026, 6, 20, 9, 0, 0)

function sync(teams: typeof zero.teams) {
  act(() => {
    zero.teams = teams
    for (const listener of [...zero.listeners]) listener()
  })
}

beforeEach(() => {
  zero.mutate.mockClear()
  zero.result = { type: 'success' }
  membership.canManage = true
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  zero.teams = [
    { id: 'team-off', name: 'Platform', key: 'PLT', aiRetroDraftSince: null },
    { id: 'team-on', name: 'Growth', key: 'GRW', aiRetroDraftSince: NOW - 86_400_000 },
  ]
})

// Off by default is the maintainer's call: a team lets a model into its own retro knowingly.
test('each team renders its own state, and off is what a team looks like by default', async () => {
  render(<AiSettingsView />)

  const rows = await screen.findAllByTestId('retro-ai-draft-row')
  expect(rows.map((row) => row.dataset.teamKey)).toEqual(['PLT', 'GRW'])
  expect(rows[0]).toHaveTextContent('Off')
  expect(rows[1]).toHaveTextContent('On')
  expect(
    screen.getByRole('button', { name: /Enable the retro AI draft for Platform/ }),
  ).toBeTruthy()
})

test('enabling writes the call-site instant and disabling writes null', async () => {
  render(<AiSettingsView />)

  fireEvent.click(await screen.findByRole('button', { name: /Enable the retro AI draft/ }))
  expect(zero.mutate.mock.calls.map((call) => call[0].mutator.mutatorName)).toEqual([
    'team.setAiRetroDraft',
  ])
  expect(zero.mutate.mock.calls[0]?.[0].args).toEqual({
    id: 'team-off',
    since: NOW,
    updatedAt: NOW,
  })

  fireEvent.click(screen.getByRole('button', { name: /Disable the retro AI draft/ }))
  expect(zero.mutate.mock.calls[1]?.[0].args).toEqual({
    id: 'team-on',
    since: null,
    updatedAt: NOW,
  })
})

test('the row follows the synced column rather than a local toggle', async () => {
  render(<AiSettingsView />)
  await screen.findAllByTestId('retro-ai-draft-row')

  sync([{ id: 'team-off', name: 'Platform', key: 'PLT', aiRetroDraftSince: NOW }])
  expect(
    screen.getByRole('button', { name: /Disable the retro AI draft for Platform/ }),
  ).toBeTruthy()

  sync([{ id: 'team-off', name: 'Platform', key: 'PLT', aiRetroDraftSince: null }])
  expect(
    screen.getByRole('button', { name: /Enable the retro AI draft for Platform/ }),
  ).toBeTruthy()
})

test('a rejected write surfaces as an error and retracts the announcement', async () => {
  zero.result = { type: 'error', error: { type: 'app', message: 'Not authorized' } }
  render(<AiSettingsView />)

  fireEvent.click(await screen.findByRole('button', { name: /Enable the retro AI draft/ }))

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorized')
  })
  expect(screen.getByTestId('retro-ai-draft-announcement').textContent).toBe('')
})

test('the toggle is a real button in the tab order and announces politely', async () => {
  render(<AiSettingsView />)

  const button = await screen.findByRole('button', { name: /Enable the retro AI draft/ })
  expect(button.tagName).toBe('BUTTON')
  expect(button).not.toHaveAttribute('tabindex', '-1')
  button.focus()
  expect(button).toHaveFocus()

  fireEvent.click(button)
  const live = screen.getByTestId('retro-ai-draft-announcement')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live.textContent).toBe('Retro AI draft enabled for Platform.')
})

// The page's own admin gate, not a second one: a non-admin never renders the section, so there is no
// control to reach and no second gate to drift out of step with the mutator's.
test('a non-admin cannot reach the section', () => {
  membership.canManage = false
  render(<AiSettingsView />)

  expect(screen.queryByTestId('retro-ai-draft-settings')).toBeNull()
  expect(zero.mutate).not.toHaveBeenCalled()
})
