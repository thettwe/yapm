// Pure recursion over rich-text document JSON. NO TIPTAP OR PROSEMIRROR IMPORT, and exactly one
// import — a sibling in this directory that itself imports nothing, so the transitive closure is
// still empty. That is not tidiness, it is the reason this file can live in `packages/schema`:
// `scripts/check-boundaries.mjs` and CLAUDE.md #3 forbid a UI dependency here, and the same walk is
// needed by the server-authoritative mention fan-out, which never loads an editor.
//
// Expect a second consumer: the search change extends this file rather than writing its own walk.
// It arrived, and it added exactly one thing — `maxLength`. Both of its callers need a BOUNDED
// projection: the indexer writes the result into a row and the on-device pass caches it per issue,
// so a pathological document must cost a known number of bytes rather than however many its author
// pasted. Everything else search needs (`'label'` resolution, `extractMentionIds`) was already here.

import { RICH_TEXT_SCHEMA_VERSION, RICH_TEXT_SCHEMA_VERSION_ATTR } from './schema-version.js'

export const MENTION_NODE_TYPE = 'mention'

// Long enough for any real display name, short enough that a crafted document cannot use the
// fallback label as free storage. A truncated label only ever affects rendering when the id
// resolves to nobody — the live user row is what a resolvable mention renders from.
export const MENTION_LABEL_MAX_LENGTH = 120

const DEFAULT_SUGGESTION_CHAR = '@'

export const IMAGE_NODE_TYPE = 'image'

// Same reasoning as the mention label: long enough for any alt text somebody writes, short enough
// that a crafted document cannot use it as free storage in the search index.
export const IMAGE_ALT_MAX_LENGTH = 300

// A BUCKET, never a pixel count: a synced width attribute plus a drag handle is LWW churn on every
// resize, and a pointer-only affordance besides.
export const IMAGE_WIDTHS: ReadonlySet<string> = new Set(['small', 'medium', 'full'])
const DEFAULT_IMAGE_WIDTH = 'full'

// A scheme (`https:`, `javascript:`, `data:`) or a protocol-relative prefix. Anything matching is
// refused outright rather than rewritten — see `sanitizedImageAttrs`.
const URL_SHAPED = /^\s*[a-z][a-z0-9+.-]*:|^\/\//i

// The table node family. A cell is a block container, so the default block handling would end a
// line after every cell and — once blank lines are dropped — weld a row's cells into one word-run.
const TABLE_CELL_TYPES = new Set(['tableCell', 'tableHeader'])
const TABLE_ROW_TYPE = 'tableRow'

// Cells within a row are separated by a space, rows from one another by a newline. Both matter:
// this walk feeds the notification excerpt AND `search_document`, and `1002 open` indexed as one
// token is a row nobody can find.
const CELL_BREAK = ' '

// Inline nodes contribute characters; everything else is a block and ends a line. Classifying by
// exception rather than by an allow-list of block types means an unknown node from a future
// extension separates lines instead of silently welding two paragraphs together.
const INLINE_NODE_TYPES = new Set([MENTION_NODE_TYPE, 'text', 'hardBreak'])

// `'label'` renders a mention as `@` + the resolved display name. `'strip'` omits it entirely.
//
// ANY CALLER FEEDING DOCUMENT TEXT TO A LANGUAGE MODEL MUST USE `'strip'`. Mention nodes are the
// first mechanism that puts a colleague's name inside `issue.description` and `comment.body`, and
// the AI substrate's guarantee is that the model is fed no per-person data BY CONSTRUCTION. The
// default is `'label'` because the other callers are human-facing; the default is not safe for a
// model, which is why the mode is explicit rather than inferred.
export type MentionRenderMode = 'label' | 'strip'

export interface RichTextToPlainTextOptions {
  readonly mentions?: MentionRenderMode
  // Resolved display names by user id. A mention with no entry falls back to its stored `label`,
  // and a mention with neither renders as nothing at all rather than as a bare `@`.
  readonly names?: ReadonlyMap<string, string>
  // A hard ceiling on the returned text, in UTF-16 code units, and also an early exit from the
  // walk — a document twenty times the budget must not cost twenty times the work. Omitted means
  // unbounded, which is what the human-facing callers want.
  readonly maxLength?: number
}

interface TextSink {
  readonly parts: string[]
  length: number
  readonly budget: number
  // The separator currently sitting at the tail, or null. Tracked rather than inferred by comparing
  // the last part against the break strings: a text node whose whole content is one space is
  // indistinguishable from a cell separator by value, and mistaking one for the other welds two
  // blocks together.
  pending: string | null
}

const UNBOUNDED = Number.POSITIVE_INFINITY

function push(sink: TextSink, text: string): void {
  if (text.length === 0) return
  sink.parts.push(text)
  sink.length += text.length
  sink.pending = null
}

// A separator after a separator adds nothing — runs of BLOCK_BREAK collapse in the join at the end
// of `richTextToPlainText`, but a run of CELL_BREAK would survive it as literal double spaces.
//
// A row break arriving on top of a cell separator REPLACES it, which is the case that actually
// matters: a row's last cell pushes a space and the row itself then has to end the line.
function pushBreak(sink: TextSink, separator: string): void {
  if (sink.parts.length === 0) return
  if (sink.pending === separator) return
  if (sink.pending === CELL_BREAK && separator === BLOCK_BREAK) {
    sink.length += separator.length - CELL_BREAK.length
    sink.parts[sink.parts.length - 1] = separator
    sink.pending = separator
    return
  }
  if (sink.pending !== null) return
  sink.parts.push(separator)
  sink.length += separator.length
  sink.pending = separator
}

function isFull(sink: TextSink): boolean {
  return sink.length >= sink.budget
}

interface UnknownNode {
  readonly type?: unknown
  readonly text?: unknown
  readonly attrs?: unknown
  readonly content?: unknown
}

function asNode(value: unknown): UnknownNode | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownNode)
    : undefined
}

function childrenOf(node: UnknownNode): readonly unknown[] {
  return Array.isArray(node.content) ? node.content : []
}

function attrsOf(node: UnknownNode): Record<string, unknown> {
  const attrs = asNode(node.attrs)
  return attrs === undefined ? {} : (attrs as Record<string, unknown>)
}

function isMentionNode(node: UnknownNode): boolean {
  return node.type === MENTION_NODE_TYPE
}

function mentionId(node: UnknownNode): string | undefined {
  const id = attrsOf(node).id
  if (typeof id !== 'string') return undefined
  const trimmed = id.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function mentionLabel(node: UnknownNode): string {
  const label = attrsOf(node).label
  if (typeof label !== 'string') return ''
  return label.trim().slice(0, MENTION_LABEL_MAX_LENGTH)
}

const BLOCK_BREAK = '\n'

function renderMention(node: UnknownNode, options: RichTextToPlainTextOptions): string {
  if (options.mentions === 'strip') return ''
  const id = mentionId(node)
  const resolved = id === undefined ? undefined : options.names?.get(id)
  const name = (resolved ?? mentionLabel(node)).trim()
  return name.length > 0 ? `@${name}` : ''
}

function imageAlt(node: UnknownNode): string {
  const alt = attrsOf(node).alt
  if (typeof alt !== 'string') return ''
  return alt.trim().slice(0, IMAGE_ALT_MAX_LENGTH)
}

// `inCell` is the one piece of context the walk carries, and it exists because a table cell is a
// BLOCK container: without it, every paragraph inside a cell ends a line and a three-column row
// becomes three lines that no longer read as a row.
function walkText(
  value: unknown,
  sink: TextSink,
  options: RichTextToPlainTextOptions,
  inCell = false,
): void {
  if (isFull(sink)) return
  const node = asNode(value)
  if (node === undefined) return

  if (isMentionNode(node)) {
    push(sink, renderMention(node, options))
    return
  }
  if (node.type === 'text') {
    if (typeof node.text === 'string') push(sink, node.text)
    return
  }
  if (node.type === 'hardBreak') {
    pushBreak(sink, inCell ? CELL_BREAK : BLOCK_BREAK)
    return
  }

  // An image is a LEAF that carries text nobody else carries: "login page 500" as alt text is
  // exactly the thing somebody searches for, and the default (a block contributing nothing) would
  // drop it. Empty alt contributes nothing and still ends a line.
  if (node.type === IMAGE_NODE_TYPE) {
    push(sink, imageAlt(node))
    pushBreak(sink, inCell ? CELL_BREAK : BLOCK_BREAK)
    return
  }

  const type = typeof node.type === 'string' ? node.type : ''
  const cell = inCell || TABLE_CELL_TYPES.has(type)

  for (const child of childrenOf(node)) {
    if (isFull(sink)) break
    walkText(child, sink, options, cell)
  }

  // Blocks end a line. Runs of breaks collapse below, so an empty paragraph or a nesting level that
  // contributes no text costs no blank line.
  //
  // Inside a table cell the separator is a SPACE instead — cells within a row read as one line, rows
  // are separated from each other by the `tableRow` node itself, which is not `inCell` and so still
  // ends a line. `codeBlock` needs no case at all: its text children are pushed verbatim and it ends
  // a line here, which is already right. That is recorded because "already correct" is a finding —
  // a later refactor of this default must not silently change it.
  if (type === '' || !INLINE_NODE_TYPES.has(type)) {
    pushBreak(sink, cell && type !== TABLE_ROW_TYPE ? CELL_BREAK : BLOCK_BREAK)
  }
}

// A document's human-readable text. Total on malformed input: anything that is not a walkable node
// contributes nothing rather than throwing, because the document is user-controlled JSON and the
// callers are inside a write transaction.
export function richTextToPlainText(
  doc: unknown,
  options: RichTextToPlainTextOptions = {},
): string {
  const budget =
    options.maxLength === undefined ? UNBOUNDED : Math.max(0, Math.trunc(options.maxLength))
  const sink: TextSink = { parts: [], length: 0, budget, pending: null }
  walkText(doc, sink, options)
  // One line per block that produced text: trailing space left behind by a stripped mention or an
  // empty nesting level is whitespace the author never typed, so it is not theirs to preserve.
  const text = sink.parts
    .join('')
    .split(BLOCK_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(BLOCK_BREAK)
  // Cut again after the join: the walk stops at the first part that crosses the budget, so the last
  // one can overshoot it. A truncated word is the right failure — the alternative is a bound the
  // caller cannot rely on.
  return text.length > budget ? text.slice(0, budget) : text
}

function walkMentionIds(value: unknown, ids: string[], seen: Set<string>): void {
  const node = asNode(value)
  if (node === undefined) return

  if (isMentionNode(node)) {
    const id = mentionId(node)
    if (id !== undefined && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
    return
  }

  for (const child of childrenOf(node)) walkMentionIds(child, ids, seen)
}

// Mention ids in document order, deduplicated. A document with no mention nodes — which is every
// document written before this change — yields `[]`, so nothing historical retroactively notifies
// anybody. That is a property of the walk rather than of a backfill step somebody has to remember
// not to write.
export function extractMentionIds(doc: unknown): string[] {
  const ids: string[] = []
  walkMentionIds(doc, ids, new Set<string>())
  return ids
}

function sanitizedMentionAttrs(node: UnknownNode, id: string): Record<string, unknown> {
  const char = attrsOf(node).mentionSuggestionChar
  return {
    id,
    label: mentionLabel(node),
    // KEPT, not stripped: a handful of bytes buys documents written today the ability to round-trip
    // if a second trigger character is ever added.
    mentionSuggestionChar:
      typeof char === 'string' && char.length > 0 ? char : DEFAULT_SUGGESTION_CHAR,
  }
}

function sanitizedImageAttrs(node: UnknownNode): Record<string, unknown> {
  const attrs = attrsOf(node)
  const id = typeof attrs.attachmentId === 'string' ? attrs.attachmentId.trim() : ''
  const alt = typeof attrs.alt === 'string' ? attrs.alt.trim().slice(0, IMAGE_ALT_MAX_LENGTH) : ''
  const width = typeof attrs.width === 'string' ? attrs.width : ''
  return {
    // URL-shaped in the id is not a naming mistake, it is the ban being probed: `attachmentId` is
    // opaque and the renderer computes the path, so anything with a scheme or a protocol-relative
    // prefix is dropped to '' and the node degrades to a placeholder rather than storing a URL.
    attachmentId: URL_SHAPED.test(id) ? '' : id,
    // `alt` is NOT tested against it. Alt text is display prose, never an `href` and never a `src`,
    // and the pattern matches any sentence whose first word is followed by a colon — "Error: 500 on
    // login" is the alt text somebody actually writes for a screenshot of that error, and deleting
    // it would protect nothing while destroying the one thing search can read about a picture.
    alt,
    width: IMAGE_WIDTHS.has(width) ? width : DEFAULT_IMAGE_WIDTH,
  }
}

function sanitizeValue(value: unknown): unknown {
  const node = asNode(value)
  if (node === undefined) return value

  if (isMentionNode(node)) {
    const id = mentionId(node)
    // A mention with no id can never be resolved, permission-checked or notified, so it is not a
    // mention. It degrades to the text a reader already sees rather than being deleted.
    if (id === undefined) return { type: 'text', text: `@${mentionLabel(node)}` }
    return { type: MENTION_NODE_TYPE, attrs: sanitizedMentionAttrs(node, id) }
  }

  // An image node carries an OPAQUE attachment id and no URL — not even a relative path — because
  // the document syncs to every team member's IndexedDB and whatever string sits in a node
  // replicates with it. `packages/ui` redefines the node with `parseHTML: () => []` and no `src`,
  // but that only binds a client running this bundle; enforcing it HERE is what makes it true on
  // the authoritative pass, so a crafted client cannot store one either.
  if (node.type === IMAGE_NODE_TYPE) {
    return { type: IMAGE_NODE_TYPE, attrs: sanitizedImageAttrs(node) }
  }

  const source = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    out[key] = key === 'content' && Array.isArray(entry) ? entry.map(sanitizeValue) : entry
  }
  return out
}

// Normalises every mention node to exactly `{id, label, mentionSuggestionChar}` and every image node
// to exactly `{attachmentId, alt, width}`, stamps the document with the schema version, and leaves
// every other node untouched. Pure, deterministic and MINTS NOTHING — which is why it is safe in a
// shared mutator body, where it runs on both the optimistic and the authoritative pass so the two
// produce the same document and rebase never visibly rewrites the user's text. (CLAUDE.md #4 is
// about IDS minted inside a mutator; a compiled-in constant is not an id.)
//
// The stamp is written here because this is the one funnel every description and every comment
// already goes through. The pm `doc` node does not declare a `schemaVersion` attribute, so an editor
// strips it on load and `getJSON()` never emits it — deliberate: the mutator re-stamps on every
// write, and declaring a doc attribute would itself be a schema change an older bundle would prune.
//
// The generic return preserves the caller's document type: the sanitizer is shape-preserving, and
// the mutators hand it a `ReadonlyJSONValue` they must get back unchanged in type.
export function sanitizeRichText<TDoc>(doc: TDoc): TDoc {
  const sanitized = sanitizeValue(doc)
  const node = asNode(sanitized)
  if (node === undefined || node.type !== 'doc') return sanitized as TDoc
  const attrs = asNode(node.attrs)
  return {
    ...(node as Record<string, unknown>),
    attrs: { ...(attrs ?? {}), [RICH_TEXT_SCHEMA_VERSION_ATTR]: RICH_TEXT_SCHEMA_VERSION },
  } as TDoc
}
