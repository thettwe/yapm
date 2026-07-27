import { MarkdownManager } from '@tiptap/markdown'
import type { JSONContent } from '@tiptap/react'
import { createRichTextExtensions, EMPTY_DOC } from '@yapm/ui/components/rich-text'

// Markdown is the INTERCHANGE format, never the storage format: the jsonb columns keep TipTap JSON
// and nothing here is persisted. These two functions exist for text crossing the boundary — the
// `text/plain` clipboard flavour out, a markdown paste in.
//
// This module lives in `packages/ui`, not `packages/schema`, and that is load-bearing:
// `@tiptap/markdown` pulls in `@tiptap/core` and `@tiptap/pm`, and `apps/server` imports
// `@yapm/schema`. `scripts/check-boundaries.mjs` rule 3 enforces it.
//
// `@yapm/ui/components/rich-text` imports back from here for the clipboard handlers. The cycle is
// safe only while NEITHER module reads the other's bindings during module evaluation — the manager
// below is built on first use, and the editor calls these functions from event handlers.

export interface RichTextToMarkdownOptions {
  /** Maps a mentioned user's id to their current display name, from live synced data. */
  readonly resolveMentionName?: ((id: string) => string | undefined) | undefined
}

const MENTION_NODE_TYPE = 'mention'
const MENTION_LABEL_MAX_LENGTH = 120

// 3.28.0's own set, kept verbatim. What it is missing is every character that only means something
// at the START of a line, which `escapeBlockLeading` adds.
const INLINE_ESCAPES = /([\\`*_[\]~])/g

// Cheap prefilter before the O(n) sibling scan in `isAtLineStart`: no other first character can
// begin a block construct once the inline escapes above have run.
const MAYBE_BLOCK_LEADING = /^[ \t#\-+>|=\d]/

// CommonMark reads a run of `#` at the END of an ATX heading as an optional CLOSING sequence and
// throws it away, so `## Plan #` comes back as `Plan`. Only a heading's last text node can carry one.
const HEADING_TRAILING_HASHES = /(\s)(#+)$/

// The only raw HTML this serialiser ever emits: `@tiptap/extension-italic` is the one extension in
// this node set that declares `markdownOptions.htmlReopen` (`<em>` / `</em>`), which the serialiser
// falls back to when overlapping marks cannot be written with `*` alone. Everything else that looks
// like a tag came from the user and stays text — see `refuseRawHtml`.
const SERIALISER_EMITTED_TAG = /^<\/?em>/

type TextEncoder = (text: string, node: JSONContent, parent?: JSONContent) => string

// `encodeTextForMarkdown` is `private` in the published `.d.ts` and is the ONLY private surface this
// module depends on. `renderNodeToMarkdown` short-circuits `node.type === 'text'` before any handler
// lookup, so there is no extension-level hook for text and no public seam to attach to.
interface TextEncodingHook {
  encodeTextForMarkdown: TextEncoder
}

function escapeInline(text: string): string {
  return text.replace(INLINE_ESCAPES, '\\$1')
}

function escapeBlockLeading(text: string): string {
  // Four leading spaces — or one tab — is an indented code block, and markdown has no backslash
  // escape for whitespace. The alternatives are an HTML entity (the exact garbage this module
  // exists to remove) or emitting a code block the author never wrote, so the indentation is what
  // gets dropped.
  const trimmed = text.replace(/^[ \t]+/, (run) =>
    run.includes('\t') || run.length >= 4 ? '' : run,
  )

  // CommonMark permits up to THREE spaces before every marker tested below, so the tests have to run
  // against the de-indented text — and the backslash has to be re-emitted *after* the indentation,
  // because a paragraph opening `\  - two` escapes a space, which is not a thing.
  const indent = /^ {0,3}/.exec(trimmed)?.[0] ?? ''
  const body = trimmed.slice(indent.length)

  if (/^#{1,6}(\s|$)/.test(body)) return `${indent}\\${body}`
  if (/^[-+](\s|$)/.test(body)) return `${indent}\\${body}`
  if (/^(-{3,}|={3,})\s*$/.test(body)) return `${indent}\\${body}`
  if (/^[>|]/.test(body)) return `${indent}\\${body}`

  // The DELIMITER, never the digit: `\1.` does not escape an ordered list in CommonMark, `1\.` does.
  const ordered = /^(\d{1,9})[.)](\s|$)/.exec(body)
  if (ordered) {
    const digits = ordered[1] as string
    return `${indent}${digits}\\${body.slice(digits.length)}`
  }

  return trimmed
}

// A hard break emits a newline, so the text after one opens a line exactly as the first child does.
function isAtLineStart(node: JSONContent, parent: JSONContent | undefined): boolean {
  if (parent?.type !== 'paragraph' || !Array.isArray(parent.content)) return false
  const siblings = parent.content
  if (siblings[0] === node) return true
  const index = siblings.indexOf(node)
  return index > 0 && siblings[index - 1]?.type === 'hardBreak'
}

function isCodeContext(node: JSONContent, parent: JSONContent | undefined): boolean {
  if (parent?.type === 'codeBlock') return true
  return (node.marks ?? []).some((mark) => mark.type === 'code')
}

function isLastChild(node: JSONContent, parent: JSONContent | undefined): boolean {
  const siblings = parent?.content
  return Array.isArray(siblings) && siblings[siblings.length - 1] === node
}

// TOTAL — it never calls through to the original. 3.28.0's version is
// `escapeMarkdownSyntax(encodeHtmlEntities(text))`, which HTML-entity-encodes every non-code text
// node: `a < b & c` leaves as `a &lt; b &amp; c`, correct CommonMark and literal garbage in Slack or
// a terminal. Removing the encoding alone is not safe — `> not a quote` survives today ONLY because
// `>` becomes `&gt;` — so the entity removal and the block-leading escapes are one correction.
function installPortableTextEncoding(manager: MarkdownManager): void {
  const hook = manager as unknown as TextEncodingHook
  if (typeof hook.encodeTextForMarkdown !== 'function') {
    throw new Error(
      'MarkdownManager.encodeTextForMarkdown is missing: @tiptap/markdown changed its text hook, ' +
        'so markdown output would silently regain HTML entities and lose block-leading escapes.',
    )
  }
  hook.encodeTextForMarkdown = (text, node, parent) => {
    if (isCodeContext(node, parent)) return text
    let escaped = escapeInline(text)
    if (parent?.type === 'heading' && isLastChild(node, parent)) {
      escaped = escaped.replace(HEADING_TRAILING_HASHES, '$1\\$2')
    }
    if (!MAYBE_BLOCK_LEADING.test(escaped)) return escaped
    return isAtLineStart(node, parent) ? escapeBlockLeading(escaped) : escaped
  }
}

// Markdown is a superset of HTML, and that is a liability for a paste path: a paragraph typed in a
// terminal — `compare a<b and c>d` — has an inline tag in it as far as `marked` is concerned, and
// `MarkdownManager.parseHTMLToken` hands what it finds to `generateJSON` against THIS EDITOR'S FULL
// EXTENSION SET. The tag characters vanish, the paragraph is split around the "element", and
// `<span data-type="mention" data-id="…">` parses to a REAL MENTION NODE from text somebody pasted.
//
// So the markdown path does not consume raw HTML at all: `marked`'s block (`html`) and inline
// (`tag`) tokenizers are switched off and the characters stay literal text, which is what a person
// pasting `<div>hello</div>` meant. `marked`'s `use()` wrapper falls through to the tokenizer it
// replaced only when the replacement returns `false`; `undefined` means "no match here", which is
// the whole mechanism — see `SERIALISER_EMITTED_TAG` for the one tag that is let through so this
// serialiser's own output still round-trips.
function refuseRawHtml(manager: MarkdownManager): void {
  manager.instance.use({
    tokenizer: {
      html: () => undefined,
      tag(src: string) {
        return SERIALISER_EMITTED_TAG.test(src) ? false : undefined
      },
    },
  })
}

let cached: MarkdownManager | undefined

function manager(): MarkdownManager {
  if (cached === undefined) {
    // The SAME extension list the editor is built from, so the serialiser cannot drift from the
    // node set it serialises. Construction measures ~0.12ms; the cache is tidiness, not throughput.
    //
    // UNRESOLVED, deliberately. `resolveExtensions` is not idempotent — it expands StarterKit but
    // keeps `starterKit` itself in the result, so resolving twice yields 49 extensions with 24
    // duplicate names. The manager flattens and sorts what it is given, and later calls
    // `getSchema(extensions)` on the same array, which resolves again.
    const instance = new MarkdownManager({ extensions: createRichTextExtensions() })
    installPortableTextEncoding(instance)
    refuseRawHtml(instance)
    cached = instance
  }
  return cached
}

function mentionText(
  node: JSONContent,
  resolveMentionName: ((id: string) => string | undefined) | undefined,
): string {
  const attrs = node.attrs ?? {}
  const id = typeof attrs.id === 'string' ? attrs.id.trim() : ''
  const stored = typeof attrs.label === 'string' ? attrs.label.trim() : ''
  const live = id === '' ? undefined : resolveMentionName?.(id)
  const name = (live ?? stored).trim().slice(0, MENTION_LABEL_MAX_LENGTH)
  return name === '' ? '' : `@${name}`
}

// The pre-walk, and the place the `editor-rich-content` change extends: a node markdown cannot carry
// gets its lossy fallback here, as one more case, and every other node keeps recursing untouched.
//
// A mention becomes `@Display Name` — lossy but readable, and identical to what `renderText` and
// `richTextToPlainText` already produce. 3.28.0's default is `[@ id="u1" label="Ada Lovelace"]`:
// lossless through itself, unreadable everywhere markdown actually goes. Nothing matches names on
// the way back in, so a paste never invents a mention.
function normalizeNode(
  node: JSONContent,
  resolveMentionName: ((id: string) => string | undefined) | undefined,
): JSONContent[] {
  if (node.type === MENTION_NODE_TYPE) {
    const text = mentionText(node, resolveMentionName)
    return text === '' ? [] : [{ type: 'text', text }]
  }

  const next: JSONContent = { ...node }

  // `underline` is reachable in this editor (StarterKit binds Cmd+U) and 3.28.0 emits `++u++`, which
  // is not CommonMark — GitHub, Slack and a terminal all render the plus signs. The mark goes, the
  // text stays.
  if (Array.isArray(node.marks)) {
    const marks = node.marks.filter((mark) => mark.type !== 'underline')
    if (marks.length === 0) delete next.marks
    else next.marks = marks
  }

  if (Array.isArray(node.content)) {
    next.content = node.content.flatMap((child) => normalizeNode(child, resolveMentionName))
  }

  return [next]
}

export function normalizeForMarkdown(
  doc: JSONContent,
  resolveMentionName?: ((id: string) => string | undefined) | undefined,
): JSONContent {
  return normalizeNode(doc, resolveMentionName)[0] as JSONContent
}

export function richTextToMarkdown(
  doc: JSONContent | null | undefined,
  options: RichTextToMarkdownOptions = {},
): string {
  if (!doc || (doc.content ?? []).length === 0) return ''
  const normalized = normalizeForMarkdown(doc, options.resolveMentionName)
  return manager().serialize(normalized).replace(/\n+$/, '')
}

// The inbound mirror of `normalizeNode`, and it does two things.
//
// Headings: this editor has levels 2 and 3 only. `#### four` parses to level 4, a node the schema
// does not have, and TipTap drops the node WITH its text on `setContent`. `#` and `##` deliberately
// collide: a document written elsewhere had its own h1, and flattening it into the largest heading
// that exists here is what re-serialises to `## `.
//
// Mentions: a mention node is only ever MINTED at the typeahead's call site, never parsed out of
// text. `refuseRawHtml` is what stops the parser from reaching `generateJSON` and building one, and
// this restates the invariant where enforcing it costs a type check — "a paste never notifies
// anybody" is a promise, so it is worth holding in two places rather than one.
function coerceInbound(node: JSONContent): JSONContent[] {
  if (node.type === MENTION_NODE_TYPE) {
    const text = mentionText(node, undefined)
    return text === '' ? [] : [{ type: 'text', text }]
  }

  const next: JSONContent = { ...node }
  if (node.type === 'heading') {
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 2
    next.attrs = { ...node.attrs, level: level <= 2 ? 2 : 3 }
  }
  if (Array.isArray(node.content)) next.content = node.content.flatMap(coerceInbound)
  return [next]
}

export function markdownToRichText(markdown: string): JSONContent {
  const parsed = manager().parse(markdown)
  const content = (parsed.content ?? []).flatMap(coerceInbound)
  // The manager's empty output is `{type:'doc'}`, which is not a valid document for a schema whose
  // `doc` requires `block+`.
  if (content.length === 0) return EMPTY_DOC
  return { type: 'doc', content }
}
