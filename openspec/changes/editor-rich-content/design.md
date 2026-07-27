## Context

`attachments` (#16) shipped a provider-neutral storage seam, an `attachment` table synced read-only
and team-scoped, and `POST/GET/PATCH/DELETE /api/v1/files`. It deliberately shipped **no UI**.
`editor-markdown` (#17) shipped `packages/ui/src/lib/markdown.ts` and named its own extension point
for new node types. Neither change put an image, a table or a highlighted code block into a
document, because doing so needed both of them first.

The editor today is `packages/ui/src/components/rich-text.tsx`: one `createRichTextExtensions()`
node set shared by `RichTextEditor` and `RichTextRenderer`, StarterKit (headings clamped to 2/3)
plus `@tiptap/extension-mention` plus a small `MarkdownShortcuts` extension. Descriptions autosave
through a 500ms debounce in `apps/web/src/issues/issue-detail.tsx` into the shared
`mutators.issue.update`; comments post through `mutators.comment.*`. Both paths funnel through
`sanitizeRichText` in `packages/schema/src/rich-text/plaintext.ts`, which imports **nothing** — the
property that lets a document walk live in `packages/schema` at all, and which this change preserves.

Three constraints frame every decision below:

1. **A document is Zero-synced.** Whatever string sits in a node replicates to every team member's
   IndexedDB and persists as long as the document does. That is why the storage seam has no
   `getUrl()` and why an image node may not carry a `src`.
2. **The ProseMirror schema is versioned by the deployed bundle, not by the database.** Nothing
   negotiates it, nothing validates against it server-side, and TipTap's parse silently drops what
   it cannot represent.
3. **`packages/schema` may not import the UI**, enforced by `check-boundaries.mjs` rule 3.

## Goals / Non-Goals

**Goals:**

- Images, tables and syntax-highlighted code blocks in the same editor, keyboard-operable.
- A `/` menu that inserts them, and does not regress the mention typeahead's Escape contract.
- **No document ever written back in pruned form**, whatever bundle the tab is running.
- Copy-out keeps every new node type; the plaintext walk keeps the search index honest.
- The issue Files section, reading the table that already syncs.
- Every colour a token, correct in three presets × light/dark, AA.

**Non-Goals:**

- A block editor, drag handles, nested blocks, task lists, image editing, captions.
- A `fileAttachment` document node; a new server route; a new storage capability.
- Merging skewed documents. Skew is refused, never reconciled.
- Backfilling a version stamp onto existing rows.

## Decisions

### D1 🔴 — Schema skew is refused, and the refusal ships with the first new node type

**The hazard, stated precisely.** Alice's tab is running build N+1 and adds an image to
`ISS-12`'s description. Bob's tab has been open since build N, which has no `image` node type.
Bob's `RichTextEditor` was constructed with build N's schema; `useEditor`'s `content` goes through
`Node.fromJSON`/`generateJSON`, which **drops nodes the schema does not declare**. Bob types one
character anywhere in the description. `onUpdate` fires, `saveDescription` debounces 500ms,
`mutators.issue.update` writes `editor.getJSON()` — a document with the image gone — and LWW makes
it the truth. Nothing errors. Nothing is logged. The image is gone from the database and from every
replica. **Two tabs open across a deploy is the entire precondition.**

**The decision (maintainer's, settled): refuse the write and surface a "reload to edit" state.**

**Mechanism — two independent detectors, because they catch different things:**

| Detector | Catches | Misses |
|---|---|---|
| Unknown **type name** scan: every `node.type` and `mark.type` in the raw JSON tested against the local schema's declared names | a new node or mark type — the image/table/code-block case, and every future one | a change *within* an existing type: a new attr, a new content shape |
| **Version stamp**: `doc.attrs.schemaVersion` compared against a compiled-in `RICH_TEXT_SCHEMA_VERSION` | any declared change, including attr-only ones | a document written by a bundle that never stamped (reads as version 1 — correct, it *is* version 1) |

Both are cheap; both ship. The scan is what makes this change safe; the stamp is what makes the
*next* one safe.

**Where the code lives.** `packages/schema/src/rich-text/schema-version.ts` — a new file next to
`plaintext.ts`, holding `RICH_TEXT_SCHEMA_VERSION` and a pure
`detectRichTextSkew(doc, { knownNodeTypes, knownMarkTypes }): RichTextSkew`. **It imports nothing**,
for the same reason `plaintext.ts` imports nothing: the constant has to be reachable from the shared
mutator, and the mutator runs in `apps/server`. `packages/ui` supplies the known-type sets by
calling `getSchema(createRichTextExtensions())` once and reading `Object.keys(schema.nodes)` /
`schema.marks` — derived, never listed, so a node added to the extension set is covered the day it
is added rather than the day somebody remembers.

Return shape: `{ blocked: false } | { blocked: true; reason: 'unknown-types' | 'newer-version';
unknownTypes: readonly string[]; documentVersion: number }`.

**Where the stamp is written.** In `sanitizeRichText`, which already runs inside every description
and comment mutator body on **both** the optimistic and the authoritative pass. It is pure,
deterministic and mints nothing, so stamping there is rebase-safe (CLAUDE.md #4 is about *ids*
minted inside a mutator; a constant is not an id). Nothing else has to remember to stamp, and the
server-side pass re-asserts it even if a client's stamp is absent or wrong.

`RICH_TEXT_SCHEMA_VERSION` goes to **2** in this change. Version 1 is "the node set before this
change", which is what an unstamped document is.

⚠️ The pm `doc` node does **not** declare a `schemaVersion` attribute, so the editor strips it on
every load and `getJSON()` never emits it. That is fine and deliberate: the mutator re-stamps on
every write, and adding a doc attribute would be a schema change in its own right (and would itself
be pruned by an older bundle, which is the problem, not the fix).

**Where the block is enforced.** In `RichTextEditor`, at the top:

- `detectRichTextSkew` runs on `defaultValue` before the editor is constructed.
- Blocked ⇒ the component renders a **non-editable** `RichTextRenderer` over the same value, plus a
  banner: a `role="status"` line reading *"This was edited in a newer version of yapm. Reload the
  page to edit it."* and a `Reload` button calling `location.reload()`. The banner is keyboard
  reachable and is the first focusable element in the surface.
- `onChange` / `onSubmit` are **not wired** in the blocked branch. The guard is structural — there
  is no editor instance to fire them — rather than a boolean checked in a handler that a later
  refactor can forget.
- `RichTextRenderer` shows the same banner (quieter, no Reload button is required but the copy is
  the same) when the value is blocked, because a reader is otherwise looking at a document with
  content invisibly missing and has no way to know.

**Alternatives rejected:**

- *Accept the loss and ship faster.* The maintainer's decision, and correct: the loss is silent,
  undetectable after the fact, and unrecoverable. No amount of review catches content pruned in a
  browser two weeks earlier.
- *Merge the pruned document against the stored one.* Requires a diff over documents whose identity
  is positional; produces plausible-looking wrong merges; and is exactly the collaborative-editing
  complexity VISION refuses for descriptions.
- *Validate server-side and reject the mutation.* The server cannot know which bundle the client is
  running, and the pruned document is a perfectly valid document. It would also surface as a failed
  mutation with no useful message, after the user has already typed.
- *Poll a build id and force-reload the tab.* Discards unsaved work in every other surface on the
  page, and is a much larger change than this one.

**The blind window, stated rather than hidden.** A tab running the build *before this change* has
none of this code and will still prune. That window is one deploy wide and cannot be closed from
inside this change — which is precisely the argument for building the guard now rather than after
the node types. It is called out in the docs page and in `design.md` here so nobody later reads the
guard as a total guarantee.

### D2 — An image node carries an opaque `attachmentId`, and a `src` is stripped by the sanitizer

`@tiptap/extension-image@3.28.0` ships with `src` / `alt` / `title` attributes and a
`renderHTML` that emits `<img src>`. Configuring it is not enough: a paste of HTML containing an
`<img>` would parse straight into a node with an external `src`, which is both an SSRF-ish tracking
pixel and — because the document syncs — a URL at rest on every client.

So the node is **redefined, not merely configured**:

```
Image.extend({
  name: 'image',                       // same name, so an inbound <img> parses into OUR node
  addAttributes: () => ({ attachmentId: {...}, alt: {...}, width: {...} }),
  parseHTML: () => [],                 // nothing in pasted HTML becomes an image node
  renderHTML / addNodeView               // computes the URL, never stores it
})
```

- `attachmentId`: string, required. `alt`: string, default `''`. `width`: one of
  `'small' | 'medium' | 'full'`, default `'full'` — a **bucket**, not a pixel count, so there is no
  resize handle and no layout arithmetic in a synced attribute.
- **No `src`, ever.** `sanitizeRichText` deletes any attribute on an `image` node that is not one of
  the three, and additionally refuses any attribute value matching `/^\s*[a-z][a-z0-9+.-]*:|^\/\//i`
  — i.e. anything URL-shaped. Enforcing it in the shared sanitizer means it holds on the
  **authoritative** pass, so a crafted client cannot store one. A CI grep (mirroring the storage
  package's capability guard) asserts no `src` string is written into an image node anywhere in
  `packages/ui` or `apps/web`.
- **The URL is computed at render time.** `packages/ui` must not know the API base — packages never
  import apps (CLAUDE.md #3), and `FILES_API_BASE` is exported from `apps/server`. So
  `createRichTextExtensions` takes a new option
  `resolveAttachmentSrc?: (attachmentId: string, variant: 'thumb' | 'full') => string`, supplied by
  `apps/web` as `` (id, v) => `/api/v1/files/${id}${v === 'thumb' ? '/thumb' : ''}` ``. Absent (the
  Storybook and unit-test default) the node renders its alt text in a bordered placeholder rather
  than a broken image.
- A React `NodeViewWrapper` renders the `<img>` with `loading="lazy"`, `decoding="async"`, the alt
  text, and — for keyboard — `tabIndex={-1}` with ProseMirror's own `NodeSelection` doing the
  selecting (see D7).

### D3 — Table: `@tiptap/extension-table`, header row on, resizing off

`@tiptap/extension-table@3.28.0` (MIT, peers exact `@tiptap/core` and `@tiptap/pm` 3.28.0) ships
`Table`, `TableRow`, `TableHeader`, `TableCell` and a `TableKit` bundle. **Read the installed
`.d.ts` before wiring** — the v2 names and the `resizable` option shape both moved.

- Inserted as a 3×3 with a header row (`insertTable({ rows: 3, cols: 3, withHeaderRow: true })`).
- `resizable: false`. A column width is a synced attribute; a drag handle is a pointer affordance
  the keyboard cannot reach, and column widths are the single most common source of LWW churn in
  every editor that has them. Tables size to content.
- Cell content is `block+` minus tables — no nested tables (a non-goal, and the default).
- Table commands (add/delete row, add/delete column, delete table, toggle header row) are exposed
  **twice**: from the slash menu when the caret is in a table, and from a small `TableControls`
  toolbar that appears in the editor's toolbar row when `editor.isActive('table')`. Both are
  buttons; neither is a hover affordance.

### D4 — Code block: `code-block-lowlight` over a curated language set

`@tiptap/extension-code-block-lowlight@3.28.0` peer-requires **exactly** `@tiptap/extension-code-block@3.28.0`,
`@tiptap/core@3.28.0`, `@tiptap/pm@3.28.0`, `lowlight@^2 || ^3` and `highlight.js@^11` — verified
against the registry. `@tiptap/extension-code-block` is therefore a **declared dependency of
`packages/ui`**, not something inherited from StarterKit: under pnpm's strict layout an undeclared
peer resolves inside starter-kit's own `node_modules`, the lowlight extension imports a *second*
copy, and two `prosemirror-model` instances throw at **runtime** — after typecheck, lint and
`vite build` have all passed.

StarterKit's own `codeBlock` is disabled (`StarterKit.configure({ codeBlock: false })`) and replaced,
so exactly one code-block node type exists. `editor-markdown`'s `codeBlockToMarkdown` correction
(the content-dependent fence, `PortableStarterKit`) **moves onto the new extension** — it is the
same `renderMarkdown` field on a `NodeConfig`, and losing it would silently regress a shipped
round-trip test.

**Languages are curated, not `common`.** `lowlight.common` is ~37 grammars and dominates the client
bundle. The registered set is: `typescript`, `javascript`, `tsx`, `json`, `bash`, `sql`, `python`,
`go`, `rust`, `yaml`, `diff`, `markdown`, `css`, `html`, `dockerfile`. Plus `plaintext` as the
default. Registered individually from `highlight.js/lib/languages/*`, so the bundle carries exactly
these. A fenced block whose language is not registered renders unhighlighted rather than failing —
and the language selector on the block lists only registered ones, so it never offers a lie. The
list and its rationale go in `reference/frontend-build.md` §11.7; the bundle delta is measured and
recorded in the implementation log.

### D5 — Syntax colours are tokens; no `highlight.js` theme CSS is loaded

`highlight.js` ships ~250 theme stylesheets with hardcoded hex. Loading one would put fixed colours
into three themes × light/dark and fail CLAUDE.md's tokens rule and the AA assertion in
`styles/contrast.test.ts`.

Instead, `globals.css` gains a `--code-*` family in each of the six theme blocks:
`--code-keyword`, `--code-string`, `--code-number`, `--code-comment`, `--code-function`,
`--code-type`, `--code-punctuation`. Six values each, hand-picked against that preset's `--bg-hover`
(the code block's surface), and every one asserted ≥ 4.5:1 against it by an extension to
`contrast.test.ts` — including `--code-comment`, which is where every syntax theme in the world
fails AA.

The hljs class names (`.hljs-keyword`, `.hljs-string`, …) are mapped to those tokens in one CSS
block. Classes not in the map inherit `--text-1`, so an unmapped token is *plain*, never invisible.

### D6 — The slash menu is a sibling of the mention controller

`createSlashController(host)` in `rich-text.tsx`, with:

- Its own module-level `export const SLASH_PLUGIN_KEY = new PluginKey('yapm-slash')`. Two plugins
  sharing a key in one `EditorState` is what throws `RangeError: Adding different instances of a
  keyed plugin`; two *different* keys in one state is fine and is what the mention extension's
  `suggestions` array already supports.
- The same `host` shape as `MentionHost` — `containerSelector`, `element`, `read`, `write`,
  `consume` — so the popup mounts inside the editor wrapper (keeping `aria-activedescendant` a legal
  same-subtree IDREF) and every handled key is recorded against the exact native event.
- `char: '/'`, `startOfLine: false` but `allow` requires the caret to be in an **empty textblock or
  preceded by whitespace**, so `and/or` typed in prose never opens it, and it never opens inside a
  code block, a code mark, or a table header cell where a block insert is illegal.
- Items are a static, filtered command list: Heading 2, Heading 3, Bullet list, Numbered list,
  Quote, Code block, Table, Image, Divider. Each has `title`, `keywords`, an icon, an `enabled(editor)`
  predicate (Table is disabled inside a table; Image is disabled with no upload callback) and a
  `run(editor, range)` that deletes the trigger range and applies the command in **one**
  transaction, so one Cmd+Z undoes the whole thing.

**`SlashList` is a separate component from `MentionList`, deliberately.** `MentionList` carries
`eligible`, `rejectedCount`, per-row "why not" copy and a mention-specific announcement string —
none of which a command list has, and all of which would become `undefined`-guarded branches in a
merged component. They share `nextMentionIndex`-style roving-index logic by extracting the pure
index helper, and nothing else.

🔴 **The Escape contract is inherited verbatim, and is the regression risk of this change.**
`handleRichTextKeyDown` stands down on `event.consumed` — the identity of the native event the
typeahead just acted on — and **not** on `event.defaultPrevented`, because `prosemirror-view`'s
`captureKeyDown` calls `preventDefault()` on every Escape and every Enter whether or not anything
handled them. A guard on `defaultPrevented` is therefore always taken and silently disables
`onCancel` and `onSubmit` on every editor in the app. The slash controller calls the *same*
`host.consume(event)` on every key it handles. A test asserts: with the slash menu open, Escape
dismisses the menu and `onCancel` is **not** called; with no popup open, Escape still calls
`onCancel`.

### D7 — Keyboard operability, per node type

- **Slash menu**: `/` opens; ↑/↓ move; Enter/Tab accept; Escape dismisses only the menu. The listbox
  is `role="listbox"` inside the editor wrapper with `aria-activedescendant` on the editable, mirroring
  the mention list; a persistent `role="status"` region announces the open/count.
- **Table**: Tab / Shift-Tab move cell to cell (`goToNextCell`, shipped by the extension) and Tab in
  the last cell adds a row. ↑/↓ leave the table at its edges (ProseMirror's default gap-cursor
  behaviour, which requires `Gapcursor` — already in StarterKit; **verify** rather than assume).
  Row/column commands are toolbar buttons with `aria-label`s, reachable by tabbing to the toolbar.
- **Image**: ProseMirror's `NodeSelection` makes an image selectable with ↑/↓/←/→ from adjacent text;
  the selected state gets a visible `--focus-ring` outline (not a colour-only cue); Backspace/Delete
  removes it. The node view is `contentEditable={false}` with the wrapper carrying
  `role="img"` and `aria-label` from the alt text. An "Alt text" and a "Remove" control appear in
  the toolbar when an image is selected, so both are reachable without a pointer.
- **Code block**: the language selector is a `<select>` (a real one — it is a list of ~16 strings,
  and a native select is the keyboard-correct and screen-reader-correct control here) rendered in
  the node view, reachable by Tab from inside the block only via the toolbar (Tab inside a code block
  inserts a tab character, which is what a code block is for).

### D8 — Markdown cases, at the extension point `editor-markdown` §D8 named

Each new node carries its own `renderMarkdown` on its `NodeConfig` — `@tiptap/core@3.28` declares
that field, so `MarkdownManager` picks it up from the extension list and **no change to
`MarkdownManager` is needed**.

| Node | Emits | Notes |
|---|---|---|
| `image` | `![alt](/api/v1/files/<id>)` | A *path*, and only in the clipboard — never stored. The path is what makes a pasted-elsewhere image resolvable for anybody on the same host, and useless as a bearer capability off it. If no alt, `![](…)`. |
| `table` | GFM pipe table | Header row, a `---` delimiter row, one line per row, `|` escaped inside cells as `\|`, and cell content flattened to inline (a block inside a cell becomes a space-joined line — GFM has no other option). A table with no header row emits an empty header, because GFM requires one. |
| `codeBlock` | ` ```<lang> ` fence | Keeps `editor-markdown` §I11's content-dependent fence length. `language` goes on the fence; `plaintext` emits a bare fence. |

**Inbound**: `markdownToRichText` deliberately does **not** mint an image node from `![alt](url)`.
An image node names an attachment row that must exist and be team-scoped; a pasted URL names nothing
this instance owns. It degrades to a link with the alt text as its label — the same principle as
"a paste never mints a mention". A pasted GFM table **does** become a table (a table names nothing
outside the document), and a fenced block **does** become a code block with its language coerced to
the registered set or `plaintext`.

### D9 — Walker cases in `plaintext.ts`, enumerated deliberately

`richTextToPlainText` feeds the mention fan-out **and** `search_document`. It classifies by
exception: anything not in `INLINE_NODE_TYPES` is a block and ends a line, so a *new* node type
already degrades safely to "ends a line, contributes nothing". That default is wrong for two of the
three:

| Node | Contributes | Why |
|---|---|---|
| `image` | its `alt`, trimmed and length-capped like a mention label | An image with alt text "login page 500" is exactly the thing somebody searches for. Empty alt contributes nothing (and still ends a line). |
| `table` / `tableRow` / `tableHeader` / `tableCell` | cell text, cells joined by a space, rows by a newline | The default would weld every cell of a row into one word-run. Cell separation matters for both the search index and the notification excerpt. |
| `codeBlock` | its text verbatim, as one block | Already correct by default — recorded here because "already correct" is a finding, and a later refactor that changes the default must not silently change this. |

`extractMentionIds` needs no case (mentions cannot appear inside an image; they can inside a table
cell, and the existing recursion already reaches them — asserted by a test rather than assumed).

### D10 — Uploads reuse the existing route; the id is minted by the server

`POST /api/v1/files` is multipart, authenticated by the session cookie, size-bounded by
`ATTACHMENT_MAX_BYTES`, and returns `{ id, contentType, byteSize, hasThumbnail }` and **no URL**
(`storage/routes.ts` line 74). The attachment id is **server**-minted; CLAUDE.md #4 is untouched
because there is no attachment mutator and nothing rebases (`attachments` design.md §I11).

Client flow, in a new `apps/web/src/issues/attachments/upload.ts`:

1. The editor emits `onUploadImage(file) => Promise<{ attachmentId } | { error }>`.
2. `apps/web` posts the file with `teamId` and `issueId`, `credentials: 'include'`.
3. On success the editor inserts the image node in one transaction.
4. **While the upload is in flight there is no document node.** A placeholder node would be a synced
   node naming an attachment that may never exist; instead the editor shows a non-document
   ProseMirror **decoration** at the insertion point (a spinner chip) keyed to a local upload id, and
   the decoration is discarded on failure with an inline error. Nothing enters the document until the
   bytes are stored.
5. Refusals surface as visible inline errors naming the reason the route gave: too large (`413`),
   unsupported type, or the standard byte-identical refusal (which the UI renders as
   "Couldn't upload — you may not have access to this issue").

Triggers: `/image` (opens a file picker), paste of an image blob, drop of an image file. A drop of a
non-image file goes to the Files section path, not the document.

### D11 — The Files section reads the synced query and writes over REST

`queries.attachments.byIssue` already exists, is `teamScoped`, and is ordered `createdAt asc`. The
Files section renders it: filename, size, uploader, relative time, a download link to
`/api/v1/files/<id>` with `download`, and a Remove button (member+, `DELETE /api/v1/files/<id>`).
Empty state is a quiet line with an Upload button. Rows are a keyboard-navigable list; Remove is a
real button with a confirm, not a hover-revealed icon.

**Attachments uploaded from the editor appear here too** — they are rows in the same table, with an
`issue_id`. That is a feature, not a leak: the Files section is the complete inventory of what this
issue has stored, which is also what the operator's GC sweep and backup story assume.

### D12 — Dependency pinning

Six catalog entries in `pnpm-workspace.yaml`, alphabetical, each with the one-line CLAUDE.md §5
justification:

```
'@tiptap/extension-code-block': 3.28.0
'@tiptap/extension-code-block-lowlight': 3.28.0
'@tiptap/extension-image': 3.28.0
'@tiptap/extension-table': 3.28.0
'highlight.js': ^11.11.1
lowlight: ^3.3.0
```

Verified against the registry: all four TipTap packages are MIT at 3.28.0 with **exact** peers on
`@tiptap/core@3.28.0` (and `@tiptap/pm@3.28.0` for table, code-block and code-block-lowlight).
`code-block-lowlight` additionally peers `@tiptap/extension-code-block: 3.28.0` exactly,
`lowlight: ^2 || ^3` and `highlight.js: ^11`. `lowlight@3.3.0` is MIT and depends on
`highlight.js: ~11.11.0`, so the two resolve to one copy.

`highlight.js` is **BSD-3-Clause** — AGPL-compatible, and the first non-MIT/Apache runtime
dependency in the client bundle. It gets a line in `TECHSTACK.md` and in the licence audit rather
than passing unremarked.

`reference/frontend-build.md` §11.1's "pin the whole graph" rule goes from six entries to ten. The
verification is the same one that change recorded: exactly one `@tiptap/core` and one `@tiptap/pm`
directory under `node_modules/.pnpm`.

### D13 — What this change does not touch, asserted

`apps/server` gets **no** diff. No migration, no Zero schema change, no new synced query, no new
mutator. The task list ends with a `git diff --stat origin/main -- apps/server packages/schema/src/migrations packages/schema/src/zero`
whose only expected entries are the two rich-text files — the `attachments` change's §I14 precedent.

## Risks / Trade-offs

- **The skew guard is a false sense of safety for the deploy that introduces it.** → Named in the
  docs page, in D1, and in the implementation log. The guard covers every deploy after this one; the
  one that ships it has a one-window exposure that no design closes.
- **A blocked tab is a tab that cannot save.** A user who leaves a tab open across a deploy and then
  types loses nothing, but must reload to continue. → That is the trade the maintainer chose:
  recoverable annoyance over unrecoverable loss. The banner says exactly what to do and has the
  button that does it.
- **Two suggestion plugins in one editor could regress the mention Escape fix.** → The exact
  regression is pinned by a test that fails if the slash controller forgets `host.consume`. It is
  called out in the task list as the one thing to check by hand in a real browser, because it is
  invisible to jsdom (the `mentions` change learned this the hard way).
- **`lowlight` + `highlight.js` are the largest bundle addition since the editor itself.** → Curated
  language set (D4), measured and recorded rather than estimated. If the measurement is over budget,
  the language list shrinks; the design does not change.
- **A GFM table is a lossy serialisation of a ProseMirror table** (block content in a cell, merged
  cells). → Merged cells are not reachable in this UI at all (no merge command is exposed), and
  block-in-cell flattens with the loss documented in the markdown feature page's existing
  "what markdown cannot carry" table.
- **The `--code-*` family adds 7 tokens × 6 blocks = 42 values to hand-pick.** → Derived from each
  preset's existing accent/semantic hues rather than invented, and every one is machine-checked at
  AA against `--bg-hover`. The check is what makes 42 values reviewable.
- **The Files section makes editor-uploaded images visible as files.** → Deliberate (D11); stated so
  it is not read as a leak.

## Migration Plan

No database migration. No data backfill: an unstamped document reads as version 1, which is what it
is. Rollback is a redeploy of the previous image — and, notably, a rollback is the *symmetric* case
of the hazard D1 addresses: after a rollback, every document containing an image or a table is
"newer than the bundle", so every tab on the rolled-back build refuses to edit those descriptions
and says why, instead of quietly stripping them. That behaviour is the guard working, and the docs
page says so.

## Open Questions

None blocking. Two things are decided-by-default and worth a second look at review:

1. The curated language list (D4) is a judgement call about what a small dev team pastes. It is one
   array in one file.
2. Whether the read-only `RichTextRenderer` should show the skew banner at all, or render the
   lossy document quietly. This design shows it, on the grounds that a reader silently missing a
   table is the same failure one step downstream.

## Decisions made during implementation

<!-- Appended during the build phase: what was ambiguous, what was chosen, and why. -->

### I1 — Task 1.3: the graph did not split

```
$ ls node_modules/.pnpm | grep -E '^@tiptap\+(core|pm)@'
@tiptap+core@3.28.0_@tiptap+pm@3.28.0
@tiptap+pm@3.28.0

$ ls node_modules/.pnpm | grep -E '^prosemirror-model@'
prosemirror-model@1.25.11

$ ls node_modules/.pnpm | grep -E '^(lowlight|highlight)'
highlight.js@11.11.1
lowlight@3.3.0

$ ls packages/ui/node_modules/@tiptap/
extension-code-block  extension-code-block-lowlight  extension-image  extension-mention
extension-table  markdown  pm  react  starter-kit  suggestion
```

Exactly one `@tiptap/core`, one `@tiptap/pm`, one `prosemirror-model`, and one `highlight.js` shared
by `lowlight` and the code-block extension. `@tiptap/extension-code-block` resolves in
`packages/ui/node_modules`, which is the whole reason D4 declares it.

### I2 — Task 3.1: the four `.d.ts` files, as installed

Read before writing any of group 3, because 3.28 postdates the model's training data.

| Package | Exports that matter | Notes |
|---|---|---|
| `@tiptap/extension-image` | `Image` (default + named), `ImageOptions`, `SetImageOptions`, `inputRegex` | Attributes are `src`/`alt`/`title`/`width`/`height`; `parseHTML` is `img[src]`; options are `inline`, `allowBase64`, `HTMLAttributes`, `resize` (**not** `resizable`, and it is an object-or-`false`, defaulting to `false`). Ships `parseMarkdown` and `renderMarkdown` reading `attrs.src`. |
| `@tiptap/extension-table` | **Both**: `Table`, `TableCell`, `TableHeader`, `TableRow` individually **and** a `TableKit` bundle. Plus `renderTableToMarkdown`, `escapeTableCellPipes`, `preprocessTablePipes`, `createTable`, `TableView`, `DEFAULT_CELL_LINE_SEPARATOR`. | The resizing option is **`resizable: boolean`**, default `false` already. `goToNextCell` / `goToPreviousCell` are real commands. The four extensions are used directly rather than through `TableKit`, so `resizable: false` is stated at the one place it is decided. |
| `@tiptap/extension-code-block` | `CodeBlock`, `CodeBlockOptions` | Its `renderMarkdown` hard-codes three backticks — the defect `editor-markdown` §I11 corrected. |
| `@tiptap/extension-code-block-lowlight` | `CodeBlockLowlight`, `CodeBlockLowlightOptions` | The lowlight option is plainly **`lowlight`** (typed `any`), alongside `defaultLanguage`. |

Two findings from reading rather than assuming:

- **The table extension already ships markdown both ways.** `renderMarkdown` → `renderTableToMarkdown`,
  a `parseMarkdown` that builds `tableRow`/`tableHeader`/`tableCell`, and a `markdownTokenizer` that
  registers GFM table parsing with `marked`. Task 4.2's table case is therefore a *correction* to
  upstream's renderer, not a new one — see I5.
- **`Gapcursor` is in this StarterKit** (`@tiptap/extensions`, added unless `gapcursor: false`), so
  the arrow-key exit from a table works. Verified in `starter-kit/dist/index.js` rather than assumed.

### I3 — `plaintext.ts` has ONE import now, and the header says so

Task 2.2 puts the stamp in `sanitizeRichText`; task 4.1 says to keep `plaintext.ts`'s zero imports.
Both cannot be literally true unless the constant is duplicated, which is the one thing a version
constant must never be.

`plaintext.ts` imports `./schema-version.js`, a sibling that itself imports nothing, so the
**transitive closure is still empty** — which is the property the header comment was protecting.
`apps/server` still pulls in no TipTap, no React, no ProseMirror; `check-boundaries.mjs` rule 3 is
green. The header comment was rewritten to say "exactly one import — a sibling that itself imports
nothing" rather than left claiming something untrue.

### I4 — 🔴 The image node has ONE parse rule, and it is not `parseHTML: () => []`

The plan says `parseHTML: () => []` "so no pasted `<img>` becomes an image node". Written literally
that also **loses every image on an internal copy/paste**: `prosemirror-view` round-trips a copied
slice through `renderHTML` → `data-pm-slice` HTML → `parseHTML`, and a node type with no parse rule
cannot come back. Copy a paragraph containing an image, paste it one line down, and the image is
gone with nothing said — which is the same class of silent loss the schema-skew guard exists to
prevent, and shipping the guard beside it would be incoherent.

So the rule is `img[data-attachment-id]`, with `getAttrs` returning `false` unless the attribute is
present, non-empty and not URL-shaped. `data-attachment-id` is an attribute nothing outside yapm
emits, and the node declares **no `src` attribute at all**, so:

- a pasted `<img src="https://tracker.example/p.png">` matches no rule and mints nothing;
- a crafted `<img data-attachment-id="…">` can mint a node naming an id the pasting user may not
  own — and that is inert, because permission is checked server-side per request on `team_id` and
  the refusal is byte-identical to "no such attachment";
- `sanitizeRichText` refuses a URL-shaped `attachmentId` again on the authoritative pass.

The purpose clause of the instruction — no pasted `<img>` becomes an image node — holds exactly. If
review disagrees, the revert is one `parseHTML` body.

### I5 — Three corrections to `@tiptap/extension-table`'s shipped markdown renderer

All on the public `renderMarkdown` `NodeConfig` field, none touching `MarkdownManager`.

1. **A `|` typed in a cell splits the cell.** `renderTableToMarkdown` escapes pipes only inside
   backtick code spans (`escapeTableCellPipes`), so `a | b` as prose emits `| a | b |` and re-parses
   one column wider. The fix wraps the `helpers` object handed to the renderer so that
   `renderChildren` escapes pipes in the cell text it returns — reusing upstream's whole layout pass
   rather than reimplementing it. The escape walks backslash pairs rather than using a regex, because
   the text encoder has already escaped backslashes and `\\` must not gain a third.
2. **A multi-block cell emits U+001F.** `DEFAULT_CELL_LINE_SEPARATOR` is the unit separator, and the
   renderer's own `collapseWhitespace` is `/\s+/`, which does not match it — so a cell holding two
   paragraphs reached the clipboard with a literal control character in it. Passing
   `cellLineSeparator: ' '` gives the space-joined line §D8 specifies.
3. **`codeBlockToMarkdown` moved onto `CodeBlockLowlight`**, and `PortableStarterKit`'s
   `addExtensions` override is deleted — StarterKit's `codeBlock` is now `false` and nothing else
   needed the override. It also learned one thing: a `plaintext` block emits a **bare** fence, since
   ` ```plaintext ` pasted into GitHub is noise nobody wrote.

### I6 — Languages are ACCEPTED as aliases, and `lowlight` is reached through an adapter

§D4's curated list is sixteen entries. Coercing everything else to `plaintext` broke four shipped
`editor-markdown` round-trip tests, because ` ```ts ` and ` ```md ` are what people actually write
and coercion rewrote the author's fence.

Two mechanisms, decided by reading the plugin's source:

- **`LANGUAGE_ALIASES`** — `ts`, `js`, `jsx`, `md`, `sh`, `zsh`, `py`, `rs`, `yml`, `golang`,
  `docker`, `patch`, `xml`, `text`, `txt`. Each is *accepted verbatim* (so a round trip returns the
  author's fence) and maps to the selector entry it belongs to (so the `<select>` shows "TypeScript"
  for a `ts` block rather than rendering blank). Every one was verified to resolve against the
  registered grammars by running it; `shell` does not resolve and is therefore not in the list.
- **A `lowlight` adapter, not the raw instance.** `LowlightPlugin` decides whether to highlight at
  all with `lowlight.listLanguages().includes(language)` — registered names, **not** aliases — or
  `highlight.getLanguage(language)` against the **global** `highlight.js/lib/core` singleton, which
  `createLowlight()`'s private instance never populates (verified: `core.getLanguage('typescript')`
  is `false` after registering it on the instance). A ` ```ts ` block would fail both gates and fall
  through to `highlightAuto` — a detection pass per keystroke, guessing. The adapter answers for the
  accepted set and refuses to throw, since `lowlight.highlight` throws on an unknown name and a
  document is user-controlled input.

`defaultLanguage: 'plaintext'` for the same reason: without it every unlabelled block runs
`highlightAuto` on every transaction.

An **unrecognised** language still coerces to `plaintext` inbound, per §D8. A **bare** fence keeps
the node's own `null` rather than being written to `plaintext` — they mean the same thing to the
renderer and the selector, and writing one would be attribute churn on every paste.

### I7 — The image's markdown path is computed in the PRE-WALK, like a mention's display name

`packages/ui` may not know the API base (CLAUDE.md #3), and the markdown manager is a module-level
singleton built from `createRichTextExtensions()` with **no** options — so a per-call
`resolveAttachmentSrc` cannot reach an extension's config. `normalizeForMarkdown` therefore rewrites
`{attachmentId, alt, width}` into `{alt, src}` and the extension's `renderMarkdown` emits
`![alt](src)`. Exactly the mechanism `editor-markdown` already uses for `resolveMentionName`.

**With no resolver the image degrades to its alt text** rather than emitting `![alt]()`, which would
re-parse as an image with an empty target. Storybook and the unit tests are the only surfaces
without one; `apps/web` supplies it in task 7.4.

Inbound, `![alt](url)` becomes a **link labelled with the alt** (§D8). One thing the plan did not
anticipate: a lone `![alt](url)` line arrives as a **doc-level** image node, and the link it degrades
to is inline — a `doc` requires `block+`, so `coerceInbound` wraps it in a paragraph at that one
depth. Without the wrap the whole node is dropped on `setContent`.

### I8 — The plaintext walker carries one bit of context, and separators can be upgraded

§D9's table row is not reachable by a stateless case. A cell is a **block** container, so its
paragraphs would each end a line and a three-column row would arrive at `search_document` as three
lines. `walkText` gained an `inCell` flag: inside a cell every block separator is a space, and the
`tableRow` node — which is not `inCell` — still ends the line.

Two mechanical corrections that followed:

- **Separator collapsing had to become stateful.** Runs of `\n` collapse in the final join, but runs
  of `' '` survive it as literal double spaces. Comparing the last pushed part against the break
  strings is wrong — a text node whose whole content is one space is indistinguishable from a cell
  separator by value, and mistaking one for the other welds two blocks together. The sink tracks the
  pending separator explicitly.
- **A row break must REPLACE a trailing cell separator.** A row's last cell pushes a space and then
  the row has to end the line; a plain "skip if a separator is already pending" dropped the newline
  and welded every row of the table into one line. Caught by the test, not by reading.

`codeBlock` needed no case and now carries a comment saying so, so a later refactor of the default
cannot silently change it.

### I9 — `isRichTextEmpty` counts a table as structural

Not in the plan. A description holding one empty table is not an empty description, and without the
case the placeholder would draw over a table the user just inserted. One line beside the existing
`horizontalRule` / `image` case.

### I10 — Task 2.2's "update the tests that assert an exact document" reached three files

The stamp changes what `sanitizeRichText` returns, so every test asserting a stored document
verbatim moved: `plaintext.test.ts` (one case, now asserting the document *below* the stamp),
`zero/mutators.test.ts` and `zero/mutators.issue.test.ts`.

⚠️ That means `git diff --stat origin/main -- packages/schema/src/zero` is **not** empty, which
task 12.3 expects. The two entries are `mutators.test.ts` and `mutators.issue.test.ts` — expectation
updates only, no mutator body, no ZQL, no new mutator. 12.3 should be read as "no *behaviour* in
`src/zero` moved", and the close phase should record these two files as the expected entries rather
than treating a non-empty diff as a failure.

### I11 — The capability guard has no test-file exclusion, and it caught a test asserting the ban

`apps/server/src/storage/no-capability.test.ts` rule (c) greps `packages/schema/src/rich-text` and
`packages/ui/src` for an attribute whose value opens with an absolute URL. Writing the sanitizer test
for §D2 — the one that proves a tracking-pixel `src` is dropped — tripped it, and so did the comment
explaining why. Exactly the shape `attachments` §I6 recorded for rule (a), which excludes `.test.ts`
for precisely this reason; rule (c) does not.

`apps/server` gets no diff in this change (§D13), so the fixture is assembled instead of written as a
literal, with a comment naming the guard. **The close phase should give rule (c) the same
`.test.ts` exclusion rule (a) has** — a guard that a test about the invariant cannot state is a guard
that will be worked around rather than read.

### Evidence: the falsifiable check can fail (task 10.8, first leg)

`packages/ui/src/components/rich-text.skew.test.tsx`, 6 tests, all green. Neutering the guard — one
`if (false && skew.blocked)` in `RichTextEditor`, restored afterwards — fails **2 of 6**:

```
× the write is structurally refused > renders the blocked state, exposes no editable region,
  and never fires onChange
    TestingLibraryElementError: Unable to find an element by: [data-testid="rich-text-blocked"]
× the write is structurally refused > says why, in a status region a screen reader announces
```

The other four are the hazard and the detector, which do not depend on the component: leg 1 builds a
real `Editor` over the extension set with the five new node types removed and observes TipTap prune
the image and the table while leaving the paragraph behind, and leg 2 reports that same document
blocked against that same reduced schema. Both are unwritable against `origin/main`, where neither
the node types nor `detectRichTextSkew` exist.

### Not done in this pass

Groups 6–9, 11 and 12 are the later passes'. Two items inside groups 1–5 are also open and are named
rather than ticked:

- **Task 3.8** — the real-browser check that the editor constructs with all three node types and that
  `prosemirror-model` is loaded exactly once. jsdom cannot see a duplicated `prosemirror-model`; the
  `node_modules/.pnpm` evidence in I1 is necessary but not sufficient.
- **Task 12.2** — the client bundle delta from `lowlight` + `highlight.js` + the three extensions.
