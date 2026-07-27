import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'

const zero = vi.hoisted(() => ({
  teams: [] as { id: string; name: string; key: string; autoStatusSince: number | null }[],
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

// The connector card above the section is REST-backed and irrelevant here; stubbing its fetch keeps
// this test about the one surface it names.
vi.mock('@/settings/connectors', () => ({
  fetchGithubConnector: () =>
    Promise.resolve({ provider: 'github', configured: false, missingEnv: [], status: null }),
  mapRepoToTeam: () => Promise.resolve({ ok: true }),
  setGithubConnectorEnabled: () => Promise.resolve(),
  unmapRepo: () => Promise.resolve({ ok: true }),
}))

import { ConnectorsView } from './connectors-view'

const NOW = Date.UTC(2026, 5, 1, 12, 0, 0)

function sync(teams: typeof zero.teams) {
  act(() => {
    zero.teams = teams
    for (const listener of [...zero.listeners]) listener()
  })
}

function mutatorNames(): string[] {
  return zero.mutate.mock.calls.map((call) => call[0].mutator.mutatorName)
}

beforeEach(() => {
  zero.mutate.mockClear()
  zero.result = { type: 'success' }
  membership.canManage = true
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  zero.teams = [
    { id: 'team-off', name: 'Platform', key: 'PLT', autoStatusSince: null },
    { id: 'team-on', name: 'Growth', key: 'GRW', autoStatusSince: NOW - 3_600_000 },
  ]
})

test('each team renders its own state, off and on side by side', async () => {
  render(<ConnectorsView />)

  const rows = await screen.findAllByTestId('status-automation-row')
  expect(rows.map((row) => row.dataset.teamKey)).toEqual(['PLT', 'GRW'])
  expect(rows[0]).toHaveTextContent('Platform')
  expect(rows[0]).toHaveTextContent('Off')
  expect(rows[1]).toHaveTextContent('Growth')
  expect(rows[1]).toHaveTextContent('On')

  expect(screen.getByRole('button', { name: /Enable status automation for Platform/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /Disable status automation for Growth/ })).toBeTruthy()
})

// The instant is the team's epoch, not a boolean: it is what makes "turning it on changes no
// existing issue" true, so the enable write has to carry a real timestamp minted at this call site.
test('enabling writes the call-site instant and disabling writes null', async () => {
  render(<ConnectorsView />)

  fireEvent.click(await screen.findByRole('button', { name: /Enable status automation/ }))
  expect(mutatorNames()).toEqual(['team.setAutoStatus'])
  expect(zero.mutate.mock.calls[0]?.[0].args).toEqual({
    id: 'team-off',
    since: NOW,
    updatedAt: NOW,
  })

  fireEvent.click(screen.getByRole('button', { name: /Disable status automation/ }))
  expect(zero.mutate.mock.calls[1]?.[0].args).toEqual({
    id: 'team-on',
    since: null,
    updatedAt: NOW,
  })
})

// The row reads the synced column rather than local state, so what the button says is what actually
// landed — an optimistic write that the server later rejects cannot leave the label lying.
test('the row follows the synced column, not a local toggle', async () => {
  render(<ConnectorsView />)
  await screen.findAllByTestId('status-automation-row')

  sync([{ id: 'team-off', name: 'Platform', key: 'PLT', autoStatusSince: NOW }])
  expect(
    screen.getByRole('button', { name: /Disable status automation for Platform/ }),
  ).toBeTruthy()

  sync([{ id: 'team-off', name: 'Platform', key: 'PLT', autoStatusSince: null }])
  expect(screen.getByRole('button', { name: /Enable status automation for Platform/ })).toBeTruthy()
})

test('a rejected write surfaces as an error and retracts the announcement', async () => {
  zero.result = { type: 'error', error: { type: 'app', message: 'Not authorized' } }
  render(<ConnectorsView />)

  fireEvent.click(await screen.findByRole('button', { name: /Enable status automation/ }))

  await waitFor(() => {
    expect(screen.getByRole('alert')).toHaveTextContent('Not authorized')
  })
  expect(screen.getByTestId('status-automation-announcement').textContent).toBe('')
})

test('the state change is announced politely', async () => {
  render(<ConnectorsView />)

  fireEvent.click(await screen.findByRole('button', { name: /Enable status automation/ }))

  const live = screen.getByTestId('status-automation-announcement')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live.textContent).toBe('Status automation enabled for Platform.')
})

// Riding the page's own admin gate rather than a second one: a non-admin never renders the section
// at all, so there is no control to reach and no second gate to drift out of step with the mutator's.
test('a non-admin cannot reach the section', () => {
  membership.canManage = false
  render(<ConnectorsView />)

  expect(screen.queryByTestId('status-automation')).toBeNull()
  expect(screen.queryByTestId('status-automation-toggle')).toBeNull()
  expect(mutatorNames()).toEqual([])
})

test('the toggle is a real button in the tab order', async () => {
  render(<ConnectorsView />)

  const button = await screen.findByRole('button', { name: /Enable status automation/ })
  expect(button.tagName).toBe('BUTTON')
  expect(button).not.toBeDisabled()
  expect(button).not.toHaveAttribute('tabindex', '-1')

  button.focus()
  expect(button).toHaveFocus()
})

test('no per-person automation counter is rendered anywhere in the section', async () => {
  render(<ConnectorsView />)
  const section = await screen.findByTestId('status-automation')

  expect(section.textContent).not.toMatch(/\b\d+\s+(transitions?|issues? moved|by)\b/i)
  expect(section.querySelector('img')).toBeNull()
})
