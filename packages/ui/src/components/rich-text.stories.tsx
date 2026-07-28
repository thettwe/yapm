import type { JSONContent } from '@tiptap/react'
import type { MentionCandidate } from '@yapm/ui/lib/mention-match'
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

const MENTIONABLES: MentionCandidate[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@yapm.dev', eligible: true },
  { id: 'bo', name: 'Bo Nguyen', email: 'bo@yapm.dev', eligible: true },
  { id: 'zoe', name: 'Zoë Chen', email: 'zoe@yapm.dev', eligible: true },
  { id: 'admin', name: 'Ravi Admin', email: 'ravi@yapm.dev', eligible: true, matchOnly: true },
  {
    id: 'casey',
    name: 'Casey Stone',
    email: 'casey@yapm.dev',
    eligible: false,
    reason: "Not on this team — can't be mentioned here",
  },
]

const MENTION_NAMES = new Map(MENTIONABLES.map((person) => [person.id, person.name]))

const mentioned: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Handing the reconnect loop to ' },
        { type: 'mention', attrs: { id: 'ada', label: 'Ada L.', mentionSuggestionChar: '@' } },
        { type: 'text', text: ' — ' },
        { type: 'mention', attrs: { id: 'gone', label: 'Former Colleague' } },
        { type: 'text', text: ' has left, so their name renders inert.' },
      ],
    },
  ],
}

export function WithMentions() {
  return (
    <PresetGrid>
      <RichTextEditor
        ariaLabel="Add a comment"
        placeholder="Type @ to mention a teammate…"
        minHeight="6rem"
        defaultValue={mentioned}
        mentionables={MENTIONABLES}
        mentionNames={MENTION_NAMES}
      />
    </PresetGrid>
  )
}

export function MentionsReadOnly() {
  return (
    <PresetGrid>
      <RichTextRenderer value={mentioned} mentionNames={MENTION_NAMES} />
    </PresetGrid>
  )
}

// A document naming a node type this bundle does not declare — what a tab left open across a deploy
// loads. TipTap has already pruned the unknown node by the time this renders, so the editor refuses
// to exist at all: one keystroke in an editable surface would autosave the pruned document over the
// real one, and LWW would make it the truth.
const skewed: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'The steps to reproduce are in the table below.' }],
    },
    {
      type: 'callout',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Gone.' }] }],
    },
  ],
}

export function BlockedBySchemaSkew() {
  return (
    <PresetGrid>
      <RichTextEditor ariaLabel="Description" defaultValue={skewed} minHeight="6rem" />
    </PresetGrid>
  )
}

export function BlockedBySchemaSkewReadOnly() {
  return (
    <PresetGrid>
      <RichTextRenderer value={skewed} />
    </PresetGrid>
  )
}

// Every surface the tokenized CSS added: table borders and header wash, the code block's surface
// and its `--code-*` syntax palette, and the image node's bordered placeholder. Rendered across all
// six presets, which is the only way to see that no hardcoded colour crept in — `highlight.js`
// ships ~250 theme stylesheets of hex and NONE of them is loaded.
const richContent: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Environment' }] }],
            },
            {
              type: 'tableHeader',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Reproduced' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'production' }] }],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'every time' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'typescript' },
      content: [
        {
          type: 'text',
          text: '// retries forever\nexport async function reconnect(socket: Socket): Promise<number> {\n  const attempts = 3\n  return socket.open() ? attempts : 0\n}',
        },
      ],
    },
    {
      type: 'image',
      attrs: {
        attachmentId: '019702c7-0000-7000-8000-000000000001',
        alt: 'The stalled sync badge',
      },
    },
  ],
}

export function TablesCodeAndImages() {
  return (
    <PresetGrid>
      <RichTextEditor ariaLabel="Description" defaultValue={richContent} minHeight="6rem" />
    </PresetGrid>
  )
}
