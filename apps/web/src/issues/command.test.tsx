import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ServerSearchResponse, ServerSearchResult } from '@/search/api'
import type { CorpusIssueRow, CorpusTeamRow } from '@/search/use-local-corpus'
import type { ConnectionSummary } from '@/zero/connection'

const harness = vi.hoisted(() => ({
  rows: {} as Record<string, readonly unknown[]>,
  navigate: vi.fn(),
  mutate: vi.fn(),
}))

vi.mock('@rocicorp/zero/react', () => ({
  useQuery: (request: unknown) => {
    if (request === false || request === undefined || request === null) {
      return [undefined, { type: 'unknown' }]
    }
    const name = (request as { query: { queryName: string } }).query.queryName
    return [harness.rows[name] ?? [], { type: 'complete' }]
  },
  useZero: () => ({ mutate: harness.mutate }),
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
  label: 'Synced',
  writable: true,
  retryOffered: false,
}

vi.mock('@/zero/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/connection')>()),
  useConnectionSummary: () => CONNECTED,
}))

import { CommandRegistryProvider } from '@/frame/command-registry'
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
  harness.mutate.mockReset().mockImplementation(() => ({
    client: Promise.resolve({ type: 'ok' }),
    server: Promise.resolve({ type: 'ok' }),
  }))
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
    <>
      <button type="button" onClick={() => api.openLabel(['issue-1'])}>
        open label page
      </button>
      <button type="button" onClick={() => api.openStatus(['issue-1'])}>
        open status page
      </button>
    </>
  )
}

// Mounted through the registry, because ⌘K is bound ONCE in the product and this palette registers
// with that owner rather than listening for itself (design app-frame §D6). The keystroke below
// therefore proves the registration too.
function tree() {
  return (
    <CommandRegistryProvider>
      <CommandProvider teamId="team-1" issues={[]}>
        <Opener />
      </CommandProvider>
    </CommandRegistryProvider>
  )
}

let view: ReturnType<typeof render> | undefined

function mount() {
  view = render(tree())
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
}

// A row arriving from the sync engine is a re-render with no interaction behind it — no keystroke,
// no click, no new request. Re-rendering rather than pressing a key is what keeps the cursor
// assertions below about the arrival instead of about the key that provoked it.
async function replicate() {
  await act(async () => {
    view?.rerender(tree())
    await vi.advanceTimersByTimeAsync(0)
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

// The palette is the keyboard route to the team Delivery view, which has no other launcher besides
// the view switcher. One row per team, in the same Navigate group as "Go to {team} issues", opening
// the default window rather than whatever the last reading happened to be.
test('a Navigate row reaches a team’s delivery view', async () => {
  mount()

  const row = screen.getByText('Go to Platform delivery').closest('[cmdk-item=""]')
  expect(row).not.toBeNull()
  expect(row?.closest('[cmdk-group=""]')).toHaveTextContent('Navigate')

  await type('platform delivery')
  expect(activeValue()).toBe('action:go-team-delivery:team-1')

  fireEvent.keyDown(input(), { key: 'Enter' })
  expect(harness.navigate).toHaveBeenCalledWith({
    to: '/teams/$teamId/delivery',
    params: { teamId: 'team-1' },
    search: { window: 6 },
  })
})

// `cmdk`'s scorer matched a fuzzy subsequence, so `gti` reached "Go to inbox". Taking filtering off
// it (D8) had to keep that reach, or every abbreviation anybody had learned stopped working.
test('an abbreviation still reaches the action row it always reached', async () => {
  mount()
  await type('gti')

  expect(screen.getByText('Go to inbox')).toBeInTheDocument()
  expect(screen.queryByText('New issue')).not.toBeInTheDocument()
})

// The two passes overlap by construction on a whole-word title token. Without suppression the same
// issue renders twice, once per group, which reads as a bug rather than as a seam.
test('an issue both passes match renders once', async () => {
  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [issue({ id: 'issue-9', number: 9, title: 'Replica resync' })],
  }
  mount()
  await type('replica')
  await settleServer([
    {
      ...serverHit('s1', 'Replica resync'),
      type: 'issue',
      id: 'issue-9',
      issueId: 'issue-9',
      snippet: '',
    },
    // A comment on the same issue is DIFFERENT text about it, and the on-device pass structurally
    // cannot hold comment bodies — so it stays.
    { ...serverHit('s2', 'Replica resync'), issueId: 'issue-9' },
  ])

  expect(screen.getAllByText('Replica resync')).toHaveLength(2)
  expect(itemValues()).not.toContain('server:issue:issue-9')
  expect(itemValues()).toContain('server:comment:s2')
})

// …and the other direction, which is the one that costs the caller something. The on-device group
// keeps growing after the server group has painted, so suppression decided per render lets a row
// that replicates seconds late DELETE a server row already on screen — taking the cursor keyed to
// it down with it. Suppression is decided once, against the corpus as it stood when the answer
// landed.
test('a local row that replicates late does not delete the server row already on screen', async () => {
  harness.rows = { 'teams.all': [TEAM] }
  mount()
  await type('replica')
  await settleServer([
    {
      ...serverHit('s1', 'Replica resync'),
      type: 'issue',
      id: 'issue-9',
      issueId: 'issue-9',
      snippet: '',
    },
  ])

  const before = itemValues()
  expect(before).toContain('server:issue:issue-9')
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  expect(activeValue()).toBe('server:issue:issue-9')

  harness.rows = {
    'teams.all': [TEAM],
    'issues.byTeam': [issue({ id: 'issue-9', number: 9, title: 'Replica resync' })],
  }
  await replicate()

  const after = itemValues()
  expect(after).toContain('local:issue:issue-9')
  expect(after).toContain('server:issue:issue-9')
  expect(activeValue()).toBe('server:issue:issue-9')
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
    <CommandRegistryProvider>
      <CommandProvider teamId="team-1" issues={[]}>
        <Opener />
      </CommandProvider>
    </CommandRegistryProvider>,
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

// ---------------------------------------------------------------------------
// The batch runner's session guard (RC3 family A). A batch completes on the SERVER's schedule,
// 50–500ms after the optimistic apply — long enough for the palette to have been reopened for
// something else. Its completion may act only on the session it was launched in: an unguarded
// close() was closing a palette the user had reopened and was typing into, and a stale rejection
// must not be scribbled onto an unrelated session either.
// ---------------------------------------------------------------------------

type ServerAck = { type: 'ok' } | { type: 'error'; error: { type: 'app'; message: string } }

function deferServerAck(): (details: ServerAck) => void {
  let ack: ((details: ServerAck) => void) | undefined
  harness.mutate.mockImplementation(() => ({
    client: Promise.resolve({ type: 'ok' }),
    server: new Promise<ServerAck>((resolve) => {
      ack = resolve
    }),
  }))
  return (details) => ack?.(details)
}

function launchStatusBatch(): (details: ServerAck) => void {
  const ack = deferServerAck()
  render(tree())
  act(() => {
    fireEvent.click(screen.getByText('open status page'))
  })
  fireEvent.click(screen.getByText('Set status: Done'))
  return ack
}

async function settleAck(ack: (details: ServerAck) => void, details: ServerAck): Promise<void> {
  await act(async () => {
    ack(details)
    await vi.advanceTimersByTimeAsync(0)
  })
}

test('a batch completing after the palette was reopened closes nothing', async () => {
  const ack = launchStatusBatch()

  // Reopened for something else before the server has answered — a new session.
  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })
  expect(input()).toBeInTheDocument()

  await settleAck(ack, { type: 'ok' })
  expect(input()).toBeInTheDocument()
})

test('a batch completing in its own session still closes the palette', async () => {
  const ack = launchStatusBatch()
  expect(screen.getByPlaceholderText(/^Set status of/)).toBeInTheDocument()

  await settleAck(ack, { type: 'ok' })
  expect(screen.queryByPlaceholderText(/^Set status of/)).not.toBeInTheDocument()
})

// Zero rebases the rejected optimistic apply away, so the surface the batch acted on visibly
// reverts — which is the rejection surfacing where the user is actually looking.
test('a late rejection is not written into the session the reader reopened', async () => {
  const ack = launchStatusBatch()

  act(() => {
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
  })

  await settleAck(ack, { type: 'error', error: { type: 'app', message: 'Not allowed' } })
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(input()).toBeInTheDocument()
})

test('a same-session rejection surfaces as the palette’s own error line', async () => {
  const ack = launchStatusBatch()

  await settleAck(ack, { type: 'error', error: { type: 'app', message: 'Not allowed' } })
  expect(screen.getByRole('alert')).toHaveTextContent('Not allowed')
  expect(screen.getByPlaceholderText(/^Set status of/)).toBeInTheDocument()
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
    <CommandRegistryProvider>
      <CommandProvider teamId="team-1" issues={[]}>
        <Opener />
      </CommandProvider>
    </CommandRegistryProvider>,
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
