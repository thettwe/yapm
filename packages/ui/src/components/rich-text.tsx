import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import Image, { type ImageOptions } from '@tiptap/extension-image'
import Mention, { type MentionNodeAttrs } from '@tiptap/extension-mention'
import {
  renderTableToMarkdown,
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from '@tiptap/extension-table'
import { Node as ProseMirrorNode, Slice } from '@tiptap/pm/model'
import { PluginKey } from '@tiptap/pm/state'
import type { EditorProps } from '@tiptap/pm/view'
import {
  EditorContent,
  Extension,
  type Extensions,
  getSchema,
  type InputRule,
  type JSONContent,
  type MarkdownRendererHelpers,
  markInputRule,
  markPasteRule,
  mergeAttributes,
  ReactNodeViewRenderer,
  textblockTypeInputRule,
  useEditor,
  useEditorState,
} from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { exitSuggestion, type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import {
  detectRichTextSkew,
  IMAGE_NODE_TYPE,
  type RichTextSkew,
  type RichTextSkewKnownTypes,
} from '@yapm/schema'
import { Button } from '@yapm/ui/components/button'
import { CodeBlockNodeView } from '@yapm/ui/components/code-block-node'
import { type AttachmentSrcResolver, ImageNodeView } from '@yapm/ui/components/image-node'
import {
  MentionList,
  mentionAnnouncement,
  mentionOptionId,
  nextMentionIndex,
} from '@yapm/ui/components/mention-list'
import { lowlight, PLAIN_TEXT_LANGUAGE } from '@yapm/ui/lib/code-languages'
import { markdownToRichText, richTextToMarkdown } from '@yapm/ui/lib/markdown'
import { type MentionCandidate, matchMentions } from '@yapm/ui/lib/mention-match'
import { cn } from '@yapm/ui/lib/utils'
import {
  BoldIcon,
  CodeIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  StrikethroughIcon,
} from 'lucide-react'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'

export type RichTextValue = JSONContent

export type { AttachmentSrcResolver, MentionCandidate }

// `MentionPluginKey` is NOT exported by @tiptap/extension-mention 3.28 — it survives only in a
// JSDoc `@default`. Every editor instance gets its own EditorState, so one shared key object is
// safe; two plugins with this key in ONE state is what throws `RangeError: Adding different
// instances of a keyed plugin`, and the mention node contributes exactly one.
export const MENTION_PLUGIN_KEY = new PluginKey('yapm-mention')

/** Maps a mentioned user's id to their current display name, from live synced data. */
export type MentionNameLookup = ReadonlyMap<string, string>

// The stored `label` is a HINT, never the truth: nothing stops a crafted document pairing one
// person's id with another person's name, and a display name changes the moment somebody renames
// themselves. So the rendered name comes from the live lookup, and a mention whose id resolves to
// nobody — including every mention when no lookup was supplied at all — degrades to inert text
// rather than asserting a person who may not exist. Safe by default, not by opting in.
function mentionRenderAttrs(
  attrs: Record<string, unknown>,
  resolve: ((id: string) => string | undefined) | undefined,
): { label: string; resolved: boolean } {
  const id = typeof attrs.id === 'string' ? attrs.id : ''
  const stored = typeof attrs.label === 'string' ? attrs.label.trim() : ''
  const live = id === '' ? undefined : resolve?.(id)
  if (live !== undefined && live !== '') return { label: live, resolved: true }
  return { label: stored !== '' ? stored : id, resolved: false }
}

// Tinted wash plus weight rather than accent-coloured ink: `--accent-strong` over `--accent-soft`
// is sub-AA in three of the six presets (asserted in `styles/contrast.test.ts`), and a chip is
// normal-size text in the middle of prose.
const MENTION_CHIP_CLASS = 'rounded-pill bg-accent-soft px-1 py-px font-medium text-text-1'

// The suggestion plugin cannot be switched off: `addProseMirrorPlugins` always instantiates one,
// falling back to the singular `suggestion` option when `suggestions` is empty. So the read-only
// default ships a plugin that can never match.
const INERT_MENTION_SUGGESTION: Omit<
  SuggestionOptions<MentionCandidate, MentionNodeAttrs>,
  'editor'
> = {
  char: '@',
  pluginKey: MENTION_PLUGIN_KEY,
  items: () => [],
  allow: () => false,
}

// `[text](url)` typed, and the same pasted. Only ONE capture group, and it holds the link TEXT:
// `markInputRule`/`markPasteRule` keep `match[match.length - 1]` and delete the rest, so a capture
// group around the URL would make the URL the visible text.
const MARKDOWN_LINK_INPUT = /\[([^\]]+)]\((?:[^\s)]+)\)$/
const MARKDOWN_LINK_PASTE = /\[([^\]]+)]\((?:[^\s)]+)\)/g

function markdownLinkHref(match: string): string {
  return match.slice(match.lastIndexOf('](') + 2, -1)
}

// The two shortcuts the configured node set is missing, and nothing else — read the installed
// extensions before adding a third.
//
// StarterKit generates the heading input rules FROM the configured levels, so `heading.levels =
// [2, 3]` yields `/^(#{2,2})\s$/` and `/^(#{2,3})\s$/` and `# ` matches nothing. `# ` maps to
// level 2, the largest heading this design system styles.
//
// `@tiptap/extension-link` ships paste rules for bare URLs and autolink, and NO input rules at all.
const MarkdownShortcuts = Extension.create({
  name: 'markdownShortcuts',

  addInputRules() {
    const rules: InputRule[] = []
    const heading = this.editor.schema.nodes.heading
    if (heading) {
      rules.push(
        textblockTypeInputRule({ find: /^#\s$/, type: heading, getAttributes: { level: 2 } }),
      )
    }
    const link = this.editor.schema.marks.link
    if (link) {
      rules.push(
        markInputRule({
          find: MARKDOWN_LINK_INPUT,
          type: link,
          getAttributes: (match) => ({ href: markdownLinkHref(match[0]) }),
        }),
      )
    }
    return rules
  },

  addPasteRules() {
    const link = this.editor.schema.marks.link
    if (!link) return []
    return [
      markPasteRule({
        find: MARKDOWN_LINK_PASTE,
        type: link,
        getAttributes: (match) => ({ href: markdownLinkHref(match[0]) }),
      }),
    ]
  },
})

// CommonMark closes a fenced code block at the first fence AT LEAST as long as the one that opened
// it, so a block whose own text contains ``` has to open with a longer run — otherwise the fence
// closes early, the tail of the code becomes prose, and the block does not come back. 3.28.0's
// `codeBlock.renderMarkdown` hard-codes three backticks.
//
// `renderMarkdown` is a public `NodeConfig` field declared by `@tiptap/core` 3.28 itself
// (`reference/frontend-build.md` §11.6), so this is the supported seam rather than another private
// method. It MOVED here from `StarterKit.extend({ addExtensions })` when the code block became
// `CodeBlockLowlight`: it is the shipped fix for a block containing its own fence, and dropping it
// fails `editor-markdown`'s round-trip test.
function codeBlockToMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers): string {
  const declared = node.attrs?.language
  // `plaintext` emits a BARE fence: it is this editor's fallback for "no language", and a
  // ```plaintext fence pasted into GitHub is noise nobody wrote.
  const language = typeof declared === 'string' && declared !== PLAIN_TEXT_LANGUAGE ? declared : ''
  const body = node.content ? helpers.renderChildren(node.content) : ''
  const longestRun = [...body.matchAll(/`+/g)].reduce((max, run) => Math.max(max, run[0].length), 0)
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${language}\n${body}\n${fence}`
}

/**
 * The syntax-highlighted code block. StarterKit's own `codeBlock` is switched off so exactly one
 * code-block node type exists.
 *
 * `@tiptap/extension-code-block` is a DECLARED dependency of this package rather than something
 * inherited from StarterKit: `-code-block-lowlight` peer-requires it at exactly 3.28.0 and imports
 * it at runtime, and under pnpm's strict layout an undeclared peer resolves inside starter-kit's own
 * `node_modules`, duplicating `prosemirror-model` and throwing at RUNTIME after typecheck, lint and
 * `vite build` have all passed.
 */
const HighlightedCodeBlock = CodeBlockLowlight.configure({
  lowlight,
  // Without this the plugin calls `highlightAuto` on every unlabelled block, on every transaction:
  // a detection pass per keystroke, and colours nobody asked for in a block of prose.
  defaultLanguage: PLAIN_TEXT_LANGUAGE,
}).extend({
  renderMarkdown: codeBlockToMarkdown,
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockNodeView)
  },
})

// A `|` inside a cell ends the cell as far as every GFM reader is concerned. 3.28.0's
// `renderTableToMarkdown` escapes pipes only inside backtick code spans (`escapeTableCellPipes`),
// so `a | b` typed as prose in a cell silently becomes two columns.
//
// Walked pair by pair rather than replaced by regex: the text encoder has already escaped
// backslashes, so `\\` must stay a literal backslash and `\|` must not gain a second one.
function escapeCellPipes(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string
    if (char === '\\' && index + 1 < text.length) {
      out += char + (text[index + 1] as string)
      index += 1
      continue
    }
    out += char === '|' ? '\\|' : char
  }
  return out
}

const TABLE_MARKDOWN_OPTIONS = {
  // 3.28.0's default is U+001F, which `collapseWhitespace` does NOT match (`\s` does not cover it)
  // and which therefore reaches the clipboard as a literal control character. A cell holding two
  // paragraphs flattens to a space-joined line, which is all GFM can carry anyway.
  cellLineSeparator: ' ',
}

const PortableTable = Table.configure({
  // A column width is a SYNCED attribute and a drag handle is a pointer-only affordance. Column
  // widths are also the single most common source of LWW churn in every editor that has them.
  // Tables size to content.
  resizable: false,
}).extend({
  renderMarkdown: (node, helpers) =>
    renderTableToMarkdown(
      node,
      {
        ...helpers,
        renderChildren: (content) => escapeCellPipes(helpers.renderChildren(content)),
      },
      TABLE_MARKDOWN_OPTIONS,
    ),
})

/**
 * The image node, REDEFINED rather than configured.
 *
 * The stored node carries an opaque `attachmentId` and NO URL — not even a relative path. A document
 * syncs through Zero, so whatever string sits in a node replicates to every team member's IndexedDB
 * and persists as long as the document does: a URL there is a bearer capability at rest on every
 * client. `apps/server`'s storage seam has no `getUrl()` for the same reason, and the path is
 * computed at render time from a resolver the application supplies (`packages/ui` may not know the
 * API base — packages never import apps).
 *
 * 3.28.0's own node declares `src` / `title` / `width` / `height` and parses any `img[src]`. All of
 * that is replaced. `sanitizeRichText` enforces the same three attributes on the AUTHORITATIVE pass,
 * which is what makes "no URL is ever stored" true rather than merely intended.
 */
const AttachmentImage = Image.extend<
  ImageOptions & { resolveAttachmentSrc?: AttachmentSrcResolver }
>({
  name: IMAGE_NODE_TYPE,

  // Stated rather than spread from the parent, because three of these four are DEAD for this node
  // and saying so is the point: `allowBase64` feeds a `parseHTML` this node replaces, `resize` feeds
  // an `addNodeView` it replaces, and a resize handle is a pointer-only affordance writing a synced
  // attribute. `inline: false` is the one that still does something — it makes the node a block.
  addOptions() {
    return {
      inline: false,
      allowBase64: false,
      resize: false as const,
      HTMLAttributes: {},
      resolveAttachmentSrc: undefined,
    }
  },

  addAttributes() {
    return {
      attachmentId: { default: '' },
      alt: { default: '' },
      width: { default: 'full' },
    }
  },

  // Nothing a browser or another editor puts on the clipboard becomes an image node: an external
  // `<img src>` matches NO rule here, so it cannot mint a node at all, let alone one carrying a URL.
  //
  // The one rule that exists matches this node's OWN serialised form — `data-attachment-id` is an
  // attribute nothing outside yapm emits — because ProseMirror's internal copy/paste round-trips a
  // slice through `renderHTML` + `parseHTML`, and with no rule at all a yapm→yapm paste would drop
  // every image silently. That is the same class of loss the schema-skew guard exists to prevent,
  // so it is not one to accept here. The attribute is refused when it is empty or URL-shaped, and
  // `sanitizeRichText` refuses it again on the authoritative pass.
  parseHTML() {
    return [
      {
        tag: 'img[data-attachment-id]',
        getAttrs: (element) => {
          const id = (element as HTMLElement).getAttribute('data-attachment-id') ?? ''
          if (id === '' || IMAGE_URL_SHAPED.test(id)) return false
          return {
            attachmentId: id,
            alt: (element as HTMLElement).getAttribute('alt') ?? '',
            width: (element as HTMLElement).getAttribute('data-width') ?? 'full',
          }
        },
      },
    ]
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as { attachmentId?: string; alt?: string; width?: string }
    const attachmentId = attrs.attachmentId ?? ''
    const alt = attrs.alt ?? ''
    const shared = {
      'data-attachment-id': attachmentId,
      'data-width': attrs.width ?? 'full',
      alt,
    }
    const src =
      attachmentId === '' ? '' : (this.options.resolveAttachmentSrc?.(attachmentId, 'full') ?? '')
    // With no resolver there is no path this bundle can name, and an empty `src` makes a browser
    // re-request the current page. The alt text is what is left.
    if (src === '') return ['span', mergeAttributes(shared, { 'data-image-placeholder': '' }), alt]
    return ['img', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, shared, { src })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView)
  },

  // The path is put on `src` by `normalizeForMarkdown`'s pre-walk, for the same reason a mention's
  // display name is: the markdown manager is a module-level singleton built with no options, so a
  // per-call resolver cannot reach an extension's config. An image with no resolvable path never
  // gets here — the pre-walk degrades it to its alt text.
  renderMarkdown: (node) => {
    const attrs = (node.attrs ?? {}) as { alt?: unknown; src?: unknown }
    const alt = typeof attrs.alt === 'string' ? attrs.alt : ''
    const src = typeof attrs.src === 'string' ? attrs.src : ''
    return `![${alt}](${src})`
  },
})

const IMAGE_URL_SHAPED = /^\s*[a-z][a-z0-9+.-]*:|^\/\//i

export interface RichTextExtensionOptions {
  resolveMentionName?: ((id: string) => string | undefined) | undefined
  /**
   * Turns an opaque `attachmentId` into a path this deployment can serve. Supplied by `apps/web` as
   * `` (id, v) => `/api/v1/files/${id}${v === 'thumb' ? '/thumb' : ''}` ``. Omitted — Storybook, unit
   * tests — an image renders its alt text in a bordered placeholder.
   */
  resolveAttachmentSrc?: AttachmentSrcResolver | undefined
  mentionSuggestion?: Omit<SuggestionOptions<MentionCandidate, MentionNodeAttrs>, 'editor'>
}

/**
 * One extension set for both the editable editor and the read-only renderer, so a document
 * round-tripping through the renderer never loses a mention node.
 */
export function createRichTextExtensions(options: RichTextExtensionOptions = {}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      // Replaced by `HighlightedCodeBlock`, so exactly one code-block node type exists. `Gapcursor`
      // stays on — verified present in this StarterKit's `addExtensions`, and it is what lets the
      // arrow keys leave a table at its top and bottom edges.
      codeBlock: false,
    }),
    HighlightedCodeBlock,
    AttachmentImage.configure({ resolveAttachmentSrc: options.resolveAttachmentSrc }),
    PortableTable,
    TableRow,
    TableHeader,
    TableCell,
    Mention.configure({
      // Array-shaped with exactly one entry: `@` addressing one person is all that ships, but a
      // second trigger is an added element rather than a signature change.
      suggestions: [options.mentionSuggestion ?? INERT_MENTION_SUGGESTION],
      // `renderText`/`renderHTML`, never the deprecated `renderLabel`.
      renderText: ({ node }) =>
        `@${mentionRenderAttrs(node.attrs, options.resolveMentionName).label}`,
      renderHTML: ({ options: merged, node }) => {
        const mention = mentionRenderAttrs(node.attrs, options.resolveMentionName)
        const text = `@${mention.label}`
        if (!mention.resolved) return ['span', { 'data-type': 'mention' }, text]
        return [
          'span',
          mergeAttributes(merged.HTMLAttributes, {
            class: MENTION_CHIP_CLASS,
            'aria-label': `Mention: ${mention.label}`,
          }),
          text,
        ]
      },
    }),
    MarkdownShortcuts,
  ]
}

export const richTextExtensions: Extensions = createRichTextExtensions()

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

let knownTypes: RichTextSkewKnownTypes | undefined

/**
 * The node and mark names THIS BUNDLE declares, derived from the compiled schema and never listed by
 * hand: a node added to the extension set is covered the day it is added rather than the day
 * somebody remembers. Built once, lazily — `getSchema` resolves the whole extension set.
 */
export function richTextKnownTypes(): RichTextSkewKnownTypes {
  if (knownTypes === undefined) {
    const schema = getSchema(createRichTextExtensions())
    knownTypes = {
      knownNodeTypes: new Set(Object.keys(schema.nodes)),
      knownMarkTypes: new Set(Object.keys(schema.marks)),
    }
  }
  return knownTypes
}

export function richTextSkew(value: JSONContent | null | undefined): RichTextSkew {
  if (!value) return { blocked: false }
  return detectRichTextSkew(value, richTextKnownTypes())
}

function collectText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  return (node.content ?? []).map(collectText).join('')
}

function hasStructuralLeaf(node: JSONContent): boolean {
  if (node.type === 'horizontalRule' || node.type === IMAGE_NODE_TYPE) return true
  // A table holding nothing but empty cells is still a table somebody inserted deliberately, so a
  // description that contains only one is not an empty description.
  if (node.type === 'table') return true
  return (node.content ?? []).some(hasStructuralLeaf)
}

export function isRichTextEmpty(value: JSONContent | null | undefined): boolean {
  if (!value) return true
  const nodes = value.content ?? []
  if (nodes.length === 0) return true
  if (nodes.map(collectText).join('').trim().length > 0) return false
  return !nodes.some(hasStructuralLeaf)
}

/**
 * The `text/plain` clipboard flavour for a copied selection. `clipboardSerializer` — the
 * `text/html` flavour carrying `data-pm-slice` — is deliberately untouched: it is already lossless
 * for a yapm→yapm paste, and markdown is only what the text becomes when it leaves the building.
 */
export function richTextSliceToMarkdown(
  slice: Slice,
  resolveMentionName?: ((id: string) => string | undefined) | undefined,
  resolveAttachmentSrc?: AttachmentSrcResolver | undefined,
): string {
  const nodes = (slice.content.toJSON() ?? []) as JSONContent[]
  if (nodes.length === 0) return ''
  // A partial selection inside one paragraph is a fragment of INLINE nodes, which is not a document.
  const content =
    slice.content.firstChild?.isInline === true ? [{ type: 'paragraph', content: nodes }] : nodes
  return richTextToMarkdown({ type: 'doc', content }, { resolveMentionName, resolveAttachmentSrc })
}

function plainTextLines(content: readonly JSONContent[]): string[] | null {
  const lines: string[] = []
  for (const block of content) {
    if (block.type !== 'paragraph') return null
    const children = block.content ?? []
    if (children.some((child) => child.type !== 'text' || (child.marks?.length ?? 0) > 0)) {
      return null
    }
    lines.push(children.map((child) => child.text ?? '').join(''))
  }
  return lines
}

// The conversion contributes nothing ProseMirror's own plain-text path would not, so the plain path
// keeps its cursor placement and its undo entry.
function isPlainTextEquivalent(content: readonly JSONContent[], text: string): boolean {
  const lines = plainTextLines(content)
  return lines !== null && lines.join('\n\n') === text.trim()
}

// `@tiptap/extension-link`'s `linkOnPaste` wraps a NON-EMPTY selection in a link when the clipboard
// holds one bare URL — and `EditorView.someProp` consults `editorProps` before any plugin, so a
// markdown handler that converted here would replace the selected text instead of linking it.
// A conversion whose whole output is the pasted text as one unbroken run is exactly that case.
function isSingleTextRun(content: readonly JSONContent[], text: string): boolean {
  if (content.length !== 1) return false
  const children = content[0]?.type === 'paragraph' ? (content[0].content ?? []) : []
  const only = children.length === 1 ? children[0] : undefined
  return only?.type === 'text' && only.text === text.trim()
}

/**
 * The read-only renderer's `editorProps`. Copying out of a NON-EDITABLE view is not an edge case —
 * it is every comment and every description a member without write access can see — so the
 * serialiser belongs here as much as it does on the editor. `handlePaste` deliberately does not:
 * there is nothing to paste into.
 */
export function richTextRendererProps(
  resolveMentionName?: ((id: string) => string | undefined) | undefined,
  resolveAttachmentSrc?: AttachmentSrcResolver | undefined,
): EditorProps {
  return {
    attributes: { class: 'tiptap' },
    clipboardTextSerializer: (slice) =>
      richTextSliceToMarkdown(slice, resolveMentionName, resolveAttachmentSrc),
  }
}

/**
 * Both clipboard behaviours as one object, so the editor's real markdown wiring is reachable from a
 * test that drives a ProseMirror view directly. jsdom implements neither `ClipboardEvent` nor
 * `DataTransfer`, so a test that went through `RichTextEditor`'s React tree could only ever assert
 * against a stand-in clipboard anyway; this way the function under test is the one that ships.
 */
export function richTextClipboardProps(
  resolveMentionName?: ((id: string) => string | undefined) | undefined,
  resolveAttachmentSrc?: AttachmentSrcResolver | undefined,
): Pick<EditorProps, 'clipboardTextSerializer' | 'handlePaste'> {
  return {
    clipboardTextSerializer: (slice) =>
      richTextSliceToMarkdown(slice, resolveMentionName, resolveAttachmentSrc),
    handlePaste: (view, event) => {
      const clipboard = event.clipboardData
      if (clipboard === null) return false
      // A yapm→yapm paste carries `data-pm-slice`; a paste from a browser or another editor
      // carries real HTML. Either way ProseMirror's HTML path beats a markdown round trip.
      if (Array.from(clipboard.types).includes('text/html')) return false

      const text = clipboard.getData('text/plain')
      if (text.trim() === '') return false

      // Pasting a markdown snippet into a code block must insert the characters — that is what a
      // code block is for.
      const { doc, schema, selection } = view.state
      const { $from } = selection
      if ($from.parent.type.spec.code === true) return false
      const code = schema.marks.code
      if (
        code &&
        (code.isInSet($from.marks()) !== undefined ||
          doc.rangeHasMark(selection.from, selection.to, code))
      ) {
        return false
      }

      try {
        const content = markdownToRichText(text).content ?? []
        if (content.length === 0) return false
        if (isPlainTextEquivalent(content, text)) return false
        if (!selection.empty && isSingleTextRun(content, text)) return false

        const parsed = ProseMirrorNode.fromJSON(schema, { type: 'doc', content })
        // ONE transaction, so one Cmd+Z restores the pre-paste document.
        view.dispatch(
          view.state.tr.replaceSelection(Slice.maxOpen(parsed.content)).scrollIntoView(),
        )
        return true
      } catch {
        // The clipboard is arbitrary user input and `Node.fromJSON` throws on anything the schema
        // will not hold. Falling through to ProseMirror's own paste is always safe.
        return false
      }
    },
  }
}

const contentClass = cn(
  'font-ui text-[13.5px] leading-relaxed text-text-1',
  '[&_.tiptap]:outline-none [&_.tiptap]:min-h-[inherit]',
  '[&_p]:my-2 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0',
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-text-1',
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:font-heading [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-tight [&_h3]:text-text-1',
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:my-0',
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-2',
  '[&_code]:rounded [&_code]:bg-bg-hover [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em] [&_code]:text-text-1',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-bg-hover [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_pre]:text-text-1',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-accent-strong [&_a]:underline [&_a]:underline-offset-2',
  '[&_strong]:font-semibold [&_hr]:my-4 [&_hr]:border-border',
)

export interface RichTextKeyEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  /**
   * Whether a surface INSIDE this editor already acted on this exact keystroke — today, the mention
   * typeahead.
   *
   * NOT `event.defaultPrevented`, and that distinction is the whole point.
   * `prosemirror-view`'s `captureKeyDown` returns true for keyCode 13 and 27 unconditionally
   * (`prosemirror-view@1.42`, "Enter, Esc"), so the view calls `preventDefault()` on EVERY Enter
   * and EVERY Escape whether or not an extension handled them. A guard built on that flag is
   * therefore always taken, and silently disables both callbacks on every editor in the app.
   * Verified in a real browser; it is invisible to jsdom and to typecheck alike.
   */
  consumed: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

// ProseMirror does not stop React's synthetic bubbling for a key one of its own plugins handled, so
// a keystroke the mention typeahead consumed still reaches this wrapper — and, above it, whatever
// dialog the editor happens to live in. Two effects from one keystroke, the second of them
// destructive: Escape dismisses the popup AND discards the draft, Cmd+Enter accepts the highlighted
// name AND posts the half-written comment.
//
// Base UI's dismissal (`useDismiss`, @base-ui/react 1.6) is the second half of the same problem: it
// closes a Dialog from handlers that check neither `defaultPrevented` nor the event's origin, so
// merely declining to act is not enough — the event has to be stopped.
//
// One rule, both directions: A KEY THIS EDITOR CONSUMED, OR THAT SOMETHING INSIDE IT CONSUMED,
// STOPS HERE. A key nobody consumed keeps bubbling untouched, which is what leaves Cmd+K and every
// other shortcut above this surface working.
export function handleRichTextKeyDown(
  event: RichTextKeyEvent,
  handlers: { onSubmit?: (() => void) | undefined; onCancel?: (() => void) | undefined },
): void {
  if (event.consumed) {
    event.stopPropagation()
    return
  }

  if (handlers.onSubmit && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    event.stopPropagation()
    handlers.onSubmit()
    return
  }
  if (handlers.onCancel && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    handlers.onCancel()
  }
}

interface MentionPopupState {
  items: MentionCandidate[]
  query: string
  activeIndex: number
  rejectedCount: number
  loading: boolean
}

interface MentionHost {
  candidates: () => readonly MentionCandidate[] | undefined
  containerSelector: string
  element: HTMLElement | null
  read: () => MentionPopupState | null
  write: (next: MentionPopupState | null) => void
  // Records the exact native event the typeahead just acted on. Identity rather than a boolean
  // flag, and not a "is the popup open" check: Escape tears the popup down synchronously inside
  // ProseMirror's own handler, so by the time React dispatches the same event to the wrapper the
  // popup is already gone and any state-derived answer would be "nothing was open".
  consume: (event: KeyboardEvent) => void
}

interface MentionController {
  suggestion: Omit<SuggestionOptions<MentionCandidate, MentionNodeAttrs>, 'editor'>
  accept: (index: number) => boolean
  setActive: (index: number) => void
}

function createMentionController(host: MentionHost): MentionController {
  let latest: SuggestionProps<MentionCandidate, MentionNodeAttrs> | null = null
  let unmount: (() => void) | null = null

  function publish(props: SuggestionProps<MentionCandidate, MentionNodeAttrs>): void {
    latest = props
    const previous = host.read()
    const keepIndex =
      previous !== null &&
      previous.query === props.query &&
      previous.activeIndex < props.items.length
    host.write({
      items: props.items,
      query: props.query,
      activeIndex: keepIndex ? previous.activeIndex : 0,
      rejectedCount: 0,
      loading: props.loading,
    })
  }

  function accept(index: number): boolean {
    const state = host.read()
    if (state === null) return false
    const item = state.items[index]
    if (item === undefined) return false
    if (!item.eligible) {
      // Reachable, announced, and inert. Swallowing the key keeps the popup open so the reason
      // stays on screen rather than the draft gaining a stray newline.
      host.write({ ...state, activeIndex: index, rejectedCount: state.rejectedCount + 1 })
      return true
    }
    latest?.command({ id: item.id, label: item.name })
    return true
  }

  function setActive(index: number): void {
    const state = host.read()
    if (state === null || index === state.activeIndex) return
    host.write({ ...state, activeIndex: index, rejectedCount: 0 })
  }

  return {
    accept,
    setActive,
    suggestion: {
      char: '@',
      pluginKey: MENTION_PLUGIN_KEY,
      // Stated rather than inherited from the default: the allowed prefix set is exactly what
      // keeps `someone@example.com` typed in prose from opening the popup mid-word.
      allowedPrefixes: [' ', '('],
      // Mounted INSIDE the editor's own wrapper, not portalled to the body. Load-bearing twice
      // over: it keeps a `[role="listbox"]` in the application's popup-ownership ancestor chain,
      // and it makes `aria-activedescendant` a legal same-subtree IDREF. A body portal breaks both
      // and looks perfect to a sighted developer.
      container: host.containerSelector,
      placement: 'bottom-start',
      allow: ({ state, range }) => {
        if (host.candidates() === undefined) return false
        const type = state.schema.nodes.mention
        if (!type) return false
        const $from = state.doc.resolve(range.from)
        if (!$from.parent.type.contentMatch.matchType(type)) return false
        if ($from.parent.type.spec.code === true) return false
        const code = state.schema.marks.code
        if (
          code &&
          (code.isInSet($from.marks()) !== undefined ||
            state.doc.rangeHasMark(range.from, range.to, code))
        ) {
          return false
        }
        return true
      },
      // An ARRAY, never a promise. This is the whole sub-100ms story: the rows are already
      // replicated to IndexedDB, so a keystroke filters memory rather than waiting on a network.
      items: ({ query }) => matchMentions(host.candidates() ?? [], query),
      render: () => ({
        onStart: (props) => {
          if (host.element !== null) unmount = props.mount(host.element)
          publish(props)
        },
        onUpdate: (props) => publish(props),
        onExit: () => {
          unmount?.()
          unmount = null
          latest = null
          host.write(null)
        },
        onKeyDown: ({ view, event }) => {
          // Escape dismisses the POPUP AND NOTHING ELSE. Every `true` returned here is also
          // recorded against this exact event, which is what the wrapper reads to stand down —
          // without it, dismissing the list also discards the whole draft and the panel holding it.
          const handled = ((): boolean => {
            if (event.key === 'Escape' || event.key === 'Esc') {
              exitSuggestion(view, MENTION_PLUGIN_KEY)
              return true
            }
            const state = host.read()
            if (state === null) return false

            const moved = nextMentionIndex(event.key, state.activeIndex, state.items.length)
            if (moved !== null) {
              host.write({ ...state, activeIndex: moved, rejectedCount: 0 })
              return true
            }
            // Cmd/Ctrl+Enter lands here too, so the submit shortcut accepts the option instead of
            // posting a half-written comment.
            if (event.key === 'Enter' || event.key === 'Tab') return accept(state.activeIndex)
            return false
          })()

          if (handled) host.consume(event)
          return handled
        },
      }),
    },
  }
}

export interface RichTextEditorProps {
  defaultValue?: JSONContent | null
  editable?: boolean
  placeholder?: string
  ariaLabel: string
  autoFocus?: boolean
  minHeight?: string
  showToolbar?: boolean
  className?: string
  /**
   * The people the `@` typeahead may offer. Data-agnostic by design: this component knows nothing
   * about teams, queries or permissions, so the application decides who is eligible and why not.
   * Omitted entirely, the popup never opens.
   */
  mentionables?: readonly MentionCandidate[]
  mentionNames?: MentionNameLookup
  /** See `RichTextExtensionOptions.resolveAttachmentSrc`. */
  resolveAttachmentSrc?: AttachmentSrcResolver
  onChange?: (doc: JSONContent) => void
  onSubmit?: (doc: JSONContent) => void
  onCancel?: () => void
}

const SKEW_NOTICE =
  'This was edited in a newer version of yapm. Reload the page to see and edit all of it.'

/**
 * The refusal, and it is STRUCTURAL rather than a flag checked in a handler.
 *
 * A document holding node types this bundle does not declare has already been pruned by the time
 * TipTap parses it, and one keystroke would autosave the pruned version over the real one — LWW
 * makes it the truth, nothing errors, nothing is logged, and no review catches content that
 * disappeared in somebody's browser two weeks earlier. So there is no editor instance in this
 * branch at all: `onChange` and `onSubmit` cannot fire because nothing is wired to them.
 *
 * ⚠️ A tab running the build BEFORE this guard shipped has none of this code and will still prune.
 * That window is one deploy wide and cannot be closed from inside the change that introduces the
 * guard. It is stated in the docs page for the same reason it is stated here.
 */
function RichTextBlocked({
  value,
  mentionNames,
  resolveAttachmentSrc,
  className,
  minHeight,
  onCancel,
  showReload,
}: {
  value: JSONContent | null | undefined
  mentionNames?: MentionNameLookup
  resolveAttachmentSrc?: AttachmentSrcResolver
  className?: string
  minHeight?: string
  onCancel?: (() => void) | undefined
  showReload: boolean
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape still dismisses the surface holding this
    <div
      data-testid="rich-text-blocked"
      className={cn('rounded-control border border-border bg-bg', className)}
      onKeyDown={(event) => {
        if (onCancel && event.key === 'Escape') {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      <div
        role="status"
        className="flex flex-wrap items-center gap-2 border-border border-b bg-bg-hover px-3 py-2 font-ui text-[13px] text-text-2"
      >
        <span>{SKEW_NOTICE}</span>
        {showReload ? (
          <Button
            type="button"
            variant="secondary"
            size="xs"
            onClick={() => {
              if (typeof location !== 'undefined') location.reload()
            }}
          >
            Reload
          </Button>
        ) : null}
      </div>
      <div className="px-3 py-2" style={minHeight === undefined ? undefined : { minHeight }}>
        <RichTextRendererSurface
          value={value}
          mentionNames={mentionNames}
          resolveAttachmentSrc={resolveAttachmentSrc}
        />
      </div>
    </div>
  )
}

/**
 * Runs the skew detector BEFORE an editor exists, and hands off to one of two components that share
 * no state. The hook order above the branch is fixed, so the branch is legal and the editable
 * component simply never mounts when the document is blocked.
 */
export function RichTextEditor(props: RichTextEditorProps) {
  const skew = useMemo(() => richTextSkew(props.defaultValue), [props.defaultValue])
  if (skew.blocked) {
    return (
      <RichTextBlocked
        value={props.defaultValue}
        mentionNames={props.mentionNames}
        resolveAttachmentSrc={props.resolveAttachmentSrc}
        className={props.className}
        minHeight={props.minHeight}
        onCancel={props.onCancel}
        showReload
      />
    )
  }
  return <RichTextEditorSurface {...props} />
}

function RichTextEditorSurface({
  defaultValue,
  editable = true,
  placeholder,
  ariaLabel,
  autoFocus = false,
  minHeight = '2.5rem',
  showToolbar = true,
  className,
  mentionables,
  mentionNames,
  resolveAttachmentSrc,
  onChange,
  onSubmit,
  onCancel,
}: RichTextEditorProps) {
  // `useId` yields `:r0:`, which is a legal id but not a legal bare CSS selector.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const wrapperId = `yapm-rte-${uid}`
  const listboxId = `${wrapperId}-mentions`

  const mentionablesRef = useRef(mentionables)
  mentionablesRef.current = mentionables
  const mentionNamesRef = useRef(mentionNames)
  mentionNamesRef.current = mentionNames

  const [popup, setPopup] = useState<MentionPopupState | null>(null)
  const popupRef = useRef<MentionPopupState | null>(null)
  const consumedEventRef = useRef<KeyboardEvent | null>(null)
  const [popupElement] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null
    const element = document.createElement('div')
    element.style.zIndex = '50'
    return element
  })

  // Built once per editor: the suggestion object is read at plugin-construction time, so it closes
  // over refs rather than over the current render's props.
  const mention = useMemo(
    () =>
      createMentionController({
        candidates: () => mentionablesRef.current,
        containerSelector: `#${wrapperId}`,
        element: popupElement,
        read: () => popupRef.current,
        write: (next) => {
          popupRef.current = next
          setPopup(next)
        },
        consume: (event) => {
          consumedEventRef.current = event
        },
      }),
    [wrapperId, popupElement],
  )

  const resolveSrcRef = useRef(resolveAttachmentSrc)
  resolveSrcRef.current = resolveAttachmentSrc

  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        resolveMentionName: (id) => mentionNamesRef.current?.get(id),
        resolveAttachmentSrc: (id, variant) => resolveSrcRef.current?.(id, variant) ?? '',
        mentionSuggestion: mention.suggestion,
      }),
    [mention],
  )

  const editor = useEditor({
    extensions,
    content: defaultValue ?? EMPTY_DOC,
    editable,
    autofocus: autoFocus ? 'end' : false,
    editorProps: {
      attributes: {
        'aria-label': ariaLabel,
        role: 'textbox',
        'aria-multiline': 'true',
        class: 'tiptap',
      },
      ...richTextClipboardProps(
        (id) => mentionNamesRef.current?.get(id),
        (id, variant) => resolveSrcRef.current?.(id, variant) ?? '',
      ),
    },
    onUpdate: ({ editor: instance }) => onChange?.(instance.getJSON()),
  })

  const isEmpty = useEditorState({
    editor,
    selector: (snapshot) => snapshot.editor?.isEmpty ?? true,
  })

  useEffect(() => {
    editor?.setEditable(editable)
  }, [editor, editable])

  // Set imperatively rather than through `editorProps.attributes`, and that is deliberate: moving
  // the active option dispatches no transaction, so a state-derived attribute would go stale mid
  // navigation. ProseMirror computes the editor's root attributes as an outer node decoration and
  // its patch only removes attributes a previous decoration set, so these three survive a redraw.
  useEffect(() => {
    const dom = editor?.view.dom
    if (dom === undefined) return
    if (popup === null) {
      dom.setAttribute('aria-expanded', 'false')
      dom.removeAttribute('aria-controls')
      dom.removeAttribute('aria-activedescendant')
      return
    }
    dom.setAttribute('aria-expanded', 'true')
    dom.setAttribute('aria-controls', listboxId)
    if (popup.items.length === 0) {
      dom.removeAttribute('aria-activedescendant')
    } else {
      dom.setAttribute('aria-activedescendant', mentionOptionId(listboxId, popup.activeIndex))
    }
  }, [editor, popup, listboxId])

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    handleRichTextKeyDown(
      {
        key: event.key,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        consumed: consumedEventRef.current === event.nativeEvent,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      },
      {
        onSubmit: onSubmit && editor ? () => onSubmit(editor.getJSON()) : undefined,
        onCancel,
      },
    )
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard shortcuts wrap the editable region
    <div
      id={wrapperId}
      className={cn(
        'relative rounded-control border border-border bg-bg transition-colors focus-within:border-border-strong',
        !editable && 'border-transparent bg-transparent',
        className,
      )}
      onKeyDown={onKeyDown}
    >
      {editable && showToolbar ? <Toolbar editor={editor} /> : null}
      <div className="relative px-3 py-2">
        {isEmpty && placeholder ? (
          <p
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-3 font-ui text-[13.5px] text-text-3"
          >
            {placeholder}
          </p>
        ) : null}
        <EditorContent editor={editor} className={contentClass} style={{ minHeight }} />
      </div>
      {/* PERSISTENT, and outside the popup's portal. A polite region that appears with its text
          already in it is not reliably spoken — assistive technology announces CHANGES to a region
          that was already there — so the very first announcement, the one that tells a screen-reader
          user the list opened and how many names it holds, is the one a region mounted with the
          popup would lose. This node exists for the editor's whole life and only its content
          changes. */}
      <span role="status" aria-live="polite" className="sr-only">
        {popup === null ? '' : mentionAnnouncement(popup)}
      </span>
      {popupElement !== null && popup !== null
        ? createPortal(
            <MentionList
              id={listboxId}
              items={popup.items}
              query={popup.query}
              activeIndex={popup.activeIndex}
              loading={popup.loading}
              onSelect={(index) => mention.accept(index)}
              onActiveChange={mention.setActive}
            />,
            popupElement,
          )
        : null}
    </div>
  )
}

function Toolbar({ editor }: { editor: ReturnType<typeof useEditor> }) {
  const active = useEditorState({
    editor,
    selector: (snapshot) => {
      const instance = snapshot.editor
      return {
        bold: instance?.isActive('bold') ?? false,
        italic: instance?.isActive('italic') ?? false,
        strike: instance?.isActive('strike') ?? false,
        code: instance?.isActive('code') ?? false,
        h2: instance?.isActive('heading', { level: 2 }) ?? false,
        h3: instance?.isActive('heading', { level: 3 }) ?? false,
        bullet: instance?.isActive('bulletList') ?? false,
        ordered: instance?.isActive('orderedList') ?? false,
        quote: instance?.isActive('blockquote') ?? false,
      }
    },
  })

  if (!editor || !active) return null

  const items: { key: keyof typeof active; label: string; icon: ReactNode; run: () => void }[] = [
    {
      key: 'bold',
      label: 'Bold',
      icon: <BoldIcon />,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      key: 'italic',
      label: 'Italic',
      icon: <ItalicIcon />,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      key: 'strike',
      label: 'Strikethrough',
      icon: <StrikethroughIcon />,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      key: 'code',
      label: 'Inline code',
      icon: <CodeIcon />,
      run: () => editor.chain().focus().toggleCode().run(),
    },
    {
      key: 'h2',
      label: 'Heading 2',
      icon: <Heading2Icon />,
      run: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      key: 'h3',
      label: 'Heading 3',
      icon: <Heading3Icon />,
      run: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      key: 'bullet',
      label: 'Bullet list',
      icon: <ListIcon />,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      key: 'ordered',
      label: 'Numbered list',
      icon: <ListOrderedIcon />,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      key: 'quote',
      label: 'Quote',
      icon: <QuoteIcon />,
      run: () => editor.chain().focus().toggleBlockquote().run(),
    },
  ]

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1"
    >
      {items.map((item) => (
        <Button
          key={item.key}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={item.label}
          aria-pressed={active[item.key]}
          className={active[item.key] ? 'bg-accent-soft text-accent-strong' : 'text-text-2'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={item.run}
        >
          {item.icon}
        </Button>
      ))}
    </div>
  )
}

export interface RichTextRendererProps {
  value: JSONContent | null | undefined
  mentionNames?: MentionNameLookup
  /** See `RichTextExtensionOptions.resolveAttachmentSrc`. */
  resolveAttachmentSrc?: AttachmentSrcResolver
  className?: string
}

function RichTextRendererSurface({
  value,
  mentionNames,
  resolveAttachmentSrc,
  className,
}: RichTextRendererProps) {
  const extensions = useMemo(
    () =>
      createRichTextExtensions({
        resolveMentionName: (id) => mentionNames?.get(id),
        resolveAttachmentSrc,
      }),
    [mentionNames, resolveAttachmentSrc],
  )

  // `mentionNames` is a dependency because a rename has to reach every already-rendered document:
  // the name is resolved during `renderHTML`, so the read-only editor is rebuilt when the lookup
  // changes. Callers memoise the map, so this is a rare rebuild of a document that holds no draft.
  const editor = useEditor(
    {
      extensions,
      content: value ?? EMPTY_DOC,
      editable: false,
      editorProps: richTextRendererProps((id) => mentionNames?.get(id), resolveAttachmentSrc),
    },
    [value, extensions],
  )

  return <EditorContent editor={editor} className={cn(contentClass, className)} />
}

/**
 * A reader gets the notice too, and without the Reload button: a rendered document with content
 * invisibly missing is the same failure one step downstream, and somebody reading a comment has no
 * other way to know a table was there.
 */
export function RichTextRenderer(props: RichTextRendererProps) {
  const skew = useMemo(() => richTextSkew(props.value), [props.value])
  if (skew.blocked) {
    return (
      <RichTextBlocked
        value={props.value}
        mentionNames={props.mentionNames}
        resolveAttachmentSrc={props.resolveAttachmentSrc}
        className={props.className}
        showReload={false}
      />
    )
  }
  return <RichTextRendererSurface {...props} />
}
