import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { BACKOFF_CAP_MS } from './backoff'

const mocks = vi.hoisted(() => ({
  options: [] as { cacheURL?: unknown }[],
}))

// The whole point of the headline check: record what the Zero client would have been constructed
// with, without constructing one.
vi.mock('@rocicorp/zero/react', () => ({
  ZeroProvider: (props: { children: React.ReactNode; cacheURL?: unknown }) => {
    mocks.options.push({ cacheURL: props.cacheURL })
    return props.children
  },
  useZero: () => ({ connection: { connect: () => Promise.resolve() } }),
  useConnectionState: () => ({ name: 'connected' }),
}))

vi.mock('@/auth/client', () => ({
  useSession: () => ({ data: null }),
}))

vi.mock('@/zero/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/zero/session')>()),
  fetchSyncCredential: () => Promise.resolve({ kind: 'no-session' as const }),
}))

import { ZeroRoot } from './provider'
import { RUNTIME_CONFIG_URL, RuntimeConfigGate } from './runtime-config'

function serve(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      if (String(input) !== RUNTIME_CONFIG_URL) return Promise.reject(new Error('unexpected fetch'))
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      )
    }),
  )
}

function App() {
  return (
    <RuntimeConfigGate>
      {(config) => (
        <ZeroRoot cacheUrl={config.zeroCacheUrl}>
          <span data-testid="app">mounted</span>
        </ZeroRoot>
      )}
    </RuntimeConfigGate>
  )
}

beforeEach(() => {
  mocks.options.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

// THE HEADLINE CHECK. The same unchanged bundle connects wherever the SERVED config says, so a
// published image can be pointed at a real host by an env change and a restart.
test('the served config decides where the client connects, with no rebuild', async () => {
  serve({ zeroCacheUrl: 'https://a.example' })
  const first = render(<App />)
  await screen.findByTestId('app')
  expect(mocks.options.at(-1)?.cacheURL).toBe('https://a.example')
  first.unmount()

  mocks.options.length = 0
  serve({ zeroCacheUrl: 'https://b.example' })
  render(<App />)
  await screen.findByTestId('app')
  expect(mocks.options.at(-1)?.cacheURL).toBe('https://b.example')
})

test('constructs no Zero client, and shows no error, while the config is in flight', async () => {
  let release: ((value: Response) => void) | undefined
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>((resolve) => (release = resolve))),
  )

  render(<App />)

  expect(await screen.findByTestId('runtime-config-boot')).toBeInTheDocument()
  expect(mocks.options).toEqual([])
  expect(screen.queryByText(new RegExp(RUNTIME_CONFIG_URL))).not.toBeInTheDocument()

  release?.(
    new Response(JSON.stringify({ zeroCacheUrl: 'https://c.example' }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
  await screen.findByTestId('app')
  expect(mocks.options.at(-1)?.cacheURL).toBe('https://c.example')
})

test('a response without a usable zeroCacheUrl is a failure, never a silent default', async () => {
  vi.useFakeTimers()
  serve({})
  render(<App />)

  // Walk the shared backoff. Nothing visible until the ceiling, and no client at any point: a
  // missing `zeroCacheUrl` must never be defaulted past.
  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKOFF_CAP_MS + 1_000)
    })
  }

  expect(mocks.options).toEqual([])
  expect(screen.getByTestId('runtime-config-failed')).toHaveTextContent(RUNTIME_CONFIG_URL)
})

// This surface replaced the shipped sync-unavailable one for a server that is unreachable at page
// load, so it owes the same affordances: a landmark, a polite live region, and a way out that does
// not require a reload. Matched to `SyncUnavailable` in `components/authenticated.tsx`.
test('the failure surface is a landmark with a live region and a keyboard-reachable retry', async () => {
  vi.useFakeTimers()
  serve({}, 500)
  render(<App />)

  for (let step = 0; step < 10; step += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BACKOFF_CAP_MS + 1_000)
    })
  }

  const failed = screen.getByTestId('runtime-config-failed')
  expect(failed.tagName).toBe('MAIN')
  const live = screen.getByRole('status')
  expect(live).toHaveAttribute('aria-live', 'polite')
  expect(live).toHaveTextContent(RUNTIME_CONFIG_URL)

  // Pressing it takes the answer of a config that is now being served, without a reload.
  serve({ zeroCacheUrl: 'https://d.example' })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Retry now' }))
    await vi.advanceTimersByTimeAsync(0)
  })

  expect(screen.getByTestId('app')).toBeInTheDocument()
  expect(mocks.options.at(-1)?.cacheURL).toBe('https://d.example')
})

test('the boot wait is announced politely, a beat after it starts', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  )
  render(<App />)

  // The region exists from the first paint — one added at the same moment as its text is not
  // reliably announced — and says nothing while there is nothing true to say.
  expect(screen.getByRole('status')).toBeEmptyDOMElement()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_500)
  })
  expect(screen.getByRole('status')).toHaveTextContent('Loading…')
})

// The grep in the falsifiable-check list, as a test that stays green rather than a one-off. On
// `main` this fails at `provider.tsx:33`.
test('no source under apps/web/src reads VITE_ZERO_CACHE_URL', () => {
  const root = join(process.cwd(), 'src')
  const offending: string[] = []

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry)) continue
      if (path.endsWith('runtime-config.test.tsx')) continue
      if (readFileSync(path, 'utf8').includes('VITE_ZERO_CACHE_URL')) offending.push(path)
    }
  }

  walk(root)
  expect(offending).toEqual([])
})
