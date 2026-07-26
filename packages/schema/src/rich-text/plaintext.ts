// Pure recursion over rich-text document JSON. NO TIPTAP OR PROSEMIRROR IMPORT, and no import at
// all — that is not tidiness, it is the reason this file can live in `packages/schema`:
// `scripts/check-boundaries.mjs` and CLAUDE.md #3 forbid a UI dependency here, and the same walk is
// needed by the server-authoritative mention fan-out, which never loads an editor.
//
// Expect a second consumer: the search change extends this file rather than writing its own walk.

export const MENTION_NODE_TYPE = 'mention'

// Long enough for any real display name, short enough that a crafted document cannot use the
// fallback label as free storage. A truncated label only ever affects rendering when the id
// resolves to nobody — the live user row is what a resolvable mention renders from.
export const MENTION_LABEL_MAX_LENGTH = 120

const DEFAULT_SUGGESTION_CHAR = '@'

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

function walkText(value: unknown, out: string[], options: RichTextToPlainTextOptions): void {
  const node = asNode(value)
  if (node === undefined) return

  if (isMentionNode(node)) {
    out.push(renderMention(node, options))
    return
  }
  if (node.type === 'text') {
    if (typeof node.text === 'string') out.push(node.text)
    return
  }
  if (node.type === 'hardBreak') {
    out.push(BLOCK_BREAK)
    return
  }

  for (const child of childrenOf(node)) walkText(child, out, options)

  // Blocks end a line. Runs of breaks collapse below, so an empty paragraph or a nesting level that
  // contributes no text costs no blank line.
  if (typeof node.type !== 'string' || !INLINE_NODE_TYPES.has(node.type)) out.push(BLOCK_BREAK)
}

// A document's human-readable text. Total on malformed input: anything that is not a walkable node
// contributes nothing rather than throwing, because the document is user-controlled JSON and the
// callers are inside a write transaction.
export function richTextToPlainText(
  doc: unknown,
  options: RichTextToPlainTextOptions = {},
): string {
  const out: string[] = []
  walkText(doc, out, options)
  // One line per block that produced text: trailing space left behind by a stripped mention or an
  // empty nesting level is whitespace the author never typed, so it is not theirs to preserve.
  return out
    .join('')
    .split(BLOCK_BREAK)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(BLOCK_BREAK)
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

  const source = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(source)) {
    out[key] = key === 'content' && Array.isArray(entry) ? entry.map(sanitizeValue) : entry
  }
  return out
}

// Normalises every mention node to exactly `{id, label, mentionSuggestionChar}` and leaves every
// other node untouched. Pure, deterministic and MINTS NOTHING — which is why it is safe in a shared
// mutator body, where it runs on both the optimistic and the authoritative pass so the two produce
// the same document and rebase never visibly rewrites the user's text.
//
// The generic return preserves the caller's document type: the sanitizer is shape-preserving, and
// the mutators hand it a `ReadonlyJSONValue` they must get back unchanged in type.
export function sanitizeRichText<TDoc>(doc: TDoc): TDoc {
  return sanitizeValue(doc) as TDoc
}
