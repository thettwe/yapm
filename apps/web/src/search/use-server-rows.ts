import { useMemo, useRef } from 'react'
import type { ServerSearchResult } from '@/search/api'
import { type SearchRow, serverSearchRows, withoutLocalDuplicates } from '@/search/results'

const NO_ROWS: readonly SearchRow[] = []

/**
 * The server group's rows, with the on-device duplicates suppressed ONCE — at the instant an answer
 * is adopted — rather than re-decided on every render.
 *
 * Suppression reads the on-device group, and that group keeps GROWING after the server answer has
 * painted: the sync engine replicates a row seconds later and `localRows` changes identity. Deciding
 * suppression per render therefore lets a late local arrival DELETE a server row already on screen —
 * which breaks D8's append-only invariant in the one direction it did not have to name, and drops
 * the cursor, keyed to a row identity that just left the list, back to the top.
 *
 * So the decision is made against the corpus as it stood when the answer landed, and an id that has
 * been shown for the current query is retained for as long as the answer still carries it. The
 * retained set is cleared when the query changes, because a new query is a new list.
 */
export function useDedupedServerRows(
  query: string,
  localRows: readonly SearchRow[],
  results: readonly ServerSearchResult[],
): readonly SearchRow[] {
  // Read only inside the memo below, which runs on a new answer — never on a corpus change. A ref
  // rather than a dependency is the whole point: the corpus must not be able to re-open the
  // question.
  const liveLocalRows = useRef(localRows)
  liveLocalRows.current = localRows

  const shown = useRef<{ query: string; ids: Set<string> }>({ query, ids: new Set<string>() })

  return useMemo(() => {
    if (shown.current.query !== query) shown.current = { query, ids: new Set<string>() }
    const rows = serverSearchRows(results)
    const kept = new Set(withoutLocalDuplicates(liveLocalRows.current, rows).map((row) => row.id))
    const visible = rows.filter((row) => kept.has(row.id) || shown.current.ids.has(row.id))
    for (const row of visible) shown.current.ids.add(row.id)
    return visible.length === 0 ? NO_ROWS : visible
  }, [query, results])
}
