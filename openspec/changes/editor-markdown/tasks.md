Sequenced so the app runs after every task and nothing in an earlier group depends on a later one:
the dependency and the boundary rule (1) land before any code that could violate either; the pure
conversion core (2) before the editor that calls it (4); the falsifiable check (3) immediately after
the core, so the serialiser is **proven before it is wired to a surface** — that ordering is the
point of the change, not a preference.

## 1. The pin and the boundary it depends on

- [x] 1.1 Add `'@tiptap/markdown': 3.28.0` to the catalog in `pnpm-workspace.yaml`, inside the
      existing TipTap block and under the comment that explains the exact-pin rule. **Exact, never a
      caret.** Add `"@tiptap/markdown": "catalog:"` to `packages/ui/package.json` dependencies.
      `pnpm install`.
- [x] 1.2 Verify the graph did not split: exactly one `@tiptap+core@3.28.0*` and one
      `@tiptap+pm@3.28.0*` directory in `node_modules/.pnpm`. Record the counts. A split here is a
      runtime `RangeError` that typecheck and build both pass.
- [x] 1.3 Add the third rule to `scripts/check-boundaries.mjs`: no file under `packages/schema/` may
      import `@tiptap/*`, `@yapm/ui`, `react`, `react-dom`, `@base-ui/react`, `lucide-react` or
      `@floating-ui/*`. Match the existing `from '<pkg>'` / `from '<pkg>/…'` style; no AST, no new
      dependency. The violation message names `packages/schema/src/rich-text/plaintext.ts` and why it
      imports nothing, so whoever trips the rule reads the reason instead of deleting it. Update the
      script's success line to mention three rules.
- [x] 1.4 **Test (unit, no DB)** Prove rule 3 fires: temporarily add `import '@tiptap/core'` to a
      scratch file under `packages/schema/src/`, confirm `node scripts/check-boundaries.mjs` exits
      non-zero naming that file, then delete the scratch file and confirm it exits zero again. Record
      both outputs in design.md's implementation log — this rule has no unit test of its own, so the
      evidence that it works is the evidence.

## 2. The conversion core — `packages/ui/src/lib/markdown.ts`, no editor required

- [x] 2.1 Create `packages/ui/src/lib/markdown.ts`. Import `MarkdownManager` from `@tiptap/markdown`
      and `resolveExtensions` / `getSchema` / `JSONContent` from **`@tiptap/react`** — `@tiptap/core`
      is a peer and is not resolvable from `packages/ui` (`reference/frontend-build.md` §11.1).
      Build one lazily-constructed module-level manager from
      `resolveExtensions(createRichTextExtensions())`.
- [x] 2.2 Implement `installPortableTextEncoding(manager)`: replace the manager's
      `encodeTextForMarkdown` with a total function per design.md §D4/§D5 — verbatim inside a code
      context (parent `codeBlock`, or a `code` mark on the node), otherwise the inline escape set
      with **no HTML entity encoding**, plus the block-leading escapes when the node is the first
      child of a `paragraph`. Ordered-list escaping is `1\.`, not `\1.`. Throw with the method name
      if the hook is missing, so a version bump fails at construction rather than silently.
- [x] 2.3 Implement `normalizeForMarkdown(doc, resolveMentionName)` — the pure pre-walk: a mention
      node becomes a text node `@` + (live name ?? stored label), contributing **nothing** when
      neither resolves (mirroring `richTextToPlainText`); an `underline` mark is stripped and its
      text kept; every other node recurses unchanged. This is the extension point change 17 extends —
      say so in a comment naming the change, not the mechanism.
- [x] 2.4 Implement `richTextToMarkdown(doc, options?)`: normalise, then serialise, then trim the
      trailing newline. `null`/`undefined`/an empty document returns `''`.
- [x] 2.5 Implement `markdownToRichText(md)`: parse, clamp heading levels per design.md §D6's table,
      return `EMPTY_DOC` when the parse yields no content. Export both functions plus the options
      type; add nothing to `packages/schema`.
- [x] 2.6 Run `node scripts/check-boundaries.mjs` and `pnpm --filter @yapm/ui typecheck`.

## 3. The falsifiable check, before anything is wired to a surface

- [x] 3.1 **Test (unit, no DB)** `packages/ui/src/lib/markdown.test.ts` — the round trip that fails
      on `main` and fails against the uncorrected library:
      a document of two paragraphs, `a < b & c` and `# not a heading`, serialises to
      `"a < b & c\n\n\\# not a heading"` (asserted as an exact string — no entity, the `#` escaped)
      and parses back to the same document.
- [x] 3.2 **Test (unit, no DB)** The escape table row by row (design.md §D5): leading `#`, `-`, `+`,
      `*`, `>`, `|`, `1.`, `1)`, `---`, `===`, a fence, and 4+ leading spaces — each asserted on the
      emitted string **and** on the re-parsed document. Include the two that only fail together:
      `> not a quote` and `a < b & c` in the same test, so nobody re-introduces entity encoding to
      "fix" `>`.
- [x] 3.3 **Test (unit, no DB)** Code is verbatim: a code block and an inline code span both
      containing `if (a < b && c) {}` emit byte-identical code, no escapes, no entities.
- [x] 3.4 **Test (unit, no DB)** Round trip over the whole supported node set — bold, italic, strike,
      inline code, links, headings 2 and 3, bullet and ordered lists including one nested level,
      blockquote, code block with a language, horizontal rule, hard break, nested marks — compared
      **after normalising both sides through `getSchema(createRichTextExtensions())`**
      (`Node.fromJSON(schema, doc).toJSON()`), per design.md §D7. Raw JSON equality would fail on
      schema defaults, not on losses.
- [x] 3.5 **Test (unit, no DB)** Mentions: a resolved mention emits `@Ada Lovelace`; an unresolved one
      with a stored label falls back to it; one with neither emits nothing (not `@`); the output
      contains no `id=` / `label=` attribute syntax — assert that explicitly, because it is what
      3.28.0 emits by default. And `markdownToRichText('@Ada Lovelace')` produces **no** mention node.
- [x] 3.6 **Test (unit, no DB)** Heading clamp: `# `, `## `, `### `, `#### `, `###### ` produce only
      levels 2 and 3. Empty string produces `EMPTY_DOC`. Underline is stripped and its text kept.

## 4. The editor surface — `packages/ui/src/components/rich-text.tsx`

- [x] 4.1 Add a `markdownShortcuts` extension in `rich-text.tsx` (or a sibling module if it earns
      one): `textblockTypeInputRule` for `^#\s$` → heading level 2, and `markInputRule` +
      `markPasteRule` for `[text](url)` → the link mark, both imported from `@tiptap/react`. Include
      it in `createRichTextExtensions()` so the read-only renderer's node set stays identical to the
      editor's.
- [x] 4.2 Add `editorProps.clipboardTextSerializer`: build a document from the slice's fragment —
      wrapping bare inline content in a paragraph — and return `richTextToMarkdown` of it, with the
      component's existing mention-name lookup as the resolver. Leave `clipboardSerializer`
      (the HTML flavour) alone.
- [x] 4.3 Add `editorProps.handlePaste` implementing design.md §D10's three refusals: an HTML flavour
      present, a code context at the caret, or a conversion that changes nothing. On conversion,
      insert the parsed content as one transaction so a single undo restores the pre-paste document.
- [x] 4.4 Confirm the mention typeahead's keyboard contract is untouched: `handleRichTextKeyDown`,
      the consumed-event identity check and `exitSuggestion` behave exactly as before. Paste and copy
      add no keydown handling.

## 5. Editor-level tests

- [x] 5.1 **Test (unit, jsdom)** `packages/ui/src/components/markdown-editor.test.tsx` with the
      `@vitest-environment jsdom` docblock (the convention `packages/ui/vitest.config.ts` documents):
      typing `# ` produces a level-2 heading; typing `[yapm](https://yapm.dev)` produces a link with
      that href; neither fires inside a code block.
- [x] 5.2 **Test (unit, jsdom)** `clipboardTextSerializer` over a full-document selection and over a
      partial selection, asserting the markdown string in both.
- [x] 5.3 **Test (unit, jsdom)** All **four** paste refusals (§D10's three plus I3's) and the
      conversion case: plain-text markdown converts; the same text with an HTML flavour present does
      not; the same text with the caret in a code block or under a code mark does not; a bare URL
      over a non-empty selection does not, and the link extension then links it.
      ⚠️ **Not** a real `ClipboardEvent`/`DataTransfer` as this task originally said — jsdom
      implements neither (both `undefined`; verified). The handler is called with a clipboard object
      of the same shape and the `Slice` `prosemirror-view` would have parsed, through
      `view.props.handlePaste` and `view.someProp` — the two entry points the real paste path uses.
      Logged as I6.
- [x] 5.4 **Test (unit, jsdom)** One paste, one undo, and the document equals its pre-paste state.

## 6. Documentation

- [x] 6.1 New `apps/docs/src/content/docs/features/markdown.md`: the shortcut table (including which
      ones already existed), what copy-out produces, what paste-in converts and the three times it
      deliberately does not, what a mention becomes and why it does not come back, and an honest
      "what markdown cannot carry" list (underline, mention identity, leading indentation). Add the
      sidebar entry to `apps/docs/astro.config.mjs`.
- [x] 6.2 `reference/frontend-build.md` §11: update §11.1 to six catalog entries, and add **§11.6** —
      the two verified serialiser defects with their probe output, the single private method the
      correction attaches to and why (with the rejected alternatives in one line each), the fact that
      `@tiptap/core` 3.28 (not the markdown package) declares `markdownName` / `renderMarkdown` on
      `NodeConfig`, and that `resolveExtensions` / `getSchema` / the input-rule helpers all come from
      `@tiptap/react`'s `export * from '@tiptap/core'`.
- [x] 6.3 `TECHSTACK.md` line 74: five catalog entries become six, naming `@tiptap/markdown` and the
      serialiser correction so it is not "cleaned up" by a later reader. `README.md`: one line in
      "What works today".
- [x] 6.4 `ROADMAP.md`: row 16 → shipped, and restate §Known gaps so **export stays open** — this
      change built the serialiser the export change needs and shipped none of the export surface.
- [x] 6.5 Assert, do not assume: `.env.example`, `packages/schema/**` and `apps/server/**` are
      untouched by this change. `git diff --stat` is the evidence.

## 7. Verification

- [ ] 7.1 `pnpm turbo lint typecheck test build` clean from the repo root. Report actual output.
- [x] 7.2 `pnpm --filter @yapm/docs build` clean.
- [ ] 7.3 Manual, in a real browser (the thing jsdom cannot prove): copy a description containing a
      heading, a list, a link, a mention and `a < b & c` into a plain-text target and read it; paste
      markdown back in from the same plain text and confirm the document matches. Record the result
      in design.md's implementation log.
- [ ] 7.4 Bundle sanity: `apps/web`'s built client grows by roughly the measured ~26 KB gzip and no
      more. A larger jump means the graph split or the serialiser reached a surface it should not
      have.
- [x] 7.5 Review fix pass, round 1 → design.md I9–I13: raw HTML refused in the parse (and no mention
      node from pasted text), block-leading escapes de-indent first, a heading's trailing hash run
      escaped, a code block's fence sized to its content, copy-out wired into `RichTextRenderer`,
      and the boundary matcher extracted with fixture tests (`prosemirror-*` added, dynamic
      `import()`/`require()` no longer evade rule 3). Fast gates re-run:
      `pnpm turbo run typecheck --filter=...[origin/main]`, `pnpm lint`,
      `pnpm turbo run test --filter=...[origin/main]`, `node scripts/check-boundaries.mjs`,
      `node --test scripts/lib/*.test.mjs`. Build, e2e and the compose smoke test are CI's, per
      PROCESS.md §4.
