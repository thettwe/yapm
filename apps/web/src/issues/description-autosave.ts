import { type RichTextValue, richTextSkew } from '@yapm/ui/components/rich-text'
import { useCallback, useEffect, useMemo, useRef } from 'react'

/** Long enough that a burst of keystrokes settles into one write, short enough to feel immediate. */
export const DESCRIPTION_AUTOSAVE_MS = 500

export interface DescriptionAutosave {
  /** Arms the debounce with the document the editor is holding right now. */
  readonly save: (doc: RichTextValue) => void
  /** Writes the pending document immediately, if there is one and it is still safe to write. */
  readonly flush: () => void
}

/**
 * The description's debounced write, and the one place that can refuse it.
 *
 * `RichTextEditor` refuses to construct an editable editor over a document holding node types this
 * bundle cannot represent — but the refusal is evaluated when the SYNCED document changes, and the
 * debounce armed a moment earlier is still running with the pre-block document in hand. Left alone
 * it fires after the guard has already flipped the surface read-only and writes a document that has
 * lost whatever the newer bundle put there, which is precisely the loss the guard exists to prevent.
 *
 * So the skew check lives on the write path as well as on the render path: the timer is cancelled
 * the moment the synced document goes out of range, and `flush` bails rather than trusting that it
 * was.
 */
export function useDescriptionAutosave(
  synced: RichTextValue | null,
  commit: (doc: RichTextValue) => void,
): DescriptionAutosave {
  const pending = useRef<RichTextValue | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const blocked = useMemo(() => richTextSkew(synced).blocked, [synced])
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const commitRef = useRef(commit)
  commitRef.current = commit

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pending.current = null
  }, [])

  const flush = useCallback(() => {
    const doc = pending.current
    cancel()
    if (doc === null || blockedRef.current) return
    commitRef.current(doc)
  }, [cancel])

  const save = useCallback(
    (doc: RichTextValue) => {
      if (blockedRef.current) return
      pending.current = doc
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(flush, DESCRIPTION_AUTOSAVE_MS)
    },
    [flush],
  )

  useEffect(() => {
    if (blocked) cancel()
  }, [blocked, cancel])

  // The pending edit is flushed on unmount — closing the panel must not lose the last keystroke.
  useEffect(() => () => flush(), [flush])

  return { save, flush }
}
