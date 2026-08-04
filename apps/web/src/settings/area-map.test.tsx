import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AreaRule } from '@yapm/schema'
import { beforeEach, expect, test, vi } from 'vitest'
import type { AiStatusResponse } from '@/settings/ai'

// The area map is the ONE surface that authors an order-sensitive rule list, and order is what the
// matcher obeys — so what this file proves is that the order on screen is the order that is sent,
// that every control is operable without a pointer, and that focus after a reorder lands on a
// control that still works. A reorder that silently moved focus to a disabled button was invisible
// to every other tier of test.

const membership = vi.hoisted(() => ({ canManage: true }))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({ canManage: membership.canManage }),
}))

// The view also holds the synced retro-draft opt-in section, which reads teams through Zero. An
// empty team list is the right stub here: this file is about the REST-backed area map, and no team
// means that section has no row to draw beside it. `retro-ai-draft.test.tsx` owns its behavior.
vi.mock('@rocicorp/zero/react', () => ({
  useQuery: () => [[], { type: 'complete' }],
  useZero: () => ({ mutate: vi.fn() }),
}))

import { AiSettingsView } from './ai-view'

interface Recorded {
  url: string
  method: string
  body: { areas?: AreaRule[] } | undefined
}

const requests: Recorded[] = []
let payload: AiStatusResponse

function statusWith(areas: AreaRule[]): AiStatusResponse {
  return {
    configured: true,
    canStoreKeys: false,
    missingEnv: [],
    envProviders: [],
    envDefaultProvider: null,
    status: {
      enabled: true,
      defaultProvider: null,
      models: {},
      spendCapUsd: null,
      spendSoFarUsd: 0,
      configuredProviders: [],
      areas,
      pmDisclosure: { enabled: false, killed: false, teams: {} },
    },
  }
}

beforeEach(() => {
  requests.length = 0
  membership.canManage = true
  payload = statusWith([
    { prefix: 'apps/server/src/billing/', area: 'Billing' },
    { prefix: 'apps/web/', area: 'Web' },
  ])
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body === undefined ? undefined : JSON.parse(String(init.body))
      requests.push({ url: String(input), method: init?.method ?? 'GET', body })
      if (body?.areas) payload = statusWith(body.areas)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) } as Response)
    }),
  )
})

async function openEditor() {
  render(<AiSettingsView />)
  return await screen.findByTestId('area-map-editor')
}

function rowLabels(): string[] {
  return screen.getAllByLabelText('Area label').map((input) => (input as HTMLInputElement).value)
}

function writes(): Recorded[] {
  return requests.filter((request) => request.method === 'POST')
}

test('the map is authored, reordered and saved in the order shown on screen', async () => {
  await openEditor()

  fireEvent.click(screen.getByTestId('area-add'))
  const prefixes = screen.getAllByLabelText('Path prefix')
  const labels = screen.getAllByLabelText('Area label')
  fireEvent.change(prefixes[2] as HTMLInputElement, { target: { value: 'packages/config/' } })
  fireEvent.change(labels[2] as HTMLInputElement, { target: { value: 'Tooling' } })
  fireEvent.click(screen.getByTestId('area-sensitive-0'))

  // Move the new rule above `apps/web/` — the order the matcher obeys is the order on screen.
  fireEvent.click(screen.getByRole('button', { name: 'Move Tooling earlier' }))
  expect(rowLabels()).toEqual(['Billing', 'Tooling', 'Web'])

  fireEvent.click(screen.getByTestId('area-map-save'))
  await waitFor(() => expect(writes()).toHaveLength(1))

  expect(writes()[0]?.url).toBe('/api/v1/ai')
  expect(writes()[0]?.body?.areas).toEqual([
    { prefix: 'apps/server/src/billing/', area: 'Billing', sensitive: true },
    { prefix: 'packages/config/', area: 'Tooling' },
    { prefix: 'apps/web/', area: 'Web' },
  ])
})

// The defect this test exists for: at either end the arrow that made the move is the one the move
// DISABLES, so focusing it is a no-op and focus stays on an index-keyed node that now belongs to a
// different rule — the next press silently undoes the move.
test('focus after a move lands on an enabled control, including a move to the first position', async () => {
  await openEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Move Web earlier' }))
  expect(rowLabels()).toEqual(['Web', 'Billing'])
  expect(document.activeElement).toHaveAttribute('aria-label', 'Move Web later')
  expect(document.activeElement).not.toBeDisabled()

  fireEvent.click(screen.getByRole('button', { name: 'Move Web later' }))
  expect(rowLabels()).toEqual(['Billing', 'Web'])
  expect(document.activeElement).toHaveAttribute('aria-label', 'Move Web earlier')
  expect(document.activeElement).not.toBeDisabled()
})

test('a move is announced politely', async () => {
  await openEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Move Web earlier' }))
  const live = screen.getByTestId('area-map-announcement')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live.textContent).toBe('Web moved to position 1 of 2.')
})

test('every control is a real, focusable element in the tab order', async () => {
  await openEditor()

  const controls = [
    screen.getAllByLabelText('Path prefix')[0],
    screen.getAllByLabelText('Area label')[0],
    screen.getByTestId('area-sensitive-0'),
    screen.getByTestId('area-internal-0'),
    screen.getByRole('button', { name: 'Move Billing later' }),
    screen.getByRole('button', { name: 'Remove Billing' }),
    screen.getByTestId('area-add'),
    screen.getByTestId('area-map-save'),
  ]
  for (const control of controls) {
    expect(control).toBeTruthy()
    expect(control).not.toHaveAttribute('tabindex', '-1')
    expect(control).not.toBeDisabled()
    ;(control as HTMLElement).focus()
    expect(control).toHaveFocus()
  }
})

test('removing a rule moves focus to Add area and drops it from the saved order', async () => {
  await openEditor()

  fireEvent.click(screen.getByRole('button', { name: 'Remove Billing' }))
  expect(rowLabels()).toEqual(['Web'])
  expect(document.activeElement).toBe(screen.getByTestId('area-add'))

  fireEvent.click(screen.getByTestId('area-map-save'))
  await waitFor(() => expect(writes()).toHaveLength(1))
  expect(writes()[0]?.body?.areas).toEqual([{ prefix: 'apps/web/', area: 'Web' }])
})

// `unmapped` is what yapm calls work it could not place. An area an admin gave that name would make
// the two indistinguishable, so the refusal is stated where the name is typed, not only in the docs.
test('the reserved label blocks the save with an inline reason and sends nothing', async () => {
  await openEditor()

  fireEvent.change(screen.getAllByLabelText('Area label')[0] as HTMLInputElement, {
    target: { value: 'Unmapped' },
  })

  expect(screen.getByTestId('area-map-save')).toBeDisabled()
  expect(screen.getByTestId('area-map-blocked').textContent).toContain('reserved label')

  fireEvent.change(screen.getAllByLabelText('Area label')[0] as HTMLInputElement, {
    target: { value: 'Billing' },
  })
  expect(screen.getByTestId('area-map-save')).not.toBeDisabled()
  expect(writes()).toHaveLength(0)
})

test('an incomplete rule blocks the save with its own reason', async () => {
  await openEditor()

  fireEvent.click(screen.getByTestId('area-add'))
  expect(screen.getByTestId('area-map-save')).toBeDisabled()
  expect(screen.getByTestId('area-map-blocked').textContent).toContain('path prefix')
  expect(writes()).toHaveLength(0)
})

test('a non-admin renders no editor and requests nothing', () => {
  membership.canManage = false
  render(<AiSettingsView />)

  expect(screen.queryByTestId('area-map-editor')).toBeNull()
  expect(requests).toHaveLength(0)
})
