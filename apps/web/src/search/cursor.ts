import { useCallback, useEffect, useState } from 'react'

export interface SearchCursor {
  /** The active row's identity, or `''` when there are no rows. */
  readonly active: string
  readonly setActive: (id: string) => void
}

/**
 * The one cursor rule, shared by both search surfaces.
 *
 * The cursor is keyed to a ROW IDENTITY, never to a list index: appending the server group below
 * the on-device group changes every index after it, and a cursor that moves when a group arrives
 * is the defect H12's answer exists to prevent. Identity is immune to appends by construction.
 *
 * When the active row leaves the list because the query narrowed, the cursor falls to the FIRST
 * row of the first group — one stated rule, applied on both surfaces, rather than whatever the
 * underlying primitive happens to do. The fallback is derived during render so there is never a
 * frame with nothing active, and committed in an effect so a row that reappears later does not
 * silently take the cursor back.
 *
 * `sessionKey` bounds how long a cursor may live. Controlling the cursor moved this state out of
 * the primitive — which discards it when the list unmounts — into a caller that may outlive the
 * list it describes, so the caller has to say when a cursor stops meaning anything. A closed
 * palette is the case that bites: its provider stays mounted, so without a new key the row that
 * was last activated would still be active the next time the palette opens, and a bare Cmd-K plus
 * Enter would re-fire it instead of the first row.
 */
export function useSearchCursor(
  rowIds: readonly string[],
  sessionKey: unknown = null,
): SearchCursor {
  const [state, setState] = useState<{ key: unknown; id: string }>({ key: sessionKey, id: '' })
  const selected = state.key === sessionKey ? state.id : ''
  const active = rowIds.includes(selected) ? selected : (rowIds[0] ?? '')

  useEffect(() => {
    setState((previous) =>
      previous.key === sessionKey && previous.id === active
        ? previous
        : { key: sessionKey, id: active },
    )
  }, [sessionKey, active])

  const setActive = useCallback((id: string) => setState({ key: sessionKey, id }), [sessionKey])

  return { active, setActive }
}
