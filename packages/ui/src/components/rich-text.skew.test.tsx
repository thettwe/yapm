// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Editor, getSchema, type JSONContent } from '@tiptap/react'
import { detectRichTextSkew } from '@yapm/schema'
import {
  createRichTextExtensions,
  RichTextEditor,
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
  it('TipTap silently prunes an image and a table loaded into a bundle that lacks them', () => {
    const element = document.createElement('div')
    document.body.append(element)
    const editor = new Editor({
      element,
      extensions: previousBundleExtensions(),
      content: DOC_WITH_NEW_NODES,
    })
    editors.push(editor)

    const types = nodeTypesIn(editor.getJSON())
    expect(types).not.toContain('image')
    expect(types).not.toContain('table')
    // The surviving paragraph is what makes this a SILENT prune rather than a failed load: the
    // document still looks like a document, and one keystroke would autosave it over the real one.
    expect(types).toContain('paragraph')
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
