Sequenced so the app runs after every task, and so nothing in an earlier group depends on a later
one: dependencies (1) before anything imports them; **the schema-skew guard (2) before the first new
node type (3)**, because retrofitting it means the data is already gone; the walker and serialiser
cases (4) with the node types that need them, never after; the blocked state (5) once the detector
exists; the second suggestion surface (6) once there are blocks to insert; uploads (7) before the
Files section (8) that lists what they produce; tokens and CSS (9) last of the build, so every
surface that needs a token exists to be styled. Tests (10) and documentation (11) are the close
phase's.

`apps/server`'s SHIPPED SOURCE is untouched by this change. If a task here edits it, the task is
wrong — assert it in 12.3 rather than assuming it. The one exception is the capability-at-rest guard
test, which names the directories this change writes into and was pointing at one that never
existed; see §I22.

## 1. Dependencies

- [x] 1.1 Add six entries to the `catalog:` block in `pnpm-workspace.yaml`, alphabetical, each with
      a one-line CLAUDE.md §5 justification: `'@tiptap/extension-code-block': 3.28.0`,
      `'@tiptap/extension-code-block-lowlight': 3.28.0`, `'@tiptap/extension-image': 3.28.0`,
      `'@tiptap/extension-table': 3.28.0`, `'highlight.js': ^11.11.1`, `lowlight: ^3.3.0`.
      **Exact, never a caret, on all four TipTap entries** — their peers on `@tiptap/core` and
      `@tiptap/pm` are exact and a split resolution is a runtime failure that passes typecheck.
      Note in the comment that `highlight.js` is BSD-3-Clause.
- [x] 1.2 Add all six to `packages/ui/package.json` as `catalog:`. **`@tiptap/extension-code-block`
      is declared explicitly**, not left to StarterKit: `code-block-lowlight` peer-requires it
      exactly and imports it at runtime, and under pnpm's strict layout it would otherwise resolve
      inside starter-kit's `node_modules` and duplicate `prosemirror-model`. Run
      `node scripts/check-catalog.mjs`.
- [x] 1.3 `pnpm install`, then verify the graph did not split the way `editor-markdown` §"Evidence"
      did: `ls node_modules/.pnpm | grep -E '^@tiptap\+(core|pm)@'` must show exactly one of each.
      Record the actual output in design.md §"Decisions made during implementation".

## 2. 🔴 The schema-skew guard — before any new node type

- [x] 2.1 Create `packages/schema/src/rich-text/schema-version.ts`. **It imports nothing**, for the
      reason `plaintext.ts` states in its header comment — copy that constraint into this file's
      header. Export `RICH_TEXT_SCHEMA_VERSION = 2`, `RICH_TEXT_SCHEMA_VERSION_ATTR = 'schemaVersion'`,
      a `RichTextSkew` result type, and a pure
      `detectRichTextSkew(doc, { knownNodeTypes, knownMarkTypes }): RichTextSkew` that walks the raw
      JSON collecting every unrecognised `type` on a node and on a mark, and separately compares
      `doc.attrs.schemaVersion` (absent ⇒ 1) against `RICH_TEXT_SCHEMA_VERSION`. Total on malformed
      input, like the rest of the file's neighbours: anything unwalkable contributes nothing rather
      than throwing.
- [x] 2.2 Stamp the version in `sanitizeRichText` (`plaintext.ts`): the returned doc's `attrs` gain
      `schemaVersion: RICH_TEXT_SCHEMA_VERSION`. Pure, deterministic, mints nothing — it must
      produce the identical document on the optimistic and the authoritative pass, which is the
      property that keeps rebase from visibly rewriting the user's text. Confirm the existing
      `sanitizeRichText` tests still pass and update the ones that assert an exact document.
- [x] 2.3 Export `schema-version.ts` from `packages/schema/src/rich-text/`'s barrel and from the
      package's `@yapm/schema` subpath exactly as `plaintext.ts` is exported. Run
      `node scripts/check-boundaries.mjs` — the new file must not trip rule 3.
- [x] 2.4 **Test (unit)** `packages/schema/src/rich-text/schema-version.test.ts`: an unknown node
      type is reported; an unknown mark type is reported; a document naming only known types with no
      stamp is clean; a stamp above the constant is reported even when every type is known; a stamp
      equal to or below it is clean; malformed input (a string, `null`, a cyclic-free but weirdly
      shaped object) returns clean rather than throwing; `sanitizeRichText` stamps and is idempotent.

## 3. The three node types

- [x] 3.1 Read the installed `.d.ts` for all four new packages in `node_modules` **before writing
      any of this group**. Record in design.md §"Decisions made during implementation" the actual
      exported names and option shapes for `@tiptap/extension-table` (is it `Table` + `TableRow` +
      `TableHeader` + `TableCell`, a `TableKit`, or both? what is the resizing option called?) and
      for `@tiptap/extension-code-block-lowlight` (option name for the lowlight instance). Do not
      write these from memory — 3.28 postdates the model's training data.
- [x] 3.2 Add the image node to `createRichTextExtensions()` in `packages/ui/src/components/rich-text.tsx`:
      `Image.extend(...)` keeping the name `image`, with attributes exactly `attachmentId` (string,
      required), `alt` (string, default `''`) and `width` (`'small' | 'medium' | 'full'`, default
      `'full'`). **`parseHTML: () => []`** so no pasted `<img>` becomes an image node, and a
      `renderHTML` that emits `<img>` only when a resolver is supplied. Add
      `resolveAttachmentSrc?: (attachmentId: string, variant: 'thumb' | 'full') => string` to
      `RichTextExtensionOptions` and thread it through `RichTextEditor` and `RichTextRenderer` props.
- [x] 3.3 Harden `sanitizeRichText` for image nodes: drop every attribute outside the permitted three
      and reject any URL-shaped value (`/^\s*[a-z][a-z0-9+.-]*:|^\/\//i`). This runs on the
      authoritative pass, so it is what makes "no URL is ever stored" true rather than merely
      intended. **Test (unit)** in the existing `plaintext.test.ts`.
- [x] 3.4 Add a React node view for the image (`packages/ui/src/components/image-node.tsx`):
      `NodeViewWrapper`, `contentEditable={false}`, `loading="lazy"`, `decoding="async"`, alt text on
      the `<img>` and on the wrapper's `aria-label`, a visible selected outline driven by
      ProseMirror's `selected` prop (not colour alone), and the alt-text placeholder branch when no
      resolver is supplied.
- [x] 3.5 Add the table nodes with a header row and **`resizable` off** (D3). Confirm `Gapcursor` is
      actually in the configured StarterKit rather than assuming it — the arrow-key exit from a table
      depends on it. Verify `goToNextCell` is the Tab binding the extension ships and that it is not
      shadowed by anything already bound.
- [x] 3.6 Replace the code block: `StarterKit.configure({ codeBlock: false })` plus
      `CodeBlockLowlight` over a `createLowlight()` instance registering exactly the curated language
      list in design §D4. **Move `codeBlockToMarkdown` onto the new extension** — it is the shipped
      fix for a code block containing its own fence and its round-trip test will fail if it is
      dropped. Delete `PortableStarterKit`'s now-empty `addExtensions` override if nothing else needs
      it.
- [x] 3.7 Add a language selector to the code block's node view, listing only registered languages
      plus plain text, as a native `<select>` with an accessible name.
- [ ] 3.8 Verify in a real browser (not jsdom) that an editor with all three node types constructs,
      that `prosemirror-model` is loaded exactly once, and that a document holding all three
      round-trips through `RichTextRenderer` unchanged. jsdom will not catch a duplicated
      `prosemirror-model`.

## 4. Walker and serialiser cases — with the node types, never after

- [x] 4.1 Add walker cases to `packages/schema/src/rich-text/plaintext.ts` per design §D9: `image`
      contributes its trimmed, length-bounded `alt` (nothing when empty); the table node family
      separates cells within a row and rows from one another; `codeBlock` is confirmed correct by
      default and gets a comment saying so, so a later refactor of the default does not silently
      change it. Keep the file's zero imports.
- [x] 4.2 Add `renderMarkdown` cases (design §D8) on the new extensions in
      `packages/ui/src/lib/markdown.ts`'s node set — **on the extension configs, not in the manager**;
      `@tiptap/core` 3.28 declares `renderMarkdown` on `NodeConfig`, so this is additive. Table →
      GFM pipe table with `|` escaped in cells; image → `![alt](<resolved path>)`; code block keeps
      the content-dependent fence and gains its language.
- [x] 4.3 Add the inbound coercions in `markdownToRichText`'s `coerceInbound`: an inbound `image`
      node degrades to a link labelled with its alt (design §D8 — an image node names an attachment
      row, and a pasted URL names nothing this instance owns); an inbound code block's language is
      coerced to a registered language or `plaintext`; a table passes through.
- [x] 4.4 Confirm the shipped inline-code-span characterisation test (`editor-markdown` §I7) is still
      green and unchanged. It documents an unfixed defect on purpose; this change neither fixes nor
      breaks it.

## 5. The blocked "reload to edit" state

- [x] 5.1 In `packages/ui/src/components/rich-text.tsx`, derive the known-type sets **once** from
      `getSchema(createRichTextExtensions())` — `Object.keys(schema.nodes)` and
      `Object.keys(schema.marks)` — never a hand-written list.
- [x] 5.2 In `RichTextEditor`, run `detectRichTextSkew` on `defaultValue` before constructing the
      editor. Blocked ⇒ render a non-editable `RichTextRenderer` over the value plus a banner
      (`role="status"`, the reason, and a `Reload` button calling `location.reload()`), and wire
      **neither** `onChange` nor `onSubmit`. Structural, not a flag: there must be no editable editor
      instance in that branch.
- [x] 5.3 Show the same notice (without the reload button) in `RichTextRenderer` when the value is
      blocked, so a reader is not silently missing content.
- [x] 5.4 Add a `rich-text.stories.tsx` story for the blocked state so it is visible in the themed
      showcase across every preset.

## 6. The insert menu

- [x] 6.1 Add `export const SLASH_PLUGIN_KEY = new PluginKey('yapm-slash')` at module level beside
      `MENTION_PLUGIN_KEY`, and `createSlashController(host)` with the same host interface as
      `createMentionController` — including `consume(event)`. **Read the Escape handling around
      `handleRichTextKeyDown` and `MentionHost.consume` first**: the `consumed`-identity mechanism,
      not `defaultPrevented`, is what keeps Escape from discarding the draft, and a second
      suggestion plugin is exactly what could regress it.
- [x] 6.2 Register the slash suggestion as a second entry in the mention extension's `suggestions`
      array (it is array-shaped for exactly this), or as its own `Suggestion`-carrying extension if
      reading the installed `.d.ts` shows the array is mention-node-specific. Whichever is true, say
      which in the implementation log.
- [x] 6.3 Create `packages/ui/src/components/slash-list.tsx` — a **separate** component from
      `MentionList` (design §D6). Extract only the pure roving-index helper as shared code. Listbox
      semantics, `aria-activedescendant` on the editable, a persistent polite status region, and a
      per-row disabled state for a command that cannot apply here.
- [x] 6.4 Define the command list: Heading 2, Heading 3, Bullet list, Numbered list, Quote, Code
      block, Table, Image, Divider — each with `title`, `keywords`, icon, `enabled(editor)` and a
      `run(editor, range)` that deletes the trigger range and applies the command in **one**
      transaction so one Cmd+Z undoes the whole insertion.
- [x] 6.5 Gate the trigger: only at the start of a textblock or after whitespace, never inside a code
      block, an inline code mark, or where a block insert is illegal.
- [x] 6.6 Add table structure controls to the editor toolbar, shown when `editor.isActive('table')`:
      add/delete row, add/delete column, delete table, toggle header row — real buttons with
      `aria-label`s. Add alt-text and remove controls shown when an image node is selected.

## 7. Uploading from the editor

- [x] 7.1 Add `onUploadImage?: (file: File) => Promise<{ attachmentId: string } | { error: string }>`
      to `RichTextEditorProps`. `packages/ui` performs no fetch and knows no API path.
- [x] 7.2 Wire the three triggers: the `/image` command (file picker), paste of an image blob, drop
      of an image file. A drop of a non-image file is **not** handled by the editor.
- [x] 7.3 Show upload progress as a ProseMirror **decoration**, not a node (design §D10): nothing
      enters the document until the bytes are stored, so a failed upload cannot leave a node naming
      an attachment that does not exist. On failure the decoration is replaced by an inline error
      naming the reason.
- [x] 7.4 Create `apps/web/src/issues/attachments/upload.ts`: multipart `POST /api/v1/files` with
      `teamId` and `issueId`, `credentials: 'include'`, mapping `413` and the standard byte-identical
      refusal to human copy. Pass `resolveAttachmentSrc` and `onUploadImage` into the description
      editor and the comment composer from `issue-detail.tsx`.

## 8. The Files section

- [x] 8.1 Add a `Files` section to `apps/web/src/issues/issue-detail.tsx` reading the existing
      `attachments.byIssue` synced query — no new query, no new mutator, no ZQL outside
      `packages/schema`.
- [x] 8.2 Create the list component: filename, size, uploader, relative time, a download link to
      `/api/v1/files/<id>`, and a remove button for `canWrite` that calls
      `DELETE /api/v1/files/<id>` with a confirm. Keyboard-navigable rows; each control has an
      accessible name identifying its file. Quiet empty state with an upload control.
- [x] 8.3 Confirm a `viewer` sees downloads and no remove affordance, and that a non-member's query
      is empty (the scoping is already proven by `queries.attachments.pg.test.ts`; this is a UI
      assertion, not a re-proof).

## 9. Tokens and CSS

- [x] 9.1 Add the `--code-*` family — `keyword`, `string`, `number`, `comment`, `function`, `type`,
      `punctuation` — to all six theme blocks in `packages/ui/src/styles/globals.css`, derived from
      each preset's existing hues rather than invented, each ≥ 4.5:1 against that preset's
      `--bg-hover`.
- [x] 9.2 Map the `hljs-*` classes to those tokens in one block. Load **no** `highlight.js`
      stylesheet. Unmapped classes inherit `--text-1` so an unmapped token is plain, never invisible.
- [x] 9.3 Add table, code-block and image rules to the editor's `contentClass`, strictly tokenized:
      table borders and header surface, code-block surface and padding, image max-width and selected
      outline using the focus-ring token.
- [x] 9.4 Extend `packages/ui/src/styles/contrast.test.ts` to assert every `--code-*` token in every
      preset, light and dark, against `--bg-hover`.

## 10. Tests

- [x] 10.1 **Test (unit) — the falsifiable check.** `packages/ui/src/components/rich-text.skew.test.tsx`
      (jsdom): (a) build a real `Editor` over an extension set with the image and table extensions
      **removed** and load a document containing both — assert TipTap really does prune them, so the
      hazard is demonstrated rather than asserted; (b) `detectRichTextSkew` reports that document
      blocked against those known-type sets; (c) `RichTextEditor` given a document holding an unknown
      node type renders the blocked state, exposes no editable region, and fires no `onChange` after
      simulated input. All three legs must fail against `origin/main`.
- [x] 10.2 **Test (unit)** the slash menu in `packages/ui`: `/` opens at the start of a paragraph and
      does not open mid-word, in a code block or in a code mark; arrow keys move the active option;
      Enter inserts in one transaction that a single undo reverses; a disabled command does not
      insert. Remember the jsdom stubs `editor-markdown` recorded — `Range.prototype.getClientRects`,
      `getBoundingClientRect` and `Element.prototype.scrollIntoView`.
- [x] 10.3 **Test (unit) — the Escape regression.** With the slash menu open, Escape closes the menu,
      `onCancel` is **not** called, and the draft survives; with no popup open, Escape still calls
      `onCancel`; the mention popup's existing behaviour is unchanged. Falsify it by removing
      `host.consume` from the slash controller and confirm it fails.
- [x] 10.4 **Test (unit)** markdown round-trips for all three node types, including a `|` inside a
      cell, a code block containing its own fence, an image with and without alt, and the inbound
      cases: `![](url)` becomes a link, a GFM table becomes a table, an unregistered fence language
      coerces.
- [x] 10.5 **Test (unit)** the plaintext walker: an image's alt is projected, table cells do not weld
      together, a mention inside a table cell is still extracted by `extractMentionIds`.
- [x] 10.6 **Test (unit)** `contrast.test.ts` covers the new tokens (this is 9.4; listed here so the
      close phase does not skip it).
- [x] 10.7 **Test (e2e)** `apps/web/e2e/rich-content.spec.ts` — the change touches a mutator
      (`sanitizeRichText`) and signature UI, which is 2 of PROCESS §3's four, so all three tiers
      apply. Keyboard-only: open the insert menu, insert a table, Tab between cells, Escape without
      losing the draft; and an image upload through the real multipart route appearing both in the
      document and in the Files section. Note `attachments` §I10: this harness runs the server on the
      host, not the runtime image.
- [x] 10.8 Falsify at least three of the new tests by reverting the code they cover, and record which
      assertions fail in design.md §"Decisions made during implementation". A test that cannot fail
      is not a test.

## 11. Documentation

- [x] 11.1 `apps/docs/src/content/docs/features/rich-text.md` (new): images, tables, code blocks, the
      insert menu, keyboard shortcuts for each, and an honest section on the "reload to edit" state —
      what causes it, why it exists, and that the deploy which introduced it has a one-window
      exposure the guard cannot cover. Add the sidebar entry in `apps/docs/astro.config.mjs` **and
      the Features bullet in `apps/docs/src/content/docs/index.md`**, in sidebar order — every
      feature change before this one added one, and the close gate only covers pages it is told
      about.
- [x] 11.2 `apps/docs/src/content/docs/features/markdown.md`: add the new node rows to the "what
      markdown carries" and "what markdown cannot carry" tables — GFM table, image path, code fence
      language; block content inside a table cell flattens.
- [x] 11.3 `apps/docs/src/content/docs/self-hosting/attachments.md`: the editor upload path and the
      Files section now exist; the operator-facing GC and backup story is unchanged and says so.
- [x] 11.4 `README.md` "What works today" and `ROADMAP.md` (row 18 → shipped, and the editor gap
      closed without implying export is).
- [x] 11.5 `TECHSTACK.md`: six new catalog entries and the **BSD-3-Clause** line for `highlight.js` —
      the first non-MIT/Apache runtime dependency in the client bundle.
- [x] 11.6 `reference/frontend-build.md` §11.7 (new): the verified exports and option shapes of the
      four extensions as read from the installed `.d.ts`, the curated language list and why it is not
      `common`, and the schema-skew mechanism with the reason the stamp lives in the sanitizer.
- [x] 11.7 Walk all ten CLAUDE.md constraints and record the verdict for each in design.md, the way
      `attachments` §I11 did — do not assume none moved.

## 12. Verification

- [ ] 12.1 `pnpm turbo lint typecheck test build` with the actual output reported. Tests need live
      Postgres: `POSTGRES_HOST_PORT=5449 ZERO_CACHE_HOST_PORT=4857 YAPM_HOST_PORT=3009 docker compose -p yapm-rc -f docker/docker-compose.dev.yml up -d`,
      torn down with the matching `down -v`.
- [x] 12.2 Measure the client bundle delta from `lowlight` + `highlight.js` + the three extensions and
      record it. If it is over budget, shrink the language list — the design does not change.
- [x] 12.3 Assert the untouched surfaces:
      `git diff --stat origin/main -- apps/server packages/schema/src/migrations packages/schema/src/zero`
      should show nothing **except `apps/server/src/storage/no-capability.test.ts`**, whose rule (c)
      pointed at a directory this change was expected to create and did not — see §I22. No shipped
      server source, no migration, no Zero schema change, no new synced query, no new mutator.
- [x] 12.4 Manual check in a real browser, because jsdom cannot see it: with the mention popup and
      the insert menu both reachable in one comment composer, Escape from each dismisses only that
      popup and never discards the draft.
