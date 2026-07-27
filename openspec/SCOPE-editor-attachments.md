# Scope — richer editor and attachments

Input for the build flows. Three scoping passes (storage, editor, markdown) reconciled 2026-07-27.

**Maintainer's decisions, already settled:** richer content in the *same* editor (no block editor, no
library swap) · Linear's model — rich-text editing, TipTap JSON storage, markdown as interchange ·
editor uploads **and** issue attachments, avatars out of scope.

## Verdict: three changes, not one

The three areas sized independently at 2–3 days, "largest since connectors", and 1.5–2 days. That is
not one change. Splitting is also the standing decision — scope per change is now the main cost driver.

| # | Change | Depends on | Ships without the others? |
|---|---|---|---|
| 1 | `attachments` — storage seam, upload/serve routes, `attachment` table | — | Yes: files uploadable via API, no editor UI |
| 2 | `editor-markdown` — input rules, paste-in, copy-out | — | Yes: today's node set only |
| 3 | `editor-rich-content` — image/table/code-block nodes, slash menu, files UI | 1 and 2 | No |

**1 and 2 are genuinely disjoint** — storage is server + schema, markdown is `packages/ui` — so they can
run in parallel worktrees. **3 goes last** and extends both: it adds the walker cases and the markdown
serializer cases for the node types it introduces. Doing 3 before 2 would mean extending the serializer
twice.

---

## 1. `attachments`

### The crux: signed URLs are structurally unavailable here

Not "worse" — unavailable. An `<img src>` lives in a document that **syncs via Zero**, so whatever
string sits in that node replicates to every team member's IndexedDB and persists as long as the
document does. A signed URL there is a bearer capability at rest on every client, breaks permanently
when it expires, and re-signing it means rewriting `issue.description` on a timer — LWW churn, a
mention diff and a `search_document` reindex on every rewrite, and an `updated_at` that lies.

**So the stored node carries an opaque `attachmentId` and no URL at all** — not even a relative path.
The renderer computes `/api/v1/files/${id}/thumb`. The app proxies bytes for both providers so the
permission check and the refusal shape are identical.

### Scope

- **`StorageProvider` seam** shaped like `Mailer`: `put` / `get` / `delete` (idempotent) / `health`.
  **No `getUrl()`, ever** — the moment the seam can mint a URL the permission model becomes
  provider-dependent. Key validation (traversal defence) lives in the provider.
- **`LocalStorageProvider`** over `STORAGE_LOCAL_DIR` (default `/var/lib/yapm/files`), team-sharded keys.
- **S3 via `aws4fetch@1.0.20`** (MIT, ~4 KB, zero deps) — SigV4 over platform `fetch`. The `resend.ts`
  precedent applied verbatim: no vendor SDK.
- **Migration `0016_attachments`**: one `attachment` table, server-minted UUIDv7 PK, `team_id` as the
  permission anchor, nullable `issue_id` / `comment_id` (a deleted comment orphans rather than cascades).
- Upload and serve routes using `hono/body-limit`, `hono/etag`, `hono/secure-headers` — already shipped
  in `hono@4.12.31`, no new dependency.
- `sharp` moves from `apps/docs`-only to `apps/server` for thumbnails. Already at catalog latest
  (`0.35.3`) — **but this puts a native module in the runtime image for the first time.**
- GC sweep for orphans; what `yapm backup` must now include.

### Non-goals
Signed/presigned/shareable URLs of any kind · public links · 302-redirect-to-S3 byte serving · avatars.

### The risk that will actually bite
**A signed URL creeps back in during implementation** — as `getUrl()` "just for S3", or a `src` written
into the document "so the renderer is simpler". Either silently converts every attachment into a bearer
capability replicated to every client, **and it will pass review because the code looks clean.** Mitigate
the way `db/search.ts` guards the AI boundary: a CI grep assertion (`no /presign|signedUrl|X-Amz-Signature/`
in the storage package; no `http` in any stored image node attr). An absence is not self-enforcing.

### Falsifiable check
A member of team A requests an attachment belonging to team B and gets a response **byte-identical** to
one for an attachment that does not exist. Same status, same shape — no 404-vs-403 oracle.

---

## 2. `editor-markdown`

### Scope
`@tiptap/markdown@3.28.0` — verified to exist, first-party (ueberdosis monorepo, `packages/markdown`),
MIT, peers are **exact** `3.28.0` on core and pm, matching the repo's pin precisely. Only runtime dep is
`marked@^17` (MIT, zero deps). ~26 KB gzip measured.

New `packages/ui/src/lib/markdown.ts` with `richTextToMarkdown` / `markdownToRichText`, plus the two
missing input rules (`# ` heading, `[text](url)` link) and `clipboardTextSerializer` + paste handling.

**Placement matters:** `packages/schema/src/rich-text/plaintext.ts` opens with a load-bearing comment —
it imports *nothing*, which is why it may live in schema. `@tiptap/markdown` imports core and pm, and
`apps/server` imports schema, so putting it there drags the whole TipTap graph into the server.
`check-boundaries.mjs` enforces only two rules and would **not** catch this.

### The finding that reshapes the change
**`@tiptap/markdown`'s serializer optimises for round-tripping through itself, not for portable output.**
Verified by running it: non-code text is HTML-entity-encoded, so `a < b & c` becomes `a &lt; b &amp; c` —
correct CommonMark, literal garbage pasted into Slack. And its escape set misses block-leading
characters, so a paragraph reading `# not a heading` serialises unescaped and **re-parses as a heading**.
Both live in private methods. For a feature whose entire value is symmetry, these are asymmetries.

### Non-goals
Not the export change — no `/export.md`, no `yapm backup`, no bulk. ROADMAP §Known gaps stays open; this
is a down payment because it builds and proves the serialiser. No markdown storage, no source mode.

---

## 3. `editor-rich-content`

### Scope
Catalog additions, all pinned **exactly** to `3.28.0` (never a caret — the mention/suggestion peer trap):
`@tiptap/extension-image`, `-table`, `-code-block`, `-code-block-lowlight`. Plus `lowlight@^3.3.0` and
`highlight.js@^11.11.1`.

`@tiptap/extension-code-block` must be declared **explicitly**, not inherited — `code-block-lowlight`
peer-requires it exactly and imports it at runtime, and under pnpm's strict layout it lives in
starter-kit's `node_modules`, not `packages/ui`'s.

**The slash menu is a sibling of the mention controller, not a generalisation of it.** `createSlashController`
with the same host interface, its own module-level `PluginKey`. Resist merging `MentionList` and
`SlashList` — the mention list carries eligibility state and "why not" copy the slash list has no use for.

Plus: walker cases in `plaintext.ts` for every new node, tokenized CSS for tables/code/images across
three themes light and dark, and the issue Files section.

### 🔴 The risk that must be decided before any code
**A stale tab erases images and tables.** The ProseMirror schema is versioned by the deployed bundle, not
the database. A client on the previous build has no `image` or `table` node type; TipTap **drops unknown
content on parse**, and the description's LWW autosave then writes the pruned document back. Two tabs
open across a deploy is enough. Nothing in the current design detects it.

This is a data-loss policy question, cheap now and expensive later — retrofitting means data already
gone. See "Needs a human" below.

### Non-goals
A different editor, block editor, drag handles or nested blocks — restated because
`@tiptap/extension-drag-handle` is MIT at 3.28 and looks tempting. Task lists. A `fileAttachment`
document node (files are DB rows, not document nodes).

### Also note
`highlight.js` is **BSD-3-Clause** — AGPL-compatible, but the first non-MIT/Apache runtime dependency in
the client bundle. Worth a line in the licence audit.

---

## Needs a human

1. **Schema-skew across a deploy** (change 3). Can a stale tab silently prune images and tables? Options:
   refuse the write when the loaded document contains node types the local schema lacks and show a
   "reload to edit" state, or accept the loss and ship faster. **Decide before writing code.**
2. **`Cache-Control` on the file routes** (change 1). `private, no-cache` + ETag re-checks permission on
   every view but pays a 304 per image — 20 thumbnails without a reverse proxy is a visible stutter.
   `private, max-age=300` renders instantly and accepts that a removed team member's browser can still
   paint already-fetched images for five minutes.
3. **What markdown does with a mention** (change 2). `@Display Name` is lossy but readable and matches
   what `renderText` and `richTextToPlainText` already do — and in-app copy/paste never touches markdown,
   since ProseMirror's `data-pm-slice` HTML flavour is already lossless. The alternative is a lossless
   custom syntax that is unreadable outside yapm.
