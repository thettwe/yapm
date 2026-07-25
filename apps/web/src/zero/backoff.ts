// Zero stops retrying on its own from `needs-auth` and `error`, so recovery is ours to
// schedule. The cap is the load-bearing part: without it a persistent server-side fault
// turns the recovery loop into a CPU-pinning hot loop, which is the bug this exists to fix.
export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_FACTOR = 2
export const BACKOFF_CAP_MS = 30_000

// Full jitter, not none and not ±20%: the failure is correlated across tabs and users
// (a machine waking several tabs at once), and only full jitter decorrelates that herd.
export function backoffCeiling(attempt: number): number {
  const exponent = Math.max(0, Math.trunc(attempt))
  const uncapped = BACKOFF_BASE_MS * BACKOFF_FACTOR ** exponent
  return Number.isFinite(uncapped) ? Math.min(BACKOFF_CAP_MS, uncapped) : BACKOFF_CAP_MS
}

export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  return random() * backoffCeiling(attempt)
}

export function atBackoffCeiling(attempt: number): boolean {
  return backoffCeiling(attempt) >= BACKOFF_CAP_MS
}
