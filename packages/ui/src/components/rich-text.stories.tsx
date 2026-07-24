import type { JSONContent } from '@tiptap/react'
import { RichTextEditor, RichTextRenderer } from './rich-text'
import { PresetGrid } from './story-presets'

export default {
  title: 'Rich text',
}

const sample: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Reproduction' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Sync drops writes when the socket ' },
        { type: 'text', marks: [{ type: 'bold' }], text: 'reconnects' },
        { type: 'text', text: ' under load. Steps:' },
      ],
    },
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Open two tabs.' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kill the network.' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Expected: the queued write replays on reconnect.' }],
        },
      ],
    },
  ],
}

export function Editable() {
  return (
    <PresetGrid>
      <RichTextEditor ariaLabel="Description" defaultValue={sample} minHeight="6rem" />
    </PresetGrid>
  )
}

export function Empty() {
  return (
    <PresetGrid>
      <RichTextEditor ariaLabel="Description" placeholder="Add a description…" minHeight="6rem" />
    </PresetGrid>
  )
}

export function ReadOnly() {
  return (
    <PresetGrid>
      <RichTextRenderer value={sample} />
    </PresetGrid>
  )
}
