// @vitest-environment jsdom

import { Editor, type JSONContent } from '@tiptap/react'
import {
  createRichTextExtensions,
  createSlashController,
  handleRichTextKeyDown,
  type SlashPopupState,
} from '@yapm/ui/components/rich-text'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// The three jsdom gaps `editor-markdown` recorded. `prosemirror-view` measures the selection on
// every transaction that scrolls it into view, and jsdom implements none of them.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

interface Harness {
  editor: Editor
  /** What the popup would be rendering, exactly as `RichTextEditorSurface` holds it. */
  state: () => SlashPopupState | null
  /** The last native event a popup inside the editor acted on; the wrapper's stand-down signal. */
  consumed: () => KeyboardEvent | null
  pickImage: ReturnType<typeof vi.fn>
}

function harness(options: { content?: JSONContent; canUpload?: boolean } = {}): Harness {
  let popup: SlashPopupState | null = null
  let consumed: KeyboardEvent | null = null
  const pickImage = vi.fn()

  const controller = createSlashController({
    containerSelector: '#harness',
    // No element: `onStart` skips `props.mount`, so floating-ui never runs. The popup's DOM is
    // `SlashList`'s business and is covered by its own render; what is under test here is the
    // controller's contract with ProseMirror.
    element: null,
    read: () => popup,
    write: (next) => {
      popup = next
    },
    consume: (event) => {
      consumed = event
    },
    context: () => ({ canUpload: options.canUpload ?? true, pickImage }),
  })

  const element = document.createElement('div')
  element.id = 'harness'
  document.body.append(element)
  const editor = new Editor({
    element,
    extensions: createRichTextExtensions({ slashSuggestion: controller.suggestion }),
    content: options.content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  editors.push(editor)

  return { editor, state: () => popup, consumed: () => consumed, pickImage }
}

/**
 * Types one character at a time exactly as `prosemirror-view`'s DOM observer does — through
 * `handleTextInput` — so the suggestion plugin sees the same transactions it sees in a browser.
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

function press(editor: Editor, key: string): { event: KeyboardEvent; handled: boolean } {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  const handled = editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) === true
  return { event, handled }
}

/**
 * The suggestion plugin fetches `items()` through an async request manager even when the callback
 * is synchronous, so the first `onStart` always publishes an empty list and the real one lands a
 * microtask later. Every assertion about what the menu is OFFERING has to wait for it.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function titles(state: SlashPopupState | null): string[] {
  return (state?.items ?? []).map((item) => item.command.title)
}

describe('the insert menu opens only where a block insert is legal', () => {
  it('opens on `/` at the start of an empty paragraph', async () => {
    const { editor, state } = harness()
    type(editor, '/')
    await tick()
    expect(state()).not.toBeNull()
    expect(titles(state())).toContain('Table')
  })

  it('opens after a space, and filters as the query is typed', async () => {
    const { editor, state } = harness()
    type(editor, 'see /tab')
    await tick()
    expect(titles(state())).toEqual(['Table'])
  })

  it('does not open mid-word', async () => {
    const { editor, state } = harness()
    type(editor, 'and/or')
    await tick()
    expect(state()).toBeNull()
  })

  it('does not open inside a code block', async () => {
    const { editor, state } = harness({
      content: { type: 'doc', content: [{ type: 'codeBlock', content: [] }] },
    })
    type(editor, '/')
    await tick()
    expect(state()).toBeNull()
  })

  it('does not open inside an inline code mark', async () => {
    const { editor, state } = harness()
    editor.commands.setMark('code')
    type(editor, '/')
    await tick()
    expect(state()).toBeNull()
  })
})

describe('the insert menu is keyboard-operable', () => {
  it('moves the active option with the arrow keys and wraps', async () => {
    const { editor, state } = harness()
    type(editor, '/')
    await tick()
    const count = state()?.items.length ?? 0
    expect(count).toBeGreaterThan(1)

    expect(press(editor, 'ArrowDown').handled).toBe(true)
    expect(state()?.activeIndex).toBe(1)
    expect(press(editor, 'ArrowUp').handled).toBe(true)
    expect(state()?.activeIndex).toBe(0)
    expect(press(editor, 'ArrowUp').handled).toBe(true)
    expect(state()?.activeIndex).toBe(count - 1)
    expect(press(editor, 'Home').handled).toBe(true)
    expect(state()?.activeIndex).toBe(0)
  })

  it('inserts on Enter in ONE transaction, and one undo reverses it', async () => {
    const { editor, state } = harness()
    type(editor, '/table')
    await tick()
    expect(titles(state())).toEqual(['Table'])

    let transactions = 0
    const count = () => {
      transactions += 1
    }
    editor.on('transaction', count)
    expect(press(editor, 'Enter').handled).toBe(true)
    editor.off('transaction', count)

    expect(transactions).toBe(1)
    expect(editor.getJSON().content?.some((node) => node.type === 'table')).toBe(true)
    // The trigger text went with it: no `/table` is left sitting above the table.
    expect(editor.getText()).not.toContain('/table')

    editor.commands.undo()
    expect(editor.getJSON().content?.some((node) => node.type === 'table')).toBe(false)
  })

  it('does not insert a disabled command, and keeps the menu open so the reason stays on screen', async () => {
    const { editor, state, pickImage } = harness({ canUpload: false })
    type(editor, '/image')
    await tick()
    expect(state()?.items).toEqual([expect.objectContaining({ disabled: true })])

    const before = editor.getJSON()
    expect(press(editor, 'Enter').handled).toBe(true)
    expect(editor.getJSON()).toEqual(before)
    expect(pickImage).not.toHaveBeenCalled()
    expect(state()).not.toBeNull()
  })

  it('disables Table inside a table rather than offering a nested one', async () => {
    const { editor, state } = harness()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    type(editor, '/table')
    await tick()
    expect(state()?.items[0]?.disabled).toBe(true)
  })

  // The spec's "exposed twice" scenario: the structure commands are reachable from the toolbar AND
  // from the insert menu, and the scenario is written under "the caret is inside a table" — which
  // is also the only place they mean anything.
  const STRUCTURE = ['Add row below', 'Delete row', 'Add column after', 'Delete column']

  it('offers the table structure commands inside a table', async () => {
    const { editor, state } = harness()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    type(editor, '/')
    await tick()
    expect(titles(state())).toEqual(expect.arrayContaining([...STRUCTURE, 'Delete table']))
    expect(state()?.items.filter((item) => STRUCTURE.includes(item.command.title))).toEqual(
      STRUCTURE.map(() => expect.objectContaining({ disabled: false })),
    )
  })

  it('lists none of them outside a table, where there is nothing for them to act on', async () => {
    const { editor, state } = harness()
    type(editor, '/')
    await tick()
    const offered = titles(state())
    for (const title of [...STRUCTURE, 'Delete table']) expect(offered).not.toContain(title)
    expect(offered).toContain('Table')
  })

  it('inserts a row from the menu, taking the trigger text with it', async () => {
    const { editor, state } = harness()
    editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: true })
    const rowsIn = (): number =>
      (editor.getJSON().content ?? []).flatMap((node) =>
        node.type === 'table' ? (node.content ?? []) : [],
      ).length
    const before = rowsIn()

    type(editor, '/add')
    await tick()
    expect(titles(state())[0]).toBe('Add row below')
    expect(press(editor, 'Enter').handled).toBe(true)

    expect(rowsIn()).toBe(before + 1)
    expect(editor.getText()).not.toContain('/add')
  })
})

// THE REGRESSION THIS CHANGE IS MOST LIKELY TO CAUSE. The wrapper stands down on the IDENTITY of
// the native event a popup handled, NOT on `event.defaultPrevented`: `prosemirror-view`'s
// `captureKeyDown` calls `preventDefault()` on every Escape and every Enter whether or not anything
// handled them, so a guard on that flag is always taken and silently disables `onCancel` and
// `onSubmit` on every editor in the app. Falsify by deleting `host.consume(event)` from
// `createSlashController`'s `onKeyDown`.
describe('Escape dismisses only the menu', () => {
  function wrapper(
    harnessed: Harness,
    event: KeyboardEvent,
    handlers: {
      onSubmit?: () => void
      onCancel?: () => void
    },
  ): void {
    handleRichTextKeyDown(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        consumed: harnessed.consumed() === event,
        preventDefault: () => undefined,
        stopPropagation: () => undefined,
      },
      handlers,
    )
  }

  it('closes the menu, leaves the draft alone, and never calls onCancel', async () => {
    const onCancel = vi.fn()
    const h = harness()
    type(h.editor, 'notes /')
    await tick()
    expect(h.state()).not.toBeNull()

    const { event, handled } = press(h.editor, 'Escape')
    expect(handled).toBe(true)
    wrapper(h, event, { onCancel })

    expect(h.state()).toBeNull()
    expect(onCancel).not.toHaveBeenCalled()
    expect(h.editor.getText()).toBe('notes /')
  })

  it('still calls onCancel when no popup is open', async () => {
    const onCancel = vi.fn()
    const h = harness()
    type(h.editor, 'notes')
    await tick()

    const { event } = press(h.editor, 'Escape')
    wrapper(h, event, { onCancel })

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('accepts a command on Enter without submitting the draft', async () => {
    const onSubmit = vi.fn()
    const h = harness()
    type(h.editor, '/quote')
    await tick()

    const { event, handled } = press(h.editor, 'Enter')
    expect(handled).toBe(true)
    wrapper(h, event, { onSubmit })

    expect(onSubmit).not.toHaveBeenCalled()
    expect(h.editor.isActive('blockquote')).toBe(true)
  })
})
