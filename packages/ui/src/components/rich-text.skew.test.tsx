// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor, getSchema, type JSONContent } from '@tiptap/react'
import { detectRichTextSkew } from '@yapm/schema'
import {
  createRichTextExtensions,
  RichTextEditor,
  RichTextRenderer,
  richTextKnownTypes,
} from '@yapm/ui/components/rich-text'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// `prosemirror-view` measures the selection on every transaction that scrolls it into view, and
// jsdom implements none of the three geometry methods it reaches for.
beforeAll(() => {
  Range.prototype.getClientRects = () =>
    Object.assign([] as unknown as DOMRect[], { item: () => null }) as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  Element.prototype.scrollIntoView = () => undefined
})

const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  cleanup()
})

// The node types this change introduces. Removing them from the extension set reconstructs the
// PREVIOUS BUNDLE — a tab that has been open across the deploy — which is the only way to
// demonstrate the hazard rather than assert it.
const NEW_NODE_TYPES = ['image', 'table', 'tableRow', 'tableHeader', 'tableCell']

function previousBundleExtensions() {
  return createRichTextExtensions().filter((extension) => !NEW_NODE_TYPES.includes(extension.name))
}

const DOC_WITH_NEW_NODES: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Repro:' }] },
    { type: 'image', attrs: { attachmentId: '019702c7-0000-7000-8000-000000000001', alt: 'shot' } },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Env' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'prod' }] }],
            },
          ],
        },
      ],
    },
  ],
}

// A type no bundle of yapm has ever declared, so no extension surgery is needed to make the editor
// component's own guard the thing under test.
const DOC_WITH_UNKNOWN_NODE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Keep me' }] },
    {
      type: 'callout',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'And me' }] }],
    },
  ],
}

function nodeTypesIn(doc: JSONContent): string[] {
  const found: string[] = []
  const walk = (node: JSONContent) => {
    if (typeof node.type === 'string') found.push(node.type)
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc)
  return found
}

describe('the hazard is real, not hypothetical', () => {
  it('TipTap discards the WHOLE document when it holds a node type this bundle lacks', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({
      element,
      extensions: previousBundleExtensions(),
      content: DOC_WITH_NEW_NODES,
    })
    editors.push(editor)

    // Not a prune. `Node.fromJSON` throws `Unknown node type: image`, TipTap logs a warning and
    // substitutes an EMPTY document — so the paragraph that had nothing wrong with it is gone too,
    // and one keystroke would autosave this over the real description. Pinned exactly, because a
    // future version quietly switching to a partial prune changes what the guard has to cover.
    expect(editor.getJSON()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] })
    expect(editor.getText()).not.toContain('Repro:')
    expect(nodeTypesIn(editor.getJSON())).not.toContain('image')
  })
})

describe('the detector fires', () => {
  it('reports the pruned document blocked against the previous bundle’s known types', () => {
    const schema = getSchema(previousBundleExtensions())
    const result = detectRichTextSkew(DOC_WITH_NEW_NODES, {
      knownNodeTypes: Object.keys(schema.nodes),
      knownMarkTypes: Object.keys(schema.marks),
    })

    expect(result).toMatchObject({ blocked: true, reason: 'unknown-types' })
    expect(result.blocked && [...result.unknownTypes].sort()).toEqual([
      'image',
      'table',
      'tableCell',
      'tableHeader',
      'tableRow',
    ])
  })

  it('passes the same document against THIS bundle, which declares all of it', () => {
    expect(detectRichTextSkew(DOC_WITH_NEW_NODES, richTextKnownTypes())).toEqual({ blocked: false })
  })
})

describe('the write is structurally refused', () => {
  it('renders the blocked state, exposes no editable region, and never fires onChange', () => {
    const onChange = vi.fn()
    const onSubmit = vi.fn()
    const { container } = render(
      <RichTextEditor
        ariaLabel="Description"
        defaultValue={DOC_WITH_UNKNOWN_NODE}
        onChange={onChange}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByTestId('rich-text-blocked')).toBeInTheDocument()
    // The banner sits over what CAN be shown, not over a blank box: TipTap would have thrown the
    // whole document away, so the unrepresentable node is dropped before the renderer sees it.
    expect(screen.getByText('Keep me')).toBeInTheDocument()
    // THE assertion that maps to the data loss: with no editable region there is no `onUpdate`, so
    // `issue-detail.tsx`'s 500ms debounce never reaches `mutators.issue.update`.
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()

    const reload = screen.getByRole('button', { name: 'Reload' })
    reload.focus()
    expect(document.activeElement).toBe(reload)

    const surface = container.querySelector('.tiptap')
    expect(surface).not.toBeNull()
    fireEvent.input(surface as Element, { data: 'x' })
    fireEvent.keyDown(surface as Element, { key: 'a' })
    fireEvent.keyDown(surface as Element, { key: 'Enter', metaKey: true })

    expect(onChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('says why, in a status region a screen reader announces', () => {
    render(<RichTextEditor ariaLabel="Description" defaultValue={DOC_WITH_UNKNOWN_NODE} />)
    expect(screen.getByRole('status')).toHaveTextContent(/newer version of yapm/i)
  })

  // The reader's half of the same requirement: a rendered document with content invisibly missing
  // is the failure one step downstream, and the renderer has no page to reload into a fix.
  it('tells a reader too, without offering a Reload they cannot act on', async () => {
    const { container } = render(<RichTextRenderer value={DOC_WITH_UNKNOWN_NODE} />)

    expect(screen.getByTestId('rich-text-blocked')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/newer version of yapm/i)
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
    expect(container.querySelector('[contenteditable="true"]')).toBeNull()
    expect(await screen.findByText('Keep me')).toBeInTheDocument()
  })

  it('round-trips this bundle’s own node types through the renderer', async () => {
    const { container } = render(<RichTextRenderer value={DOC_WITH_NEW_NODES} />)

    expect(screen.queryByTestId('rich-text-blocked')).toBeNull()
    expect(await screen.findByTestId('rich-text-image')).toBeInTheDocument()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.querySelector('th')?.textContent).toBe('Env')
  })

  it('leaves an ordinary document fully editable', () => {
    const onChange = vi.fn()
    const { container } = render(
      <RichTextEditor
        ariaLabel="Description"
        defaultValue={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
        }}
        onChange={onChange}
      />,
    )
    expect(screen.queryByTestId('rich-text-blocked')).toBeNull()
    expect(container.querySelector('[contenteditable="true"]')).not.toBeNull()
  })
})
