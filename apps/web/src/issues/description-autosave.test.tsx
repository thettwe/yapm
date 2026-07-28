import { act, renderHook } from '@testing-library/react'
import type { RichTextValue } from '@yapm/ui/components/rich-text'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESCRIPTION_AUTOSAVE_MS, useDescriptionAutosave } from '@/issues/description-autosave'

const EDIT: RichTextValue = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'my edit' }] }],
}

const PLAIN: RichTextValue = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ordinary' }] }],
}

// A node type no bundle of yapm declares, so this is what a document written by a NEWER bundle
// looks like to this one.
const SKEWED: RichTextValue = {
  type: 'doc',
  content: [{ type: 'callout', content: [{ type: 'paragraph' }] }],
} as RichTextValue

function arm(synced: RichTextValue | null) {
  const commit = vi.fn()
  const view = renderHook(
    ({ value }: { value: RichTextValue | null }) => useDescriptionAutosave(value, commit),
    { initialProps: { value: synced } },
  )
  return { commit, view }
}

describe('the description debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('writes once after the debounce settles', () => {
    const { commit, view } = arm(PLAIN)
    act(() => view.result.current.save(EDIT))
    expect(commit).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(DESCRIPTION_AUTOSAVE_MS))
    expect(commit).toHaveBeenCalledExactlyOnceWith(EDIT)
  })

  // THE REGRESSION. A tab holding an armed debounce receives a document from a newer bundle: the
  // editor flips to its blocked state, but the timer is still holding the PRE-BLOCK document, and
  // firing it writes the newer content away under LWW with nothing logged.
  it('never writes a pre-block document once the synced value goes out of range', () => {
    const { commit, view } = arm(PLAIN)
    act(() => view.result.current.save(EDIT))
    view.rerender({ value: SKEWED })
    act(() => vi.advanceTimersByTime(DESCRIPTION_AUTOSAVE_MS * 4))
    expect(commit).not.toHaveBeenCalled()
  })

  it('does not write a blocked document on unmount either', () => {
    const { commit, view } = arm(PLAIN)
    act(() => view.result.current.save(EDIT))
    view.rerender({ value: SKEWED })
    view.unmount()
    expect(commit).not.toHaveBeenCalled()
  })

  it('arms nothing at all while the synced document is out of range', () => {
    const { commit, view } = arm(SKEWED)
    act(() => view.result.current.save(EDIT))
    act(() => vi.advanceTimersByTime(DESCRIPTION_AUTOSAVE_MS * 4))
    expect(commit).not.toHaveBeenCalled()
  })

  it('flushes the pending edit on unmount when the document is still editable', () => {
    const { commit, view } = arm(PLAIN)
    act(() => view.result.current.save(EDIT))
    view.unmount()
    expect(commit).toHaveBeenCalledExactlyOnceWith(EDIT)
  })

  it('collapses a burst of edits into one write of the last document', () => {
    const { commit, view } = arm(PLAIN)
    act(() => {
      view.result.current.save(PLAIN)
      vi.advanceTimersByTime(DESCRIPTION_AUTOSAVE_MS - 1)
      view.result.current.save(EDIT)
      vi.advanceTimersByTime(DESCRIPTION_AUTOSAVE_MS)
    })
    expect(commit).toHaveBeenCalledExactlyOnceWith(EDIT)
  })
})
