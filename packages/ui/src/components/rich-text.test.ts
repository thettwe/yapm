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
    defaultPrevented: false,
    preventDefault: () => {},
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

test('a key an inner surface already handled fires neither callback', () => {
  for (const event of [
    keyEvent({ key: 'Escape', defaultPrevented: true }),
    keyEvent({ key: 'Enter', metaKey: true, defaultPrevented: true }),
    keyEvent({ key: 'Enter', ctrlKey: true, defaultPrevented: true }),
  ]) {
    const onCancel = vi.fn()
    const onSubmit = vi.fn()

    handleRichTextKeyDown(event, { onSubmit, onCancel })

    expect(onCancel).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  }
})

test('a handled key is not swallowed a second time', () => {
  const preventDefault = vi.fn()

  handleRichTextKeyDown(keyEvent({ key: 'Escape', defaultPrevented: true, preventDefault }), {
    onCancel: () => {},
  })

  expect(preventDefault).not.toHaveBeenCalled()
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
