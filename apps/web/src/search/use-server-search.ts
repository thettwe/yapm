import { isServerSearchable, SERVER_RESULT_LIMIT } from '@yapm/schema'
import { useEffect, useState } from 'react'
import { useDebouncedValue } from '@/lib/debounce'
import {
  EMPTY_SERVER_RESPONSE,
  fetchServerSearch,
  type ServerSearchResponse,
  type ServerSearchResult,
} from '@/search/api'
import { type ConnectionSummary, useConnectionSummary } from '@/zero/connection'

// Long enough that a typed word costs one request rather than one per letter, short enough that the
// server group lands while the eye is still on the on-device group above it.
export const SERVER_SEARCH_DEBOUNCE_MS = 150

// The states design D17 fixed, as a closed union so a surface cannot invent a seventh.
export type ServerSearchPhase = 'too-short' | 'offline' | 'searching' | 'ready'

export interface ServerSearch {
  readonly phase: ServerSearchPhase
  readonly results: readonly ServerSearchResult[]
  readonly truncated: boolean
}

export interface ServerSearchOptions {
  readonly teamId?: string | undefined
  readonly limit?: number | undefined
}

/**
 * Whether the server pass is worth attempting, read from the EXISTING sync connection summary
 * rather than from a second notion of "online" invented here. `writable` is true for exactly
 * `connected` and `connecting` — the two states where a request is worth issuing — so a boot that
 * has not finished dialling does not flash "offline" at somebody who is merely early.
 */
export function isServerPassAvailable(summary: ConnectionSummary): boolean {
  return summary.writable
}

// The identity of an answer. Results are shown ONLY when this matches the live input, so a response
// for a query the user has already replaced is discarded rather than rendered — the abort below is
// the first line of that defence and this is the second, because an abort that loses a race still
// resolves.
//
// The separator is written as the ESCAPE `\u0000`, never as a literal NUL byte. A source file
// containing one is classified binary by git and by every repo-wide text search, so it stops
// being reviewable in a diff and stops being greppable. Runtime-identical; keep it escaped.
function answerKey(query: string, teamId: string | undefined, limit: number): string {
  return `${limit}\u0000${teamId ?? ''}\u0000${query}`
}

interface Answer {
  readonly key: string
  readonly response: ServerSearchResponse
}

const NO_ANSWER: Answer = { key: '\u0000unanswered', response: EMPTY_SERVER_RESPONSE }

/**
 * The server half of the hybrid. It never blocks the on-device pass and it never issues a request
 * the shared minimum-length rule says is not worth one — `isServerSearchable` is imported from the
 * shared core so the client and the route cannot disagree about when the index is touched.
 */
export function useServerSearch(query: string, options: ServerSearchOptions = {}): ServerSearch {
  const { teamId } = options
  const limit = options.limit ?? SERVER_RESULT_LIMIT
  const available = isServerPassAvailable(useConnectionSummary())
  const debounced = useDebouncedValue(query, SERVER_SEARCH_DEBOUNCE_MS)
  const [answer, setAnswer] = useState<Answer>(NO_ANSWER)

  const liveKey = answerKey(query, teamId, limit)
  const settledKey = answerKey(debounced, teamId, limit)

  useEffect(() => {
    // A short query answers locally and issues NO request at all. The rule is a property of the
    // query, never of whether anything would have matched — the latter would make the state an
    // oracle over the corpus.
    if (!isServerSearchable(debounced)) {
      setAnswer({ key: settledKey, response: EMPTY_SERVER_RESPONSE })
      return
    }
    if (!available) return

    const controller = new AbortController()
    void fetchServerSearch({ query: debounced, teamId, limit, signal: controller.signal })
      .then((response) => {
        // Belt to the key comparison's braces. No reachable ordering makes it load-bearing — a
        // continuation that survives an abort still carries the key it was issued for, and the
        // comparison below is what decides whether that key is live — so it is deliberately kept
        // as the narrower, cheaper check rather than removed for want of a test that isolates it.
        if (controller.signal.aborted) return
        setAnswer({ key: settledKey, response })
      })
      .catch(() => {
        // An aborted or failed request leaves the previous answer in place; the key comparison
        // below then reports `searching` rather than showing results for the wrong query.
      })

    return () => controller.abort()
  }, [debounced, settledKey, teamId, limit, available])

  if (!isServerSearchable(query)) {
    return { phase: 'too-short', results: [], truncated: false }
  }
  if (!available) {
    return { phase: 'offline', results: [], truncated: false }
  }
  if (answer.key !== liveKey) {
    return { phase: 'searching', results: [], truncated: false }
  }
  return {
    phase: 'ready',
    results: answer.response.results,
    truncated: answer.response.truncated,
  }
}
