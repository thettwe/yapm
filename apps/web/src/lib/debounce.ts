import { useEffect, useState } from 'react'

/**
 * The settled value of something that changes on every keystroke.
 *
 * A VALUE rather than a callback deliberately. A debounced callback captures whatever the closure
 * held when it was created, so the request that finally fires can be for a query the user has
 * already replaced — the exact bug the server pass's abort logic exists to catch, arriving through
 * a second door. Debouncing the value instead means the effect that issues the request reads the
 * settled query from its own dependency list and cannot be stale.
 *
 * The first value is returned immediately: a fresh mount has nothing to settle, and delaying it
 * would put a needless 150 ms in front of a query restored from a URL.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value)

  useEffect(() => {
    if (Object.is(settled, value)) return
    const timer = setTimeout(() => setSettled(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs, settled])

  return settled
}
