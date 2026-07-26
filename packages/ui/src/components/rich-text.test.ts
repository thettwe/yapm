import { expect, test, vi } from 'vitest'
import type { RichTextKeyEvent, RichTextValue } from './rich-text'
import { EMPTY_DOC, handleRichTextKeyDown, isRichTextEmpty } from './rich-text'

test('a null or undefined document is empty', () => {
  expect(isRichTextEmpty(null)).toBe(true)
  expect(isRichTextEmpty(undefined)).toBe(true)
})

test('the canonical empty document is empty', () => {
  expect(isRichTextEmpty(EMPTY_DOC)).toBe(true)
})

test('a document with only whitespace text is empty', () => {
  const doc: RichTextValue = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: '   ' }] }],
  }
  expect(isRichTextEmpty(doc)).toBe(true)
})

test('a document with real text is not empty', () => {
  const doc: RichTextValue = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
  }
  expect(isRichTextEmpty(doc)).toBe(false)
})

test('a document with a non-empty block node is not empty', () => {
  const doc: RichTextValue = {
    type: 'doc',
    content: [
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
          },
        ],
      },
    ],
  }
  expect(isRichTextEmpty(doc)).toBe(false)
})

function keyEvent(overrides: Partial<RichTextKeyEvent> = {}): RichTextKeyEvent {
  return {
    key: 'a',
    metaKey: false,
    ctrlKey: false,
    consumed: false,
    preventDefault: () => {},
    stopPropagation: () => {},
    ...overrides,
  }
}

test('an ordinary Escape cancels', () => {
  const onCancel = vi.fn()
  const onSubmit = vi.fn()
  const preventDefault = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Escape', preventDefault }), { onSubmit, onCancel })

  expect(onCancel).toHaveBeenCalledOnce()
  expect(onSubmit).not.toHaveBeenCalled()
  expect(preventDefault).toHaveBeenCalledOnce()
})

test('an ordinary Cmd+Enter and an ordinary Ctrl+Enter both submit', () => {
  for (const modifier of ['metaKey', 'ctrlKey'] as const) {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()

    handleRichTextKeyDown(keyEvent({ key: 'Enter', [modifier]: true }), { onSubmit, onCancel })

    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  }
})

test('a key the typeahead already consumed fires neither callback', () => {
  for (const event of [
    keyEvent({ key: 'Escape', consumed: true }),
    keyEvent({ key: 'Enter', metaKey: true, consumed: true }),
    keyEvent({ key: 'Enter', ctrlKey: true, consumed: true }),
  ]) {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()

    handleRichTextKeyDown(event, { onSubmit, onCancel })

    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  }
})

test('a consumed key is not swallowed a second time', () => {
  const preventDefault = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Escape', consumed: true, preventDefault }), {
    onCancel: () => {},
  })

  expect(preventDefault).not.toHaveBeenCalled()
})

// THE REGRESSION THIS FIELD EXISTS FOR. `prosemirror-view`'s `captureKeyDown` returns true for
// keyCode 13 and 27 unconditionally, so the view calls `preventDefault()` on every Enter and every
// Escape whether or not anything handled them. A guard keyed on `defaultPrevented` — the obvious
// reading, and what this change first shipped — is therefore ALWAYS taken inside a ProseMirror
// editor, which silently kills "Escape cancels this edit" and "⌘↵ sends" on every surface in the
// app. Only a real browser found it; this asserts the corrected contract so it cannot come back.
test('an unconsumed Escape and Cmd+Enter still act, however ProseMirror treated the native event', () => {
  const onCancel = vi.fn()
  const onSubmit = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Escape', consumed: false }), { onSubmit, onCancel })
  handleRichTextKeyDown(keyEvent({ key: 'Enter', metaKey: true, consumed: false }), {
    onSubmit,
    onCancel,
  })

  expect(onCancel).toHaveBeenCalledOnce()
  expect(onSubmit).toHaveBeenCalledOnce()
})

// Standing down is not enough — the event has to be stopped, not merely ignored. Base UI's dialog
// dismissal checks neither `defaultPrevented` nor origin, so an Escape that only dismissed a
// typeahead would still close the Sheet holding the draft. Verified in the browser by
// `apps/web/e2e/mentions.spec.ts`; asserted here so the line cannot be deleted as dead.
test('a key the typeahead consumed is stopped, whatever handlers this surface has', () => {
  for (const handlers of [{}, { onCancel: () => {} }, { onSubmit: () => {} }]) {
    for (const event of [
      keyEvent({ key: 'Escape', consumed: true }),
      keyEvent({ key: 'Enter', metaKey: true, consumed: true }),
    ]) {
      const stopPropagation = vi.fn()

      handleRichTextKeyDown({ ...event, stopPropagation }, handlers)

      expect(stopPropagation).toHaveBeenCalledOnce()
    }
  }
})

// The same rule in the other direction, and the one that keeps "Escape cancels this edit" from
// also meaning "Escape closes the panel the edit lives in".
test('a key THIS surface handles is stopped too', () => {
  for (const event of [
    keyEvent({ key: 'Escape' }),
    keyEvent({ key: 'Enter', metaKey: true }),
    keyEvent({ key: 'Enter', ctrlKey: true }),
  ]) {
    const stopPropagation = vi.fn()

    handleRichTextKeyDown({ ...event, stopPropagation }, { onSubmit: () => {}, onCancel: () => {} })

    expect(stopPropagation).toHaveBeenCalledOnce()
  }
})

// A key NOBODY consumed keeps bubbling untouched, which is what leaves every shortcut above this
// surface working — Cmd+K reaches the palette from inside an editor, and Escape reaches the Sheet
// from an editor that offers no cancel of its own.
test('a key nobody consumed keeps bubbling', () => {
  for (const [event, handlers] of [
    [keyEvent({ key: 'k', metaKey: true }), { onSubmit: () => {}, onCancel: () => {} }],
    [keyEvent({ key: 'Escape' }), { onSubmit: () => {} }],
    [keyEvent({ key: 'Enter', metaKey: true }), { onCancel: () => {} }],
    [keyEvent({ key: 'Escape' }), {}],
  ] as const) {
    const stopPropagation = vi.fn()

    handleRichTextKeyDown({ ...event, stopPropagation }, handlers)

    expect(stopPropagation).not.toHaveBeenCalled()
  }
})

test('a bare Enter neither submits nor cancels', () => {
  const onCancel = vi.fn()
  const onSubmit = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Enter' }), { onSubmit, onCancel })

  expect(onSubmit).not.toHaveBeenCalled()
  expect(onCancel).not.toHaveBeenCalled()
})

test('a missing handler leaves the key untouched', () => {
  const preventDefault = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Escape', preventDefault }), {})

  expect(preventDefault).not.toHaveBeenCalled()
})
