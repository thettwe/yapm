import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { atBackoffCeiling, backoffDelay } from '@/zero/backoff'

// Served by the app itself, same origin, and proxied by Vite in dev — so dev and production resolve
// the sync origin through ONE mechanism. It was two (a Vite compile-time constant and nothing) and
// that is how a published image came to ship a bundle that dialled the end user's own localhost.
export const RUNTIME_CONFIG_URL = '/api/config'

// A boot-blocking fetch that hangs is a blank page forever. Bounded, then retried on the shared
// backoff like every other unreachable-server path in this app.
export const RUNTIME_CONFIG_TIMEOUT_MS = 10_000

export interface RuntimeConfig {
  zeroCacheUrl: string
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

// Rejects a missing or malformed `zeroCacheUrl` rather than defaulting past it. A silent fallback
// here would reintroduce the defect this exists to remove: a client that connects somewhere
// plausible and wrong, with nothing anywhere naming the cause.
export async function fetchRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(RUNTIME_CONFIG_URL, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(RUNTIME_CONFIG_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`${RUNTIME_CONFIG_URL} responded ${response.status}`)
  }
  const body: unknown = await response.json()
  const zeroCacheUrl = (body as { zeroCacheUrl?: unknown } | null)?.zeroCacheUrl
  if (!isHttpUrl(zeroCacheUrl)) {
    throw new Error(`${RUNTIME_CONFIG_URL} did not return an http(s) zeroCacheUrl`)
  }
  return { zeroCacheUrl }
}

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; config: RuntimeConfig }
  | { phase: 'failed'; reason: string }

interface RuntimeConfigGateProps {
  children: (config: RuntimeConfig) => ReactNode
}

// The gate mounts ABOVE the Zero client, and `children` is a function so nothing below it can be
// constructed before the origin is known: a client built on a placeholder would open a socket to
// the wrong host and then be torn down when the real value landed, reopening IndexedDB and
// rehydrating every query.
export function RuntimeConfigGate({ children }: RuntimeConfigGateProps) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const attemptRef = useRef(0)

  const load = useCallback((currentAttempt: number, cancelled: () => boolean) => {
    fetchRuntimeConfig().then(
      (config) => {
        if (!cancelled()) setState({ phase: 'ready', config })
      },
      (error: unknown) => {
        if (cancelled()) return
        // Only once the backoff has stopped growing is the failure worth showing: before that the
        // honest reading is "the server has not answered yet", and a page that says so on a slow
        // first paint is a page that cried wolf.
        if (atBackoffCeiling(currentAttempt)) {
          setState({
            phase: 'failed',
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        attemptRef.current = currentAttempt + 1
        setAttempt(attemptRef.current)
      },
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    const isCancelled = () => cancelled
    const delay = attempt === 0 ? 0 : backoffDelay(attempt - 1)
    const timer = setTimeout(() => load(attempt, isCancelled), delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [attempt, load])

  if (state.phase === 'ready') return children(state.config)

  if (state.phase === 'failed') {
    return (
      <div
        className="flex min-h-full items-center justify-center bg-background px-6 text-foreground"
        data-testid="runtime-config-failed"
      >
        <div className="max-w-md space-y-2 text-center">
          <p className="font-medium text-base">yapm can't reach its own configuration.</p>
          <p className="text-muted-foreground text-sm">
            <code>{RUNTIME_CONFIG_URL}</code> is not answering, so the sync origin is unknown and no
            data can load. Still retrying.
          </p>
          <p className="text-muted-foreground text-xs">{state.reason}</p>
        </div>
      </div>
    )
  }

  // The neutral boot shell: the page background and nothing else. No spinner — the fetch is
  // same-origin and usually resolves inside a frame, and a spinner that flashes for 20ms reads as
  // a glitch — and no copy, because there is nothing true to say yet.
  return <div className="min-h-full bg-background" data-testid="runtime-config-boot" />
}
