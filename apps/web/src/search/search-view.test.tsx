import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerSearchResponse, ServerSearchResult } from '@/search/api'
import type { CorpusIssueRow, CorpusTeamRow } from '@/search/use-local-corpus'
import type { ConnectionSummary } from '@/zero/connection'

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  navigate: vi.fn(),
  connection: {
    state: 'connected',
    recovery: 'idle',
    label: 'Connected',
    writable: true,
    retryOffered: false,
  } as ConnectionSummary,
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    return [harness.rows[name] ?? [], { type: 'complete' }]
  },
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => harness.navigate,
}))

vi.mock('@/zero/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/connection')>()),
  useConnectionSummary: () => harness.connection,
}))

import { SearchView } from '@/search/search-view'

const TEAM: CorpusTeamRow = { id: 'team-1', name: 'Platform', key: 'ENG', updatedAt: 1 }

function issue(overrides: Partial<CorpusIssueRow> & { id: string }): CorpusIssueRow {
  return {
    teamId: 'team-1',
    number: 1,
    title: 'A title',
    description: undefined,
    status: 'todo',
    needsTriage: false,
    updatedAt: 100,
    ...overrides,
  }
}

function serverHit(id: string, title: string): ServerSearchResult {
  return {
    type: 'comment',
    id,
    issueId: `issue-${id}`,
    teamId: 'team-2',
    issueKey: 'OPS-3',
    issueTitle: title,
    status: 'canceled',
    needsTriage: false,
    snippet: 'the token in context',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

let pending: { resolve: (body: ServerSearchResponse) => void }[] = []

beforeEach(() => {
  vi.useFakeTimers()
  pending = []
  harness.rows = { 'teams.all': [TEAM] }
  harness.navigate.mockClear()
  harness.connection = { ...harness.connection, state: 'connected', writable: true }
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_input: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          pending.push({
            resolve: (body) => resolve({ ok: true, json: async () => body } as unknown as Response),
          })
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    ),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// The query lives in the URL on the real route, so the view takes it as a prop; the test drives it
// the same way the route does — by re-rendering with the next value.
function mount(initial = '') {
  let current = initial
  const view = render(<SearchView query={current} onQueryChange={() => {}} />)
  return {
    async type(next: string) {
      current = next
      view.rerender(<SearchView query={current} onQueryChange={() => {}} />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
    },
  }
}

function input(): HTMLElement {
  return screen.getByTestId('search-input')
}

function optionIds(): string[] {
  return [...document.querySelectorAll('[role="option"]')].map((node) => node.id)
}

function activeId(): string | null {
  return input().getAttribute('aria-activedescendant')
}

async function settleServer(results: readonly ServerSearchResult[], truncated = false) {
  const request = pending.pop()
  expect(request).toBeDefined()
  await act(async () => {
    request?.resolve({ results, truncated })
    await vi.advanceTimersByTimeAsync(0)
  })
}

test('a sub-minimum query renders the on-device group and asks the server nothing', async () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.mine': [issue({ id: 'a', title: 'm alpha' })] }
  const surface = mount()
  await surface.type('m')

  expect(screen.getByTestId('search-server-state')).toHaveTextContent(
    'Keep typing to search everything',
  )
  expect(pending).toHaveLength(0)
  expect(screen.getByText('m alpha')).toBeInTheDocument()
})

test('a request in flight says so, and an answered empty one says no further matches', async () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.mine': [issue({ id: 'a', title: 'match alpha' })] }
  const surface = mount()
  await surface.type('match')
  expect(screen.getByTestId('search-server-state')).toHaveTextContent('Searching…')

  await settleServer([])
  expect(screen.getByTestId('search-server-state')).toHaveTextContent('No further matches')
})

test('both passes empty says so exactly once', async () => {
  const surface = mount()
  await surface.type('qzt-echo')
  await settleServer([])

  const empty = screen.getByTestId('search-empty')
  expect(empty).toHaveTextContent('No matches for "qzt-echo".')
  expect(empty).toHaveTextContent('Try fewer or different words.')
  expect(empty).toHaveTextContent('Recently edited items can take a few seconds to appear.')
  expect(screen.queryByTestId('search-server-state')).not.toBeInTheDocument()
})

test('the offline state comes from the existing connection state and leaves the local group alone', async () => {
  harness.connection = { ...harness.connection, state: 'disconnected', writable: false }
  harness.rows = { 'teams.all': [TEAM], 'issues.mine': [issue({ id: 'a', title: 'match alpha' })] }
  const surface = mount()
  await surface.type('match')

  expect(screen.getByTestId('search-server-state')).toHaveTextContent(
    'Offline — on-device results only',
  )
  expect(pending).toHaveLength(0)
  expect(screen.getByText('match alpha')).toBeInTheDocument()
})

test('a capped result set invites a narrower query', async () => {
  const surface = mount()
  await surface.type('match')
  await settleServer([serverHit('s1', 'A hit')], true)

  expect(screen.getByTestId('search-server-state')).toHaveTextContent(
    'Showing the first 50 — refine your query',
  )
})

test('a server hit is attributed to its issue and carries its state label', async () => {
  const surface = mount()
  await surface.type('token')
  await settleServer([serverHit('s1', 'A canceled issue')])

  expect(screen.getByText('A canceled issue')).toBeInTheDocument()
  expect(screen.getByText('OPS-3')).toBeInTheDocument()
  expect(screen.getByText('Canceled')).toBeInTheDocument()
  // The snippet's delimiters become segments, never markup.
  expect(screen.getByText('token')).toBeInTheDocument()
})

test('the arrow keys cross the group boundary as one list and Enter opens the active row', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.mine': [
      issue({ id: 'a', number: 1, title: 'match alpha', updatedAt: 20 }),
      issue({ id: 'b', number: 2, title: 'match bravo', updatedAt: 10 }),
    ],
  }
  const surface = mount()
  await surface.type('match')
  await settleServer([serverHit('s1', 'A comment hit')])

  const ids = optionIds()
  expect(ids).toHaveLength(3)
  expect(activeId()).toBe(ids[0])

  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  expect(activeId()).toBe(ids[2])

  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith({
    to: '/teams/$teamId/issues',
    params: { teamId: 'team-2' },
    search: { open: 'issue-s1' },
  })

  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(activeId()).toBe(ids[0])
  expect(document.activeElement).toBe(input())
})

test('the active row keeps its place when the server group is appended', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.mine': [
      issue({ id: 'a', number: 1, title: 'match alpha', updatedAt: 20 }),
      issue({ id: 'b', number: 2, title: 'match bravo', updatedAt: 10 }),
    ],
  }
  const surface = mount()
  await surface.type('match')
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  const before = optionIds()
  const activeBefore = activeId()
  expect(activeBefore).toBe(before[1])

  await settleServer([serverHit('s1', 'A comment hit')])

  const after = optionIds()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(activeId()).toBe(activeBefore)
  expect(after.indexOf(activeBefore ?? '')).toBe(before.indexOf(activeBefore ?? ''))
})

// The surface's only window-level key handler asks `ownsKeyboard` first, so a printable character
// aimed at another field is never stolen to focus the query input.
test('a single letter typed into another field is not hijacked', () => {
  render(
    <>
      <input aria-label="elsewhere" data-testid="elsewhere" />
      <SearchView query="" onQueryChange={() => {}} />
    </>,
  )
  const elsewhere = screen.getByTestId('elsewhere')
  elsewhere.focus()
  fireEvent.keyDown(elsewhere, { key: 'a' })
  expect(document.activeElement).toBe(elsewhere)

  fireEvent.keyDown(document.body, { key: 'a' })
  expect(document.activeElement).toBe(input())
})

test('exactly one polite live region reports the whole surface', async () => {
  harness.rows = { 'teams.all': [TEAM], 'issues.mine': [issue({ id: 'a', title: 'match alpha' })] }
  const surface = mount()
  await surface.type('match')
  await settleServer([serverHit('s1', 'A comment hit')])

  const regions = screen.getAllByRole('status')
  expect(regions).toHaveLength(1)
  expect(regions[0]).toHaveTextContent('1 result on this device, 1 result from the server.')
})
