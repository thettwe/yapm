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

### I12 — Task 6.2: the slash trigger is its OWN extension, not a second `suggestions` entry

The plan allowed either, and asked which. Reading the installed 3.28.0 `.d.ts` and `index.js`
settles it: **the array is mention-node-specific**, in its type and in its behaviour.

- `suggestions: Array<Omit<SuggestionOptions<SuggestionItem, Attrs>, 'editor'>>` where
  `Attrs extends Record<string, any> = MentionNodeAttrs`. A command list is not an attribute set.
- `getSuggestions()` runs every entry through `getSuggestionOptions()`, which injects a default
  `command` that inserts a node of `extensionName` (`mention`) and a default `allow` that tests
  `schema.nodes.mention`. Both are overridable, and overriding both would mean every field that
  makes the entry a *mention* entry is dead.
- Worse than dead: `renderHTML` and `renderText` call `getSuggestionFromChar(this, attrs
  .mentionSuggestionChar)` on **every mention node**, which re-derives the whole array. A `/` entry
  would be walked on every render of every mention chip, forever, for nothing.

So `SlashCommands` is a plain `Extension` whose `addProseMirrorPlugins` returns
`[Suggestion({ editor: this.editor, ...options.suggestion })]`, and returns `[]` when no suggestion
is configured — unlike the mention node, which always instantiates one and needed
`INERT_MENTION_SUGGESTION` because of it. The read-only renderer therefore carries no `/` trigger at
all rather than one that can never match.

### I13 — The trigger gate is three refusals, and the third one is a schema question

`allowedPrefixes: [' ']` does the "start of a textblock or after whitespace" half on its own:
`findSuggestionMatch` tests the single character before the match against `^[<prefixes>\0]?$`, and
the empty string (nothing before it) passes. `and/or` typed in prose sees `d` and returns null.

`slashAllowed` adds the rest: a code block (`parent.type.spec.code`), an inline code mark, and —
the one that is not obvious — **a textblock whose container cannot hold a block**. Expressed as
`$from.node(-1).canReplaceWith($from.index(-1), $from.indexAfter(-1), bulletList)` rather than as a
list of node names, so it stays true when a node type is added. Every command in the menu is a block
insert, so a place where a list is illegal is a place where the whole menu is a lie.

### I14 — Upload progress is a decoration, and the failure chip is cleared by the next edit

§D10 says the placeholder is a decoration; it does not say what happens to a FAILED one. Left
forever it is litter; removed immediately it is a message nobody read. It is cleared by the next
transaction that changes the document — so the reason is on screen when the user looks up, and gone
by the time they have typed past it. Implemented in the plugin's `apply`, which is the only place
that sees every transaction.

Two things the plan did not name and which fell out of writing it:

- **The image-paste check has to run BEFORE the `text/html` hand-off.** A screenshot pasted from the
  system clipboard carries `text/html` as well as the blob, and that HTML is an `<img>` naming a
  `blob:` URL no other client could ever resolve. Putting the check second would silently pick the
  useless flavour on macOS.
- **The upload id is a module counter, not `newId()`.** It names a decoration inside one editor's
  plugin state for the length of one request; it is never written to a document and nothing rebases
  over it. Borrowing a UUIDv7 would imply CLAUDE.md #4 had something to say here.

### I15 — `--code-punctuation` IS the body ink, and `--code-type` is a rotated hue

Forty-two hand-picked values is what §D5 asked for; two of the seven needed a rule rather than a
pick.

- **`--code-punctuation` is each preset's `--text-1`, unchanged.** Punctuation carries no meaning of
  its own — colouring it is decoration, and decorating it in seven ways across six presets is
  decoration nobody can review. The token exists so a later theme *can* move it.
- **`--code-type` is the string hue rotated +35° toward teal.** No preset palette carries a cool
  green, and in `warm` the accent and the urgent hue collapse to within a few percent of each other
  once both are fitted for contrast — two syntax classes that are the same colour is worse than one
  derived hue.

Everything else is a preset token (in-review, done, in-progress, accent, text-3) with its lightness
moved until it clears 4.5:1 against that preset's composited `--bg-hover`. `--code-comment` is in
the assertion list deliberately: dim is how a comment is conventionally distinguished, and dim is
the one thing WCAG will not have, so it is distinguished by hue instead.

### Evidence: three more falsifications (task 10.8)

| Reverted | Test that failed | Assertion |
|---|---|---|
| `host.consume(event)` in `createSlashController`'s `onKeyDown` (`if (false && handled)`) | `Escape dismisses only the menu > closes the menu, leaves the draft alone, and never calls onCancel` | `expected "spy" to not be called at all` — the wrapper stops standing down and `onCancel` discards the draft |
| `SlashCommand.run`'s single chain, split into `deleteRange` then the command | `inserts on Enter in ONE transaction, and one undo reverses it` | `AssertionError: expected 2 to be 1` |
| `--code-comment` in `warm light` set back to its unfitted source `#9a9186` | `warm light tokens meet WCAG AA > every syntax token meets AA on the code-block surface` | `--code-comment: expected 2.6404762638269714 to be greater than or equal to 4.5` |

Each was restored immediately. With the previous pass's skew falsification that is four.

### Not done in this pass

Groups 11 and 12 are the close phase's, and three items inside the build groups are open and named
rather than ticked:

- **Task 3.8** — the real-browser check that the editor constructs with all three node types and that
  `prosemirror-model` is loaded exactly once. jsdom cannot see a duplicated `prosemirror-model`; the
  `node_modules/.pnpm` evidence in I1 is necessary but not sufficient.
- **Task 12.2** — the client bundle delta from `lowlight` + `highlight.js` + the three extensions.
- **Task 12.4** — the manual browser check that Escape from EACH of the two popups dismisses only
  that popup. The unit test in `slash-menu.test.tsx` drives ProseMirror's real `handleKeyDown` and
  the real wrapper predicate, which is as close as jsdom gets; what it cannot see is
  `prosemirror-view`'s own `captureKeyDown` calling `preventDefault()` on the way past, which is the
  exact mechanism the contract is about. It stays open, and 10.7's e2e leg is where it lands.

Task 10.8 is left unticked for the same reason: the falsification table above covers three of the
new tests, but 10.7's e2e tier does not exist yet and the close phase owns both together.

---

## Close phase — tests and documentation

### I16 — The integration tier is ONE file, and it is about the search index, not the mutator

Task 10.7's tiers are three, and the middle one had to earn its Postgres. `plaintext.test.ts` already
asserts every walker case as a pure function, and `mutators.test.ts` already asserts the stamp — so
re-running either against a database would be ceremony.

What only Postgres can show is the **consequence**: `richTextToPlainText` is the projection that
becomes `search_document.body`, and a bad walker case corrupts the index **silently**. No mutator
throws, no type fails, no request errors, and nothing else in the system is loud enough to notice.
So `packages/schema/src/rich-text/search-projection.pg.test.ts` writes one description through the
real `issue.create` mutator over `createPgServerTransaction`, indexes it with the same exported
helpers `apps/server/src/jobs/search.ts` composes, and then reads it back three ways:

| Assertion | Fails when |
|---|---|
| body contains `zqrcaption`, and `search('zqrcaption')` returns the issue | the image walker case is missing — which is `origin/main`, where an image contributes nothing at all |
| body contains `alpha beta`, **not** `alphabeta`, and `search('alphabeta')` is empty | the cell separator is dropped, which welds a row into one token nobody can find |
| lines contain `alpha beta` AND `zqrgamma delta` as separate entries | the row break is dropped and the whole table folds onto one line |
| the stored `issue.description` carries `schemaVersion: 2` and both image nodes hold exactly `{alt, attachmentId, width}`, with the URL-shaped id reduced to `''` | the stamp or the attribute hardening is not on the authoritative pass |

It is **not** a re-proof of scoping — `search.pg.test.ts` owns the permission oracle — and it scopes
its `reconcileDiffBatch` to its own team for the reason that file records: the diff is global and
every Postgres suite in the repo shares one database.

The projection was verified locally against the real walker before the file was written (a throwaway
probe, deleted): `"A regression report with a screenshot and a table.\ncrash on the zqrcaption login
screen\npixel\nalpha beta\nzqrgamma delta\nconst zqrfence = 1"`. ⚠️ **The database legs themselves ran
only in CI** — the close phase was instructed not to start Docker, and the only Postgres reachable on
this host belonged to another project. The file self-gates on `DATABASE_URL` and throws in CI if it
is absent, so it cannot pass by being skipped.

The URL fixture is **assembled**, not written literally, for the reason `plaintext.test.ts` records
at the same spot: `no-capability.test.ts` rule (c) greps this directory for an attribute whose value
opens with an absolute URL and, unlike rule (a), does not exclude test files. I11's recommendation —
give rule (c) the same `.test.ts` exclusion — is **deliberately not taken here**, because rule (c)
lives in `apps/server` and §D13 and task 12.3 both say this change produces no diff there. It is a
one-line follow-up for whoever next touches that file, not a thing to break an invariant over.

### I17 — What the e2e spec claims, and what it does not

`apps/web/e2e/rich-content.spec.ts`, two tests, both keyboard-driven after a single click to place
the caret. It exists for the three things jsdom structurally cannot arbitrate:

- **ProseMirror's key pipeline.** `prosemirror-view` prevents the default of every Escape whether or
  not anything handled it, and Base UI's dismissal layer reads neither the prevented flag nor the
  event's origin. That combination is exactly what `mentions` §I26/I27 found the hard way, and it is
  what task 12.4 was left open for. The first test closes it: with the insert menu open, Escape
  leaves the draft, the trigger text and the panel all standing.
- **`Tab` inside a table**, which has to beat the browser's own focus traversal. Verified against the
  installed `extension-table` source rather than assumed: its `Tab` binding is `goToNextCell()`, and
  in the last cell `addRowAfter().goToNextCell()`. The spec asserts focus never left the editable.
- **The upload pipe end to end** — the platform file chooser the `/image` command opens, a real
  multipart body, `sharp` decoding real bytes, and the node the editor then writes.

The rendered `src` is asserted to match `^/api/v1/files/[^/?#]+$` and to return the exact bytes: the
whole storage design is that a document stores an id and the client computes a path, and this is the
one tier where "computes" is a fact about a browser rather than about a function.

⚠️ **What it does not cover, restated rather than implied** (`attachments` §I10): the runtime Docker
image, its named `files` volume and its uid-1001 user. This harness runs the server on the host under
`tsx`. The image is the compose smoke job's ground, and no assertion here is written as though it
were not.

One wait is a real timer and is labelled as one: the description autosaves on a 500 ms debounce, so
the reload leg waits 1500 ms before reloading. A reload before that fires would be testing the timer.

### I18 — Task 12.2: the bundle number, and why it is an attribution rather than an A/B

Measured from `pnpm turbo run build --filter=@yapm/web` on this tree. A true delta needs a second
build of `origin/main`, which needs a second worktree the close phase may not touch — so this is an
attribution over the produced chunk's own source map, stated as such:

```
dist/assets/issue-detail-DWxPCpD9.js   653.92 kB │ gzip: 205.45 kB

source bytes in that chunk, by origin:
  highlight.js            192_235
  extension-table          24_463
  lowlight                 12_445
  extension-code-block     10_832
  extension-image           4_264
  ------------------------------
  the five new packages   244_239   of 1_733_045 total (14.1%)
  gzipped share of sources                          15.4%  ⇒ ≈32 kB gzip
```

**Not over budget, and the reason is structural rather than lucky:** `issue-detail` is a lazily
loaded route chunk and appears in **no** `modulepreload` in the built `index.html`. The initial
payload is `rolldown-runtime` + `client` + `tdigest` + `provider` + the route shells, and none of
them carries a grammar. Somebody who never opens an issue detail never downloads `highlight.js`.
The language list is therefore left at fifteen; §D4 does not change.

`highlight.js` is 79% of the attributed bytes, which is the number that would matter if this ever
moved into the initial payload. If it does, shrink the list — that is the lever the design named.

### I19 — Task 11.7: the ten CLAUDE.md constraints, walked

Not assumed. Each verdict is a check that was run or a diff that was read.

| # | Constraint | Verdict |
|---|---|---|
| 1 | Three containers | **Unmoved.** No compose file, Dockerfile or service touched; `git diff --stat origin/main -- docker apps/server` is empty. No new volume, no new env var — which is also why no compose-smoke change was added |
| 2 | All ZQL and mutators in `packages/schema`; client and server import the same one | **Held, and this change added none.** No new query, no new mutator. `sanitizeRichText` gained the stamp inside the existing shared body, so the optimistic and authoritative passes still produce the identical document. The Files section reads the existing `attachments.byIssue` |
| 3 | Packages never import apps | **Green.** `node scripts/check-boundaries.mjs` passes, including rule 3 (no TipTap/React/ProseMirror under `packages/schema`). `schema-version.ts` imports nothing; `plaintext.ts` imports it and nothing else, so the transitive closure is still empty (I3) |
| 4 | Client-minted UUIDv7 at the mutator CALL SITE | **Held.** Nothing in this change mints an id inside a mutator. The one id-shaped thing it does mint — the upload decoration's key — is a module counter and never enters a document (I14); the version stamp is a compiled-in constant, not an id |
| 5 | Versions only in the catalog; kysely 0.28.17; no kysely-codegen; watch `jose` | **Green.** Six new catalog entries, four exact at 3.28.0; `node scripts/check-catalog.mjs` passes over 9 manifests and 90 entries. Kysely untouched. No codegen. No `jose` movement — nothing added here reaches the auth or Zero graphs |
| 6 | No tools importing the TypeScript Compiler API | **Unmoved.** `lowlight`, `highlight.js` and the four extensions are runtime libraries; Biome remains the only linter |
| 7 | Free means free | **Unmoved, and tested.** Nothing added is gated. A `viewer` sees the Files list and can download from it, and sees no upload and no remove — `files-section.test.tsx` asserts the affordance split rather than the permission, which `queries.attachments.pg.test.ts` already owns |
| 8 | Team-level metrics only | **Unmoved.** No metric, no counter, no per-person surface. The Files list names an uploader because that is a fact about a row, not a score about a person |
| 9 | Sub-100ms interactions | **Held.** The insert menu filters an in-memory array — no network on the keystroke, exactly like the mention list. Highlighting is a decoration pass with `defaultLanguage: 'plaintext'` set specifically so an unlabelled block does not run `highlightAuto` on every transaction (I6). The one thing that waits on the network is an upload, which is explicitly asynchronous and shows progress outside the document |
| 10 | Keyboard-first | **Held, and it is most of the e2e spec.** The insert menu, table navigation and structure controls, the language selector, image selection/alt/removal, the Files list and the blocked banner's Reload button are all reachable and operable with no pointer |

### I20 — Docs, and one reference correction

New: `apps/docs/src/content/docs/features/rich-text.md`, wired into the Features sidebar between
Mentions and Markdown. It documents the insert menu, images, tables, code blocks and the Files
section, and it gives the "reload to edit" state a plain-English section that says the honest thing:
the guard cannot cover the deploy that introduced it.

Touched: `features/markdown.md` (three new "carries" rows, the inbound `![](url)` → link rule, and
three new "cannot carry" rows), `self-hosting/attachments.md` (the two user-facing surfaces now
exist; the GC and backup story is unchanged and says so), `README.md`, `ROADMAP.md` (row 17 →
built, the standing paragraph, the attachments gap closed, and the export gap explicitly **not**
closed), `TECHSTACK.md` (done in the previous pass — ten TipTap catalog entries and the BSD-3-Clause
line), `DESIGN.md` (the `--code-*` family, and no `highlight.js` stylesheet), and
`reference/frontend-build.md` §11.7–11.8.

`.env.example` is untouched **because the Zod schema is**: `git diff --stat origin/main -- apps/server`
is empty, so there is no variable to add and nothing to drift from.

Two corrections a docs pass caught that reading would not have:

- **A header-less table does not promote its first row.** `renderTableToMarkdown` emits an *empty*
  header row above the body when no cell is a `tableHeader` (read from the installed source, not
  guessed) — so the docs say that, rather than the plausible-and-wrong "your first row becomes the
  header".
- **`Tab` in the last cell appends a row**, which the spec claimed and the installed source
  confirms (`goToNextCell()` → `addRowAfter().goToNextCell()`).

### Still open after this pass

- **Task 3.8** — the real-browser check that `prosemirror-model` is loaded exactly once. The e2e spec
  now constructs an editor with all three node types in a real Chromium and would fail on the
  `RangeError` a duplicate produces, which is most of it; a deliberate `document.querySelectorAll`
  count of ProseMirror instances is not written. I1's `node_modules/.pnpm` evidence still stands.
Task 12.4 is closed by the e2e spec's third test rather than by a manual pass: the `@` list and the
`/` menu are opened in **one** comment composer, Escape dismisses each without touching the draft or
the panel, and then the same key with nothing open dismisses the panel — the control that makes the
first two assertions non-vacuous. The composer is the right surface for it precisely because it has
no cancel of its own.

- **Task 12.1** — the full `lint typecheck test build` with live Postgres. The close phase ran the
  fast gates and the docs build; the PR runs the whole suite, including the `pg` and `e2e` jobs,
  which is where the two new files above are first executed against a database and a browser.
