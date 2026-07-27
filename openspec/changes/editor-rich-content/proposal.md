## Why

The editor can hold prose. It cannot hold the three things engineers actually paste into an issue:
**a screenshot, a table, and a block of code with its syntax legible.** A bug report without the
screenshot is a worse bug report; a comparison without a table becomes a bullet list that loses the
comparison; a stack trace in an unhighlighted `<pre>` is a wall. `attachments` (#16) built the
storage and `editor-markdown` (#17) built the wire format — both shipped with no way for a person
to put an image or a table into a document. This change is the surface those two exist for.

It serves VISION **#1 Speed is the feature** (a `/` menu and `# `-style shortcuts beat reaching for
a toolbar; every insertion is local-first with no network wait), **#3 Keyboard-first** (a table is
navigable, an image is selectable and removable, and the slash menu is a listbox — none of it needs
a pointer), and **#5 Your data is yours** (every new node type extends the markdown serialiser in
the same commit, so copy-out never silently drops content).

🔴 **And it closes a data-loss hole that opens the moment the first new node type ships.** The
ProseMirror schema is versioned by the **deployed bundle**, not by the database. A tab still running
the previous build has no `image` node type; TipTap **drops unknown content on parse**, and the
description's 500ms LWW autosave then writes the pruned document back over the real one. Two tabs
open across a deploy is enough to erase every image and table from an issue, silently, with nothing
in the current design detecting it. **The maintainer's decision is to refuse the write:** stamp a
schema version, detect content the local bundle cannot hold, block autosave and show a "reload to
edit" state. Worst case becomes a stale tab that will not save — never content that is already gone.
This is the one part of the change that cannot be fixed in a follow-up.

## What Changes

- **Three new node types**, each pinned at exactly `3.28.0` (never a caret — the exact-peer trap in
  `reference/frontend-build.md` §11.1):
  - **Image** — a node carrying an **opaque `attachmentId` and no URL**, not even a relative path.
    `apps/server/src/storage/routes.ts` states the reason at line 74: an `<img src>` in a
    Zero-synced document replicates to every client's IndexedDB and persists as long as the document
    does. The renderer *computes* `/api/v1/files/<id>`. There is no `getUrl()` on the storage seam
    and a CI guard keeps it that way; this change adds the mirror guard — **no stored image attr may
    contain a URL**, enforced in the shared sanitizer so it holds server-side too.
  - **Table** — `@tiptap/extension-table` with a header row, keyboard cell navigation, and
    row/column commands reachable without a pointer.
  - **Code block with syntax highlighting** — `@tiptap/extension-code-block-lowlight` over
    `lowlight@^3.3.0` / `highlight.js@^11.11.1`, with a **curated language set** rather than
    `highlight.js/lib/common`, and a language selector on the block.
- 🔴 **A schema-skew refusal, built with the first new node type rather than after it.** A
  `RICH_TEXT_SCHEMA_VERSION` constant plus a pure `detectRichTextSkew(doc, known)` in
  `packages/schema/src/rich-text/` (which imports nothing, and still will). A loaded document that
  names a node or mark type the local bundle lacks — or stamps a version higher than the local one —
  puts the editor into a **read-only "reload to edit"** state that fires no `onChange` and therefore
  reaches no mutator. The version is stamped by `sanitizeRichText`, which already runs in every
  description and comment mutator on both the optimistic and the authoritative pass.
- **A `/` slash menu — a SIBLING of the mention controller, not a generalisation of it.**
  `createSlashController(host)` with the same host interface and its own module-level `PluginKey`.
  `MentionList` and `SlashList` stay separate: the mention list carries eligibility state, rejection
  counts and "why not" copy that a command list has no use for. The Escape contract that
  `mentions` paid for — `consumed`, **not** `event.defaultPrevented`, because `prosemirror-view`
  calls `preventDefault()` on every Escape whether or not anything handled it — is reused verbatim
  by the second popup, and a test pins that Escape with the slash menu open dismisses the menu
  **and does not discard the draft**.
- **Markdown serialiser and walker cases for every new node type, in the same change.**
  `packages/ui/src/lib/markdown.ts` gains `renderMarkdown` cases (GFM pipe table, `![alt](…)`, the
  code block's language on its fence) at the extension point `editor-markdown` design.md §D8 names,
  and `packages/schema/src/rich-text/plaintext.ts` gains walker cases. That walker feeds **both**
  the notification fan-out **and** `search_document` — a node that walks to garbage corrupts the
  search index with nothing failing loudly, so the cases are enumerated deliberately.
- **Uploads from the editor.** Paste an image, drop an image, or pick `/image`: the bytes go over
  the existing authenticated `POST /api/v1/files` multipart route, and the returned id becomes the
  node's `attachmentId`. No new route, no new server capability.
- **The issue Files section**, reading the already-synced `attachments.byIssue` query and writing
  over the existing REST verbs. Files are **DB rows, not document nodes** — there is no
  `fileAttachment` node type.
- **Tokenized CSS for tables, code blocks and images across all three presets, light and dark.**
  `highlight.js` ships its own themes and they are exactly the trap: none are loaded. Syntax colours
  are new `--code-*` tokens asserted at AA by `styles/contrast.test.ts`.

## Capabilities

### New Capabilities

- `rich-content-editing`: the image, table and highlighted-code-block node types and what a stored
  node may contain (an opaque attachment id, never a URL); the slash menu as a second suggestion
  surface with its own plugin key and the Escape contract it inherits; keyboard operability of every
  new node; and — the load-bearing one — **the schema-skew refusal**: how a document is stamped,
  how content the local bundle cannot hold is detected, and the guarantee that such a document is
  never written back in pruned form.

### Modified Capabilities

- `component-library`: the rich-text editor primitive gains the three node types, the slash-menu
  listbox, the blocked "reload to edit" state, and the `--code-*` token family. Stated alongside the
  existing mention-typeahead keyboard contract because the two popups share one `editorProps`
  surface and one keydown path, and the second one is exactly what could regress the first.
- `markdown-interchange`: the portable-output contract extends to the new node types — a table
  serialises as a GFM pipe table, an image as `![alt](/api/v1/files/<id>)`, a code block carries its
  language on the fence — and inbound `![alt](url)` deliberately does **not** mint an image node,
  for the same reason inbound `@name` does not mint a mention.
- `issue-detail`: a Files section listing the issue's attachments, and the description editor's
  refusal-to-save state when the loaded document is ahead of the bundle.

## Impact

- **UI** (`packages/ui`): `src/components/rich-text.tsx` gains the three extensions, the slash
  controller, the blocked state and the attachment-source injection point; new
  `src/components/slash-list.tsx`, `src/components/image-node.tsx`, `src/components/table-controls.tsx`;
  `src/lib/markdown.ts` gains the new `renderMarkdown` cases; `src/styles/globals.css` gains the
  `--code-*` token family in six blocks and the table/code/image rules.
- **Schema** (`packages/schema`): `src/rich-text/schema-version.ts` (new, zero imports, the constant
  and `detectRichTextSkew`), `src/rich-text/plaintext.ts` (walker cases + the version stamp and the
  `src`-strip in `sanitizeRichText`). **No migration, no Zero schema change, no new table** — the
  `attachment` table shipped in `0017_attachments` and is already synced.
- **Server** (`apps/server`): **none expected.** No new route, no change to `storage/routes.ts`.
  Asserted with a `git diff --stat` in the task list rather than assumed.
- **Web** (`apps/web`): `src/issues/issue-detail.tsx` (Files section, the upload callback, the
  blocked description state), a new `src/issues/attachments/` module for the upload client and the
  Files list.
- **Dependencies**: four catalog entries at **exactly `3.28.0`** — `@tiptap/extension-image`,
  `@tiptap/extension-table`, `@tiptap/extension-code-block`, `@tiptap/extension-code-block-lowlight`
  — plus `lowlight@^3.3.0` and `highlight.js@^11.11.1`. **`@tiptap/extension-code-block` is declared
  explicitly, not inherited**: `code-block-lowlight` peer-requires it exactly and imports it at
  runtime, and under pnpm's strict layout it otherwise resolves inside starter-kit's `node_modules`
  rather than `packages/ui`'s — a split resolution duplicates `prosemirror-model` and throws at
  runtime, not at build. `highlight.js` is **BSD-3-Clause**, the first non-MIT/Apache runtime
  dependency in the client bundle.
- **Tooling**: `scripts/check-boundaries.mjs` or a sibling guard gains the mirror of the storage
  capability rule — no URL-shaped string may be written into an image node's attributes.
- **Docs:** `apps/docs/src/content/docs/features/rich-text.md` (new — images, tables, code blocks,
  the slash menu, and the honest "reload to edit" behaviour), `apps/docs/astro.config.mjs` (one
  sidebar entry), `apps/docs/src/content/docs/features/markdown.md` (the new node rows in "what
  markdown carries"), `apps/docs/src/content/docs/self-hosting/attachments.md` (the Files section
  and editor upload path), `README.md` ("What works today"), `ROADMAP.md` (row 18 → shipped),
  `TECHSTACK.md` (the six new dependency entries and the BSD-3-Clause licence note), and
  `reference/frontend-build.md` §11 (a new §11.7 recording the verified API of the four extensions
  and the schema-skew mechanism).

## Non-goals

- **A different editor, a Notion-style block editor, drag handles, or nested blocks.** Restated
  because `@tiptap/extension-drag-handle` is MIT at 3.28 and looks tempting from inside this change.
- **Task lists / checkboxes.** Not scoped, and they interact with the work graph in ways a document
  node should not decide unilaterally.
- **A `fileAttachment` document node.** Files are DB rows. The Files section reads a table; it does
  not read the document.
- **Avatars, image editing, cropping, resizing handles, or captions.** An image is an id, an alt
  text and a width bucket.
- **Any new server route or storage capability.** No `getUrl()`, no signed URL, no redirect-to-S3.
  The change consumes `attachments` exactly as shipped.
- **A collaborative or CRDT description.** Skew is refused, not merged. LWW stays LWW.
- **Fixing `editor-markdown`'s documented inline-code-span defect** (a code span containing a
  backtick does not round-trip, `editor-markdown` design.md §I7). Out of reach for the reason
  recorded there; its characterisation test stays green and this change does not quietly change it.
- **Backfilling a schema version onto existing documents.** An unstamped document reads as version 1,
  which is exactly what it is.
