import { expect, test } from 'vitest'
import type { RichTextValue } from './rich-text'
import { EMPTY_DOC, isRichTextEmpty } from './rich-text'

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
