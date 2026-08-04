## Why

Text does not stay inside yapm. It arrives from a Slack thread, an AI answer, a GitHub issue body,
a `README`, and it leaves for a PR description, a chat message, a terminal. **Markdown is the
lingua franca of that traffic, and yapm currently speaks neither direction.**

Copy an issue description today and the clipboard receives ProseMirror's default text flavour —
`Slice.content.textBetween(…, '\n\n')` — which is prose with every structural signal deleted: a
heading becomes its own text, a bullet list becomes unprefixed lines, a link becomes its label and
the URL is *gone*. Paste `## Release plan` in from anywhere and yapm stores the literal characters
`## Release plan` in a paragraph. Both directions are silently lossy in the way that costs the most:
it looks like it worked.

This is the Linear model, and the maintainer has already settled it — **rich-text editing, TipTap
JSON as storage, markdown only ever the wire format.** No storage change, no source mode. It serves
VISION **#5 Your data is yours** (the no-lock-in promise is only verifiable if text can leave in a
format something else can read), **#1 Speed is the feature** (typing `# ` and having a heading
appear beats reaching for a toolbar), and **#2 Opinionated defaults, real escape hatches** (one
editor, one storage format, and an escape hatch at the clipboard rather than a mode switch).

It is also a **down payment on ROADMAP §Known gaps**. `yapm backup` and `/export.md` are still
unscheduled and stay that way — but they need exactly one thing that does not exist yet: a
serialiser whose output is correct *outside* yapm. This change builds that serialiser and proves it.

## What Changes

- **`richTextToMarkdown(doc, options)` and `markdownToRichText(md)`** in a new
  `packages/ui/src/lib/markdown.ts`, built on `@tiptap/markdown@3.28.0` (first-party, MIT, ~26 KB
  gzip, only runtime dep `marked@^17`) and on the *same* `createRichTextExtensions()` node set the
  editor and the read-only renderer already share. One definition of the document shape, three
  consumers.

- 🔴 **The library's serialiser is corrected before it is shipped, because it optimises for
  round-tripping through *itself* rather than for portable output.** Both defects were reproduced by
  running `MarkdownManager@3.28.0` against this repo's exact extension set, not read from docs:

  | Input document | 3.28.0 emits | Re-parses as | Verdict |
  |---|---|---|---|
  | paragraph `a < b & c` | `a &lt; b &amp; c` | `a < b & c` ✅ | correct CommonMark, **literal garbage** in Slack or a terminal |
  | paragraph `# not a heading` | `# not a heading` | **heading, level 1** ❌ | its escape set is ``\ ` * _ [ ] ~`` — no block-leading characters |
  | paragraph `- not a list` | `- not a list` | **bullet list** ❌ | same cause |
  | paragraph `1. not a list` | `1. not a list` | **ordered list** ❌ | same cause |
  | paragraph `> not a quote` | `&gt; not a quote` | `> not a quote` ✅ | **only** because defect 1 masks defect 2 |

  That last row is why the two cannot be fixed separately: **removing the entity encoding without
  adding block-leading escapes newly breaks `>`.** They ship as one correction, with the round-trip
  test that fails today.

- **Mentions export as `@Display Name`** — the maintainer's decision, and it *replaces* what 3.28.0
  does by default. Verified: the stock serialiser emits `[@ id="u1" label="Ada Lovelace"]`, which is
  precisely the lossless-but-unreadable custom syntax the decision rejects. Readable is the point;
  in-app copy/paste never touches markdown, because ProseMirror's `data-pm-slice` HTML flavour is
  already lossless. There is **no** name-matching on the way back in.

- **The two input rules StarterKit genuinely lacks**, established by reading the installed
  extensions rather than assuming. StarterKit 3.28 already ships `**bold**`, `*italic*`, `` `code` ``,
  `~~strike~~`, `- `, `1. `, `> `, ` ``` `, `---`, and heading rules — but its heading rule is
  generated from the configured `levels`, and this editor configures `[2, 3]`, so its regexes are
  `^#{2,2}\s$` and `^#{2,3}\s$`: **`# ` matches nothing.** And `@tiptap/extension-link` ships
  `addPasteRules` (bare URLs) and autolink but **no `addInputRules` at all**, so typing
  `[text](url)` produces literal text.
  - `# ` → heading level 2, the largest heading this editor has (design.md §D6).
  - `[text](url)` → a link mark, via `markInputRule` + `markPasteRule`.

- **Copy out is markdown.** A `clipboardTextSerializer` on the editor puts portable markdown on the
  `text/plain` flavour. The `text/html` flavour is untouched, so yapm→yapm paste stays byte-lossless
  and yapm→Google-Docs stays rich.

- **Paste in is markdown — plain-text paste only.** `handlePaste` converts markdown to rich text
  **only** when the clipboard carries no `text/html` flavour and the caret is not inside a code
  block or a code mark. Every other paste keeps today's behaviour exactly.

- **Heading levels are clamped on the way in.** `#### four` parses to `heading level 4`, which this
  schema does not have; TipTap drops unknown attrs and the paragraph's text with them. Levels above
  3 clamp to 3, level 1 maps to 2 — the same mapping the `# ` input rule uses, in the same table.

- **`scripts/check-boundaries.mjs` gains its third rule.** "Schema has no UI dependencies"
  (CLAUDE.md #3) has been a doc-level rule with no enforcement; this change is the one where getting
  it wrong is *tempting* — `plaintext.ts` is the obvious-looking home for a document walker and
  would have dragged the whole TipTap graph into `apps/server`. An absence is not self-enforcing.

## Capabilities

### New Capabilities

- `markdown-interchange`: markdown as yapm's text wire format and never its storage — the two
  conversion functions and where they may live; the portable-output contract (no HTML entities
  outside code, block-leading escapes so no paragraph re-parses as a block, code content verbatim);
  mentions as `@Display Name` with no name-matching inbound; heading-level clamping; and the
  round-trip fidelity guarantee over the current node set.

### Modified Capabilities

- `component-library`: the rich-text editor primitive gains the `# ` and `[text](url)` input rules,
  a markdown `text/plain` clipboard serialiser, and markdown paste handling — including the three
  cases where paste must *not* convert (an HTML flavour is present, the caret is in a code context,
  the text is not markdown). Stated alongside the existing mention-typeahead keyboard contract
  because they share one `editorProps` surface and one keydown path.

## Impact

- **UI** (`packages/ui`): new `src/lib/markdown.ts` (the two conversion functions, the portable-text
  correction, the mention pre-resolution walk, the heading clamp) and `src/lib/markdown.test.ts`.
  `src/components/rich-text.tsx` gains a small `Extension` carrying the two input rules and the
  `editorProps.clipboardTextSerializer` / `editorProps.handlePaste` wiring, plus a
  `markdown.editor.test.tsx` jsdom test. One new dependency entry.
- **Schema** (`packages/schema`): **none, asserted rather than assumed.** No migration, no Zero
  schema change, no mutator change; `richTextSchema` (`zero/mutators.ts:92`) and the `jsonb` columns
  are untouched, and `rich-text/plaintext.ts` keeps its zero imports.
- **Server** (`apps/server`): **none.** No route, no bundle change — which is the whole reason
  placement matters.
- **Web** (`apps/web`): **none.** Both the description editor and the comment composer get the
  behaviour from the shared primitive.
- **Dependencies**: one catalog entry, `'@tiptap/markdown': 3.28.0` — **exact, never a caret**. Its
  peers are exact `@tiptap/core: 3.28.0` and `@tiptap/pm: 3.28.0`, precisely what this repo already
  resolves, so the graph does not move. `reference/frontend-build.md` §11.1's pin-the-whole-graph
  rule goes from five entries to six. `marked@^17` arrives transitively (MIT, zero deps) and gets no
  catalog entry of its own.
- **Tooling**: `scripts/check-boundaries.mjs` — a third rule banning UI/editor imports from
  `packages/schema`, with `packages/schema/src/rich-text/plaintext.ts` as the reason in the message.
- **Docs:** `apps/docs/src/content/docs/features/markdown.md` (new — what converts, what the
  shortcuts are, what a mention becomes, and the honest list of what markdown cannot carry),
  `apps/docs/astro.config.mjs` (one sidebar entry), `README.md` ("What works today"),
  `ROADMAP.md` (row 16 → shipped; §Known gaps restated so "export" stays open and is not read as
  closed by this change), `TECHSTACK.md` (line 74 — five catalog entries become six, and the
  serialiser correction named so nobody "cleans it up"), and **`reference/frontend-build.md` §11**
  (a new §11.6 recording the two serialiser defects, the private method the correction attaches to,
  and the fact that `@tiptap/core` 3.28 — not the markdown package — is what declares
  `markdownName` / `renderMarkdown` on `NodeConfig`). `.env.example` is deliberately untouched, and
  that is asserted.

## Non-goals

- **Any export surface.** No `/api/v1/**/export.md`, no `yapm backup`, no zip, no bulk, no CLI, no
  server-side markdown rendering. ROADMAP §Known gaps stays open and this change says so in the
  ROADMAP edit. The seam is left; none of it is built.
- **Markdown as storage.** `richTextSchema`, the `jsonb` columns, the Zero schema and the mutators
  are untouched. Markdown exists only in the clipboard and in a pure function.
- **A markdown source mode, split-pane preview, or "edit as markdown" toggle.** Linear has none, and
  the mode switch is where a rich-text editor starts becoming two editors.
- **New node types.** Images, tables and code-block languages are change 17 (`editor-rich-content`),
  which extends this serialiser at the extension point design.md §D8 names.
- **A lossless mention syntax.** Explicitly refused: unreadable outside yapm defeats the point of
  markdown. See design.md §D3 for the round-trip loss this accepts and why it is safe.
- **Name-matching `@Somebody` on paste.** Turning text into a mention that notifies a person is not
  something a paste may do silently, and a wrong match notifies the wrong colleague.
- **Converting pasted HTML through markdown.** ProseMirror's HTML parse path is richer and already
  correct; markdown conversion runs only when there is no HTML flavour.
- **Round-tripping the things markdown cannot carry.** Underline has no CommonMark syntax; nested
  mark ordering and hard breaks normalise. Documented in the feature page, not papered over.
