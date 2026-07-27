import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerSearchResponse, ServerSearchResult } from '@/search/api'
import type { CorpusIssueRow, CorpusTeamRow } from '@/search/use-local-corpus'
import type { ConnectionSummary } from '@/zero/connection'

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  navigate: vi.fn(),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    return [harness.rows[name] ?? [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: vi.fn(() => Promise.resolve()) }),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => harness.navigate,
}))

vi.mock('@/auth/use-membership', () => ({
  useMembership: () => ({
    userId: 'user-1',
    memberId: 'member-1',
    role: 'member',
    isMember: true,
    canWrite: true,
    canManage: false,
  }),
}))

const CONNECTED: ConnectionSummary = {
  state: 'connected',
  recovery: 'idle',
  label: 'Connected',
  writable: true,
  retryOffered: false,
}

vi.mock('@/zero/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/connection')>()),
  useConnectionSummary: () => CONNECTED,
}))

import { CommandProvider, useCommand } from '@/issues/command'

const TEAM: CorpusTeamRow = { id: 'team-1', name: 'Platform', key: 'ENG', updatedAt: 1 }

function doc(text: string): unknown {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

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
    teamId: 'team-1',
    issueKey: 'ENG-9',
    issueTitle: title,
    status: 'todo',
    needsTriage: false,
    snippet: 'a snippet',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

let pending: { resolve: (body: ServerSearchResponse) => void }[] = []

beforeEach(() => {
  vi.useFakeTimers()
  pending = []
  harness.rows = { 'teams.all': [TEAM] }
  harness.navigate.mockClear()
  Element.prototype.scrollIntoView = vi.fn()
  // jsdom ships neither; `cmdk` observes its list and Base UI measures its popup.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
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

function Opener() {
  const api = useCommand()
  return (
    <button type="button" onClick={() => api.openLabel(['issue-1'])}>
      open label page
    </button>
  )
}

function mount() {
  render(
    <CommandProvider teamId="team-1" issues={[]}>
      <Opener />
    </CommandProvider>,
  )
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
}

function input(): HTMLElement {
  return screen.getByPlaceholderText('Type a command or search…')
}

async function type(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

function itemValues(): string[] {
  return [...document.querySelectorAll('[cmdk-item=""]')].map(
    (node) => node.getAttribute('data-value') ?? '',
  )
}

function activeValue(): string | null {
  const node = document.querySelector('[cmdk-item=""][data-selected="true"]')
  return node?.getAttribute('data-value') ?? null
}

async function settleServer(results: readonly ServerSearchResult[]) {
  const request = pending.pop()
  expect(request).toBeDefined()
  await act(async () => {
    request?.resolve({ results, truncated: false })
    await vi.advanceTimersByTimeAsync(0)
  })
}

// Filtering moved off `cmdk`'s scorer onto the shared core, so the first thing to prove is that
// the launcher still launches: the action rows the palette has always carried still narrow to a
// query and still run their shared mutator when Enter lands on them.
test('the existing action rows still filter and execute', async () => {
  mount()
  expect(screen.getByText('New issue')).toBeInTheDocument()
  expect(screen.getByText('Go to inbox')).toBeInTheDocument()

  await type('go to inbox')
  expect(screen.getByText('Go to inbox')).toBeInTheDocument()
  expect(screen.queryByText('New issue')).not.toBeInTheDocument()
  expect(screen.queryByText('Mark all notifications as read')).not.toBeInTheDocument()

  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith({ to: '/inbox' })
})

test('a description-only token surfaces in the on-device group', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [
      issue({ id: 'issue-1', number: 4, title: 'Nothing to see', description: doc('qzt-alpha') }),
    ],
  }
  mount()
  await type('qzt-alpha')

  expect(screen.getByText('On this device')).toBeInTheDocument()
  expect(screen.getByText('Nothing to see')).toBeInTheDocument()
  expect(screen.getByText('ENG-4')).toBeInTheDocument()
  // The palette's own escalation row is always there; the old "Jump to issue" group is not.
  expect(screen.queryByText('Jump to issue')).not.toBeInTheDocument()
  expect(screen.getByText('Search everything for "qzt-alpha" →')).toBeInTheDocument()
})

// The stage's load-bearing assertion: the server group is APPENDED, and appending must not move
// the row the caller is standing on — not its identity and not its position in the list.
test('the active row keeps its identity and its position when the server group arrives', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [
      issue({ id: 'a', number: 1, title: 'match alpha', updatedAt: 30 }),
      issue({ id: 'b', number: 2, title: 'match bravo', updatedAt: 20 }),
      issue({ id: 'c', number: 3, title: 'match charlie', updatedAt: 10 }),
    ],
  }
  mount()
  await type('match')

  const before = itemValues()
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  const activeBefore = activeValue()
  expect(activeBefore).toBe('local:issue:c')
  const indexBefore = before.indexOf(activeBefore ?? '')

  await settleServer([serverHit('s1', 'A comment hit')])

  const after = itemValues()
  expect(after.slice(0, before.length)).toEqual(before)
  expect(activeValue()).toBe(activeBefore)
  expect(after.indexOf(activeBefore ?? '')).toBe(indexBefore)
  expect(screen.getByText('A comment hit')).toBeInTheDocument()
})

test('the cursor falls to the first row when the active row leaves the list', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [
      issue({ id: 'a', number: 1, title: 'match alpha', updatedAt: 30 }),
      issue({ id: 'b', number: 2, title: 'match bravo unique', updatedAt: 20 }),
    ],
  }
  mount()
  await type('match')
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  expect(activeValue()).toBe('local:issue:b')

  await type('match alpha')
  expect(activeValue()).toBe(itemValues()[0])
  expect(activeValue()).toBe('local:issue:a')
})

test('the same query twice produces the same rows in the same order', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [
      issue({ id: 'a', number: 1, title: 'match alpha', updatedAt: 5 }),
      issue({ id: 'b', number: 2, title: 'beta match', updatedAt: 9 }),
      issue({ id: 'c', number: 3, title: 'gamma match', updatedAt: 9 }),
    ],
  }
  mount()
  await type('match')
  const first = itemValues()
  await type('')
  await type('match')
  expect(itemValues()).toEqual(first)
})

// D17's table, on the surface that shows it: a one-character query never asks the server, and the
// line it shows is a property of the QUERY — not of whether anything matched.
test('a sub-minimum query says so and issues no request', async () => {
  mount()
  await type('m')
  expect(screen.getByTestId('palette-server-state')).toHaveTextContent(
    'Keep typing to search everything',
  )
  expect(pending).toHaveLength(0)
})

test('an answered query with no hits reads as no further matches', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [issue({ id: 'a', number: 1, title: 'match alpha' })],
  }
  mount()
  await type('match')
  expect(screen.getByTestId('palette-server-state')).toHaveTextContent('Searching…')

  await settleServer([])
  expect(screen.getByTestId('palette-server-state')).toHaveTextContent('No further matches')
})

test('both passes empty collapses into one empty state', async () => {
  mount()
  await type('zzzz-nothing')
  await settleServer([])

  const empty = screen.getByTestId('palette-empty')
  expect(empty).toHaveTextContent('No matches for "zzzz-nothing".')
  expect(empty).toHaveTextContent('Try fewer or different words.')
  expect(empty).toHaveTextContent('Recently edited items can take a few seconds to appear.')
  expect(screen.queryByTestId('palette-server-state')).not.toBeInTheDocument()
})

test('the escalation row carries the query to the full route', async () => {
  mount()
  await type('replica')
  fireEvent.click(screen.getByText('Search everything for "replica" →'))
  expect(harness.navigate).toHaveBeenCalledWith({ to: '/search', search: { q: 'replica' } })
})

// Task 9.6, verified rather than assumed: under `shouldFilter={false}` cmdk sets
// `filtered.count` to the number of MOUNTED items, so `CommandEmpty` still tracks what the
// application chose to render. The launcher page never reaches zero — the escalation row is always
// mounted — which is exactly why the both-empty state above is rendered by the palette itself.
test('the command primitive reports empty from mounted items, not from its own scorer', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'labels.byTeam': [{ id: 'l-1', name: 'flaky', color: '#f00' }],
  }
  render(
    <CommandProvider teamId="team-1" issues={[]}>
      <Opener />
    </CommandProvider>,
  )
  act(() => {
    fireEvent.click(screen.getByText('open label page'))
  })

  const labelInput = screen.getByPlaceholderText(/Add label to/)
  expect(screen.getByText('flaky')).toBeInTheDocument()
  expect(screen.queryByText('No results found.')).not.toBeInTheDocument()

  fireEvent.change(labelInput, { target: { value: 'nothing-matches-this' } })
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(screen.queryByText('flaky')).not.toBeInTheDocument()
  expect(screen.getByText('No results found.')).toBeInTheDocument()
})

test('one polite live region reports both groups', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [issue({ id: 'a', number: 1, title: 'match alpha' })],
  }
  mount()
  await type('match')
  await settleServer([serverHit('s1', 'Server hit')])

  const regions = screen.getAllByRole('status')
  expect(regions).toHaveLength(1)
  expect(regions[0]).toHaveTextContent('1 result on this device, 1 result from the server.')
})

// Controlling the cursor moved it out of the primitive, which discarded it when the closed
// dialog unmounted its list, and into the provider, which never unmounts. A cursor that survives
// a close is a launcher that re-fires the last thing you ran — including a mutating row — on a
// bare Cmd-K plus Enter.
test('reopening the palette puts the cursor back on the first row', async () => {
  mount()
  await type('go to inbox')
  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith({ to: '/inbox' })

  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
  expect(itemValues()[0]).toBe('action:create-issue')
  expect(activeValue()).toBe('action:create-issue')

  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(screen.getByLabelText('New issue title')).toBeInTheDocument()
})

test('closing on a moved cursor does not carry it into the next visit', async () => {
  mount()
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  const moved = activeValue()
  expect(moved).not.toBe('action:create-issue')

  fireEvent.keyDown(input(), { key: 'Escape' })
  expect(screen.queryByPlaceholderText('Type a command or search…')).not.toBeInTheDocument()

  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
  // `moved` is an action row, so it is still in the list on reopen — the cursor has to be reset
  // deliberately rather than fall back because its row vanished.
  expect(itemValues()).toContain(moved)
  expect(activeValue()).toBe('action:create-issue')
})

// A sub-page is a new list under the same provider, so it gets a new session too.
test('a sub-page reopens on its own first row', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'labels.byTeam': [
      { id: 'l-1', name: 'flaky', color: '#f00' },
      { id: 'l-2', name: 'regression', color: '#0f0' },
    ],
  }
  render(
    <CommandProvider teamId="team-1" issues={[]}>
      <Opener />
    </CommandProvider>,
  )
  act(() => {
    fireEvent.click(screen.getByText('open label page'))
  })
  fireEvent.keyDown(screen.getByPlaceholderText(/Add label to/), { key: 'ArrowDown' })
  expect(activeValue()).toBe('label:l-2')

  act(() => {
    fireEvent.click(screen.getByText('open label page'))
  })
  expect(activeValue()).toBe('label:l-1')
})
