// @vitest-environment jsdom

import { Fragment, Slice } from '@tiptap/pm/model'
import { Editor, type JSONContent } from '@tiptap/react'
import { createRichTextExtensions, richTextClipboardProps } from '@yapm/ui/components/rich-text'
import { afterEach, beforeAll, expect, test } from 'vitest'

// `prosemirror-view` measures the selection on every transaction that scrolls it into view, and
// jsdom implements none of the three geometry methods it reaches for. Without these, every dispatch
// throws `target.getClientRects is not a function` from inside ProseMirror rather than from a test.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

const NAMES = new Map([['ada', 'Ada Lovelace']])

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

function createEditor(content?: JSONContent): Editor {
  const element = document.createElement('div')
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: createRichTextExtensions(),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
    // The SAME object `RichTextEditor` spreads into its `editorProps`, so what is under test here
    // is the wiring that ships rather than a copy of it.
    editorProps: richTextClipboardProps((id) => NAMES.get(id)),
  })
  editors.push(editor)
  return editor
}

/**
 * Types one character at a time exactly as `prosemirror-view`'s DOM observer does: offer the text
 * to `handleTextInput` first — which is the prop TipTap's input-rule plugin registers — and insert
 * it literally only when nothing claimed it. Anything that bypasses `handleTextInput` (a command,
 * `insertContent`) never fires an input rule at all, so it would prove nothing.
 */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, char, () => editor.state.tr.insertText(char, from, to)),
    )
    if (handled !== true) editor.view.dispatch(editor.state.tr.insertText(char, from, to))
  }
}

/** jsdom implements neither `DataTransfer` nor `ClipboardEvent`; this is the surface both use. */
function clipboard(data: Record<string, string>): DataTransfer {
  return {
    types: Object.keys(data),
    getData: (format: string) => data[format] ?? '',
  } as unknown as DataTransfer
}

function pasteArgs(editor: Editor, data: Record<string, string>): [ClipboardEvent, Slice] {
  const { schema } = editor.state
  const text = data['text/plain'] ?? ''
  // The third argument is what `prosemirror-view` hands every handler after `parseFromClipboard`,
  // and the link extension's own `handlePaste` reads it. Supplying it is what lets the bare-URL
  // refusal below be seen HANDING OFF rather than merely declining.
  const slice =
    text === ''
      ? Slice.empty
      : new Slice(Fragment.from(schema.nodes.paragraph?.create(null, schema.text(text))), 1, 1)
  return [{ clipboardData: clipboard(data) } as unknown as ClipboardEvent, slice]
}

/** The markdown handler alone — `editorProps.handlePaste`, exactly as wired onto the view. */
function paste(editor: Editor, data: Record<string, string>): boolean {
  return editor.view.props.handlePaste?.(editor.view, ...pasteArgs(editor, data)) === true
}

/**
 * The whole walk `prosemirror-view`'s own paste handler performs: `editorProps` first, then every
 * plugin in turn. The ordering is why refusal 4 exists.
 */
function pasteThroughEditor(editor: Editor, data: Record<string, string>): boolean {
  const args = pasteArgs(editor, data)
  return editor.view.someProp('handlePaste', (f) => f(editor.view, ...args)) === true
}

// StarterKit 3.28 includes `TrailingNode`, so an editor whose last block is not a paragraph grows
// one. It is never content, and asserting it in every expectation below would say nothing.
function blocks(editor: Editor): JSONContent[] {
  const content = editor.getJSON().content ?? []
  const last = content.at(-1)
  if (content.length > 1 && last?.type === 'paragraph' && last.content === undefined) {
    return content.slice(0, -1)
  }
  return content
}

// ── 5.1 The two input rules ─────────────────────────────────────────────────────────────────────

test('typing `# ` produces the largest heading this editor defines', () => {
  const editor = createEditor()
  type(editor, '# Plan')

  expect(blocks(editor)).toEqual([
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
  ])
})

test('the new `# ` rule takes nothing away from the rules StarterKit already generated', () => {
  const two = createEditor()
  type(two, '## Two')
  expect((blocks(two)[0] as JSONContent).attrs).toEqual({ level: 2 })

  const three = createEditor()
  type(three, '### Three')
  expect((blocks(three)[0] as JSONContent).attrs).toEqual({ level: 3 })
})

test('typing `[text](url)` produces a link carrying that href', () => {
  const editor = createEditor()
  type(editor, '[yapm](https://yapm.dev)')

  expect(blocks(editor)).toEqual([
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'yapm',
          marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://yapm.dev' }) }],
        },
      ],
    },
  ])
})

test('neither shortcut fires inside a code block — the characters are the content', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language: null } }],
  })
  editor.commands.setTextSelection(1)
  type(editor, '# not a heading')

  expect(blocks(editor)).toEqual([
    {
      type: 'codeBlock',
      attrs: { language: null },
      content: [{ type: 'text', text: '# not a heading' }],
    },
  ])

  const link = createEditor({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language: null } }],
  })
  link.commands.setTextSelection(1)
  type(link, '[yapm](https://yapm.dev)')

  expect(JSON.stringify(link.getJSON())).not.toContain('link')
})

// ── 5.2 `clipboardTextSerializer` ───────────────────────────────────────────────────────────────

const COPY_SOURCE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Plan' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'ping ' },
        { type: 'mention', attrs: { id: 'ada', label: 'Stale Name' } },
        { type: 'text', text: ' about a < b' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
      ],
    },
  ],
}

function copy(editor: Editor): string {
  const { from, to } = editor.state.selection
  const slice = editor.state.doc.slice(from, to)
  return editor.view.someProp('clipboardTextSerializer', (f) => f(slice, editor.view)) ?? ''
}

test('copying the whole document yields portable markdown with the live mention name', () => {
  const editor = createEditor(COPY_SOURCE)
  editor.commands.selectAll()

  expect(copy(editor)).toBe('## Plan\n\nping @Ada Lovelace about a < b\n\n- one')
})

test('copying a partial selection serialises only what was selected', () => {
  const editor = createEditor(COPY_SOURCE)
  // Inside the mention-carrying paragraph only, starting two characters in: a partial selection is
  // a fragment of INLINE nodes rather than a document, which is the case the serialiser wraps.
  let from = 0
  let to = 0
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph' && to === 0) {
      from = offset + 3
      to = offset + 1 + node.content.size
    }
  })
  editor.commands.setTextSelection({ from, to })

  const markdown = copy(editor)
  expect(markdown).toBe('ng @Ada Lovelace about a < b')
  expect(markdown).not.toContain('Plan')
  expect(markdown).not.toContain('- one')
})

// ── 5.3 Paste: one conversion, four refusals ────────────────────────────────────────────────────

const MARKDOWN = '## Title\n\n- one\n- two'

test('plain-text markdown pastes as rich text', () => {
  const editor = createEditor()

  expect(paste(editor, { 'text/plain': MARKDOWN })).toBe(true)
  expect(blocks(editor)).toEqual([
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Title' }] },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
        },
      ],
    },
  ])
})

test('refusal 1: an HTML flavour is present, so ProseMirror keeps the paste', () => {
  const editor = createEditor()

  expect(paste(editor, { 'text/plain': MARKDOWN, 'text/html': '<h2>Title</h2>' })).toBe(false)
  // Declined, and nothing was inserted behind ProseMirror's back.
  expect(blocks(editor)).toEqual([{ type: 'paragraph' }])
})

test('refusal 2: the caret is in a code block, so the characters are the content', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{ type: 'codeBlock', attrs: { language: null } }],
  })
  editor.commands.setTextSelection(1)

  expect(paste(editor, { 'text/plain': MARKDOWN })).toBe(false)
  expect(blocks(editor)).toEqual([{ type: 'codeBlock', attrs: { language: null } }])
})

test('refusal 2b: the caret carries a code mark', () => {
  const editor = createEditor({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'x', marks: [{ type: 'code' }] }],
      },
    ],
  })
  editor.commands.setTextSelection(2)

  expect(paste(editor, { 'text/plain': MARKDOWN })).toBe(false)
})

test('refusal 3: the conversion changes nothing, so the plain path keeps its cursor and undo', () => {
  const editor = createEditor()

  expect(paste(editor, { 'text/plain': 'just a sentence' })).toBe(false)
  expect(blocks(editor)).toEqual([{ type: 'paragraph' }])
})

test('refusal 4: a bare URL over a selection is left to the link extension', () => {
  // `@tiptap/extension-link`'s `linkOnPaste` wraps a non-empty selection in a link from one bare
  // URL — and `someProp` reaches `editorProps` before any plugin, so converting here would REPLACE
  // the selected words with the URL text. `marked` autolinks a bare URL, so "the conversion changes
  // nothing" does not catch this on its own.
  const editor = createEditor({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the docs' }] }],
  })
  editor.commands.selectAll()

  expect(paste(editor, { 'text/plain': 'https://yapm.dev' })).toBe(false)

  // Declining is only half of it: the link extension's own `handlePaste` runs next in the same
  // `someProp` walk, and the selected words come back carrying the URL instead of being replaced
  // by it. That hand-off is what the refusal exists to protect.
  expect(pasteThroughEditor(editor, { 'text/plain': 'https://yapm.dev' })).toBe(true)
  expect(blocks(editor)).toEqual([
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'the docs',
          marks: [{ type: 'link', attrs: expect.objectContaining({ href: 'https://yapm.dev' }) }],
        },
      ],
    },
  ])
})

test('markdown over a selection still converts — only the unbroken-run case is refused', () => {
  const editor = createEditor({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the docs' }] }],
  })
  editor.commands.selectAll()

  expect(paste(editor, { 'text/plain': '**bold**' })).toBe(true)
  expect(blocks(editor)).toEqual([
    { type: 'paragraph', content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }] },
  ])
})

test('an empty clipboard and a clipboard with no plain text are both declined', () => {
  const editor = createEditor()

  expect(paste(editor, { 'text/plain': '   ' })).toBe(false)
  expect(paste(editor, {})).toBe(false)
})

// ── 5.4 One paste, one undo ─────────────────────────────────────────────────────────────────────

test('one undo restores the pre-paste document', () => {
  const before: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft' }] }],
  }
  const editor = createEditor(before)
  editor.commands.setTextSelection(editor.state.doc.content.size)

  expect(paste(editor, { 'text/plain': MARKDOWN })).toBe(true)
  expect(blocks(editor).length).toBeGreaterThan(1)

  expect(editor.commands.undo()).toBe(true)
  expect(editor.getJSON()).toEqual(before)
})
