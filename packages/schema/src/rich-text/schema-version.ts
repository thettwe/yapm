// Pure recursion over rich-text document JSON. NO TIPTAP OR PROSEMIRROR IMPORT, and no import at
// all — that is not tidiness, it is the reason this file can live in `packages/schema`:
// `scripts/check-boundaries.mjs` and CLAUDE.md #3 forbid a UI dependency here, and the version
// constant has to be reachable from the shared mutator, which runs in `apps/server` and never loads
// an editor. The known-type sets are supplied BY the caller — `packages/ui` derives them from
// `getSchema(createRichTextExtensions())` — so this file knows the node set without importing it.
//
// What it is for: THE PROSEMIRROR SCHEMA IS VERSIONED BY THE DEPLOYED BUNDLE, NOT BY THE DATABASE.
// A tab running the previous build has no `image` or `table` node type; TipTap drops unknown content
// on parse, and the description's LWW autosave then writes the pruned document back. Two tabs open
// across a deploy is the entire precondition, nothing errors, and the content is unrecoverable. The
// decision is to REFUSE THE WRITE and surface a "reload to edit" state, which needs a detector that
// runs before an editor is constructed.

/**
 * Bumped whenever the declared node or mark set changes in a way an older bundle cannot represent.
 *
 * 1 — the node set before `editor-rich-content`, which is also what an UNSTAMPED document is.
 * 2 — `image`, `table`/`tableRow`/`tableHeader`/`tableCell`, and the lowlight code block.
 */
export const RICH_TEXT_SCHEMA_VERSION = 2

export const RICH_TEXT_SCHEMA_VERSION_ATTR = 'schemaVersion'

export type RichTextSkewReason = 'unknown-types' | 'newer-version'

export type RichTextSkew =
  | { readonly blocked: false }
  | {
      readonly blocked: true
      readonly reason: RichTextSkewReason
      /** In document order, deduplicated. Empty for a `newer-version` block. */
      readonly unknownTypes: readonly string[]
      readonly documentVersion: number
    }

export interface RichTextSkewKnownTypes {
  readonly knownNodeTypes: ReadonlySet<string> | readonly string[]
  readonly knownMarkTypes: ReadonlySet<string> | readonly string[]
}

// Two independent detectors, because they catch different things. The type scan catches a new node
// or mark type — this change's case and every future one — and misses a change WITHIN an existing
// type. The version stamp catches any declared change including an attr-only one, and misses a
// document written by a bundle that never stamped (which reads as version 1, correctly: it is
// version 1). The scan is what makes this change safe; the stamp is what makes the next one safe.
const CLEAN: RichTextSkew = { blocked: false }

interface UnknownNode {
  readonly type?: unknown
  readonly attrs?: unknown
  readonly marks?: unknown
  readonly content?: unknown
}

function asNode(value: unknown): UnknownNode | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as UnknownNode)
    : undefined
}

function asSet(types: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  return Array.isArray(types) ? new Set(types) : (types as ReadonlySet<string>)
}

function collectUnknown(
  value: unknown,
  known: { nodes: ReadonlySet<string>; marks: ReadonlySet<string> },
  found: string[],
  seen: Set<string>,
): void {
  const node = asNode(value)
  if (node === undefined) return

  // A node with no `type` at all is malformed rather than unknown: ProseMirror would not have
  // written it, nothing can be named in the banner, and reporting `undefined` as a type name would
  // block every document some other bug produced.
  if (typeof node.type === 'string' && !known.nodes.has(node.type) && !seen.has(node.type)) {
    seen.add(node.type)
    found.push(node.type)
  }

  if (Array.isArray(node.marks)) {
    for (const entry of node.marks) {
      const mark = asNode(entry)
      if (mark === undefined || typeof mark.type !== 'string') continue
      if (!known.marks.has(mark.type) && !seen.has(mark.type)) {
        seen.add(mark.type)
        found.push(mark.type)
      }
    }
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) collectUnknown(child, known, found, seen)
  }
}

function documentVersion(doc: unknown): number {
  const attrs = asNode(asNode(doc)?.attrs)
  const stamp = attrs?.[RICH_TEXT_SCHEMA_VERSION_ATTR as keyof UnknownNode]
  // Absent, non-numeric or non-finite all read as 1: an unstamped document IS version 1, and a
  // garbage stamp must not be able to block every reader by claiming to come from the future.
  if (typeof stamp !== 'number' || !Number.isFinite(stamp)) return 1
  return Math.trunc(stamp)
}

/**
 * Whether this bundle may edit this document.
 *
 * Total on malformed input, like every other walk in this directory: anything unwalkable contributes
 * nothing rather than throwing, because the document is user-controlled JSON and one of the callers
 * runs inside a write transaction.
 */
export function detectRichTextSkew(doc: unknown, types: RichTextSkewKnownTypes): RichTextSkew {
  const known = { nodes: asSet(types.knownNodeTypes), marks: asSet(types.knownMarkTypes) }
  const version = documentVersion(doc)

  const unknownTypes: string[] = []
  // An empty known-node set means the caller could not build a schema at all. Blocking every
  // document on that would turn one broken bundle into a whole app that refuses to edit, so the
  // scan stands down and the version stamp — which needs no schema — still applies.
  if (known.nodes.size > 0) collectUnknown(doc, known, unknownTypes, new Set<string>())

  if (unknownTypes.length > 0) {
    return { blocked: true, reason: 'unknown-types', unknownTypes, documentVersion: version }
  }
  if (version > RICH_TEXT_SCHEMA_VERSION) {
    return { blocked: true, reason: 'newer-version', unknownTypes: [], documentVersion: version }
  }
  return CLEAN
}
