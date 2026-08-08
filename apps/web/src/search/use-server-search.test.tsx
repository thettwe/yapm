import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ConnectionSummary } from '@/zero/connection'
import type { ServerSearchResponse, ServerSearchResult } from './api'

const connection = vi.hoisted(() => ({
  summary: {
    state: 'connected',
    recovery: 'idle',
    label: 'Synced',
    writable: true,
    retryOffered: false,
  } as ConnectionSummary,
}))

vi.mock('@/zero/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/connection')>()),
  useConnectionSummary: () => connection.summary,
}))

import { SERVER_SEARCH_DEBOUNCE_MS, useServerSearch } from './use-server-search'

function hit(id: string): ServerSearchResult {
  return {
    type: 'comment',
    id,
    issueId: 'issue-1',
    teamId: 'team-1',
    issueKey: 'ENG-1',
    issueTitle: 'A title',
    status: 'todo',
    needsTriage: false,
    snippet: 'a snippet',
    updatedAt: '2026-07-01T00:00:00.000Z',
  }
}

interface Pending {
  url: string
  signal: AbortSignal
  resolve: (body: ServerSearchResponse) => void
}

let pending: Pending[] = []

function respondJson(body: ServerSearchResponse): Response {
  return { ok: true, json: async () => body } as unknown as Response
}

beforeEach(() => {
  vi.useFakeTimers()
  pending = []
  connection.summary = { ...connection.summary, state: 'connected', writable: true }
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal
      return new Promise<Response>((resolve, reject) => {
        pending.push({ url: input, signal, resolve: (body) => resolve(respondJson(body)) })
        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function settle(ms = SERVER_SEARCH_DEBOUNCE_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

// Resolve a pending request and let the `.then` chain (including `json()`) reach React.
async function deliver(request: Pending | undefined, body: ServerSearchResponse) {
  await act(async () => {
    request?.resolve(body)
    await vi.advanceTimersByTimeAsync(0)
  })
}

test('a query below the shared minimum length issues no request at all', async () => {
  const view = renderHook(({ q }: { q: string }) => useServerSearch(q), {
    initialProps: { q: '' },
  })
  expect(view.result.current.phase).toBe('too-short')

  view.rerender({ q: 'r' })
  await settle()
  expect(pending).toHaveLength(0)
  expect(view.result.current.phase).toBe('too-short')

  // Whitespace does not count toward the minimum either — the rule is the shared
  // `isServerSearchable`, not a second length check that could disagree with the route's.
  view.rerender({ q: '  r  ' })
  await settle()
  expect(pending).toHaveLength(0)

  view.rerender({ q: 'rep' })
  await settle()
  expect(pending).toHaveLength(1)
  expect(view.result.current.phase).toBe('searching')
})

test('one debounced request per settled query, not one per keystroke', async () => {
  const view = renderHook(({ q }: { q: string }) => useServerSearch(q), {
    initialProps: { q: 're' },
  })
  await settle()
  expect(pending).toHaveLength(1)

  for (const q of ['rep', 'repl', 'repli']) {
    view.rerender({ q })
    await settle(50)
  }
  // The three keystrokes inside the window collapse into one further request.
  await settle()
  expect(pending).toHaveLength(2)
  expect(pending[1]?.url).toContain('q=repli')
})

test('a superseded response is discarded rather than rendered', async () => {
  const view = renderHook(({ q }: { q: string }) => useServerSearch(q), {
    initialProps: { q: 'alpha' },
  })
  await settle()
  const first = pending[0]
  expect(first).toBeDefined()

  // The race that actually happens: the response lands before the abort, so its `.then` is already
  // queued and WILL run. Resolving without flushing, then re-rendering, reproduces exactly that
  // ordering — the abort arrives too late to stop the continuation, and the guard inside it is the
  // only thing that keeps the stale answer off the surface.
  act(() => {
    first?.resolve({ results: [hit('stale')], truncated: false })
  })
  view.rerender({ q: 'bravo' })
  await settle()
  expect(first?.signal.aborted).toBe(true)
  expect(view.result.current.results).toHaveLength(0)
  expect(view.result.current.phase).toBe('searching')

  await deliver(pending[1], { results: [hit('fresh')], truncated: false })
  expect(view.result.current.phase).toBe('ready')
  expect(view.result.current.results.map((r) => r.id)).toEqual(['fresh'])
})

test('results for an earlier query are never shown while a newer one is in flight', async () => {
  const view = renderHook(({ q }: { q: string }) => useServerSearch(q), {
    initialProps: { q: 'alpha' },
  })
  await settle()
  await deliver(pending[0], { results: [hit('alpha-hit')], truncated: true })
  expect(view.result.current.phase).toBe('ready')
  expect(view.result.current.truncated).toBe(true)

  view.rerender({ q: 'alphab' })
  expect(view.result.current.phase).toBe('searching')
  expect(view.result.current.results).toHaveLength(0)
  expect(view.result.current.truncated).toBe(false)
})

test('unmounting aborts the request in flight', async () => {
  const view = renderHook(() => useServerSearch('alpha'))
  await settle()
  expect(pending[0]?.signal.aborted).toBe(false)

  view.unmount()
  expect(pending[0]?.signal.aborted).toBe(true)
})

// The offline state comes from the EXISTING sync connection summary, not from a second notion of
// "online" invented for search.
test('the offline state follows the existing connection state, and recovers without a reload', async () => {
  connection.summary = { ...connection.summary, state: 'disconnected', writable: false }
  const view = renderHook(({ q }: { q: string }) => useServerSearch(q), {
    initialProps: { q: 'alpha' },
  })
  await settle()
  expect(view.result.current.phase).toBe('offline')
  expect(pending).toHaveLength(0)

  connection.summary = { ...connection.summary, state: 'connected', writable: true }
  view.rerender({ q: 'alpha' })
  await settle()
  expect(pending).toHaveLength(1)
  await deliver(pending[0], { results: [hit('back')], truncated: false })
  expect(view.result.current.phase).toBe('ready')
})

test('a still-dialling connection is not reported as offline', async () => {
  connection.summary = { ...connection.summary, state: 'connecting', writable: true }
  const view = renderHook(() => useServerSearch('alpha'))
  await settle()
  expect(view.result.current.phase).toBe('searching')
  expect(pending).toHaveLength(1)
})

test('the team argument is carried on the request', async () => {
  renderHook(() => useServerSearch('alpha', { teamId: 'team-9' }))
  await settle()
  expect(pending[0]?.url).toContain('teamId=team-9')
})
