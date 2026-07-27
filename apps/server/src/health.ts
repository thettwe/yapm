export interface ReadinessCheck {
  name: string
  run: () => Promise<string | undefined>
}

export interface ReadinessCheckResult {
  name: string
  ok: boolean
  durationMs: number
  detail?: string
  reason?: string
}

export interface ReadinessReport {
  status: 'ready' | 'not_ready'
  checks: ReadinessCheckResult[]
  reason?: string
}

function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    const parts = error.errors.map(describe).filter((part) => part.length > 0)
    if (parts.length > 0) return parts.join('; ')
  }
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    const message = error.message.length > 0 ? error.message : error.name
    return code === undefined ? message : `${message} (${String(code)})`
  }
  return String(error)
}

export async function runReadinessChecks(checks: ReadinessCheck[]): Promise<ReadinessReport> {
  const results: ReadinessCheckResult[] = []

  for (const check of checks) {
    const started = performance.now()
    try {
      const detail = await check.run()
      results.push({
        name: check.name,
        ok: true,
        durationMs: round(performance.now() - started),
        ...(typeof detail === 'string' ? { detail } : {}),
      })
    } catch (error) {
      results.push({
        name: check.name,
        ok: false,
        durationMs: round(performance.now() - started),
        reason: describe(error),
      })
    }
  }

  const failed = results.filter((result) => !result.ok)

  return {
    status: failed.length === 0 ? 'ready' : 'not_ready',
    checks: results,
    ...(failed.length > 0
      ? { reason: failed.map((result) => `${result.name}: ${result.reason}`).join('; ') }
      : {}),
  }
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

// A check whose failure is a VERDICT: the probe rejects, the instance reports not-ready, and an
// orchestrator takes it out of rotation. The opposite of `nonGatingCheck` below — use this when the
// thing being probed is something requests cannot be served without.
export function gatingCheck(
  name: string,
  probe: () => Promise<void>,
  timeoutMs = 2000,
): ReadinessCheck {
  return {
    name,
    run: async () => {
      await withTimeout(probe(), timeoutMs, `no response within ${timeoutMs}ms`)
      return undefined
    },
  }
}

export function databaseCheck(ping: () => Promise<void>, timeoutMs = 2000): ReadinessCheck {
  return gatingCheck('database', ping, timeoutMs)
}

// A check whose result is INFORMATION rather than a verdict: it reports what it found, and it
// reports a failure to find out as a detail string instead of an unhealthy process. Search
// freshness is the first of these — a lagging or unmeasurable index must never take an instance out
// of rotation, because the on-device pass is unaffected and the server pass degrades to fewer
// results rather than to an error.
export function nonGatingCheck(
  name: string,
  probe: () => Promise<string>,
  timeoutMs = 2000,
): ReadinessCheck {
  return {
    name,
    run: async () => {
      try {
        return await withTimeout(probe(), timeoutMs, `no response within ${timeoutMs}ms`)
      } catch (error) {
        return `unavailable: ${describe(error)}`
      }
    },
  }
}

export function replicationCheck(probe: () => Promise<string>, timeoutMs = 2000): ReadinessCheck {
  return {
    name: 'replication',
    run: () => withTimeout(probe(), timeoutMs, `no response within ${timeoutMs}ms`),
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
