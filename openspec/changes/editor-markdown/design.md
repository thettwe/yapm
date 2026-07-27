# Design — editor-markdown

## Context

Markdown is the interchange format, never the storage format. TipTap JSON stays in the `jsonb`
columns; markdown exists in exactly two places — the `text/plain` clipboard flavour, and a pure
function that produces or consumes it. Nothing in `packages/schema` moves, and nothing about sync
changes.

Everything below marked **verified** was produced by running `@tiptap/markdown@3.28.0`'s
`MarkdownManager` against this repo's exact extension set
(`StarterKit.configure({ heading: { levels: [2, 3] } })` + the configured `Mention`) in Node, not
read from documentation. The probe transcripts are reproduced inline because two of the findings
contradict what the change was scoped against.

---

## D1 — `packages/ui/src/lib/markdown.ts`, and the reason it is not `packages/schema`

`packages/schema/src/rich-text/plaintext.ts` opens with a load-bearing comment: it imports
**nothing**, and that is why it is allowed to live in schema. It is also the obvious-looking home for
"another function that walks a rich-text document", which is exactly the trap.

`@tiptap/markdown` imports `@tiptap/core` and `@tiptap/pm`; `apps/server` imports `@yapm/schema`.
Putting the serialiser in schema pulls the entire TipTap graph — ProseMirror model, view, transform,
`marked` — into the server bundle, for a package the server has no editor to run.

`packages/ui` already owns every TipTap dependency and already owns `createRichTextExtensions()`,
the single definition of this editor's node set — which is precisely the input `MarkdownManager`
needs. The serialiser therefore cannot drift from the editor: they are constructed from the same
call.

**Consequence for the export change later:** a future `/export.md` or `yapm backup` runs on the
server and cannot import `packages/ui`. That is a real constraint and it is the right one — see D8.

## D2 — CLAUDE.md #3 becomes mechanical (`scripts/check-boundaries.mjs`, third rule)

The script enforces exactly two rules today: no `packages/*` → `apps/*` import, and no Zero
definition API outside `packages/schema`. **"`packages/schema` has no UI dependencies" is a
doc-level rule with nothing behind it** — D1's mistake would have passed lint, typecheck, build and
the boundary check, and would have shown up as a bigger server image nobody attributes to this
change.

Third rule: a file under `packages/schema/` may not import from `@tiptap/*`, `@yapm/ui`, `react`,
`react-dom`, `@base-ui/react`, `lucide-react` or `@floating-ui/*`. The violation message names
`rich-text/plaintext.ts` as the reason, so whoever trips it reads the rationale rather than deleting
the rule. Same match style as the existing rules (`from '<pkg>'` / `from '<pkg>/…'`), no new
dependency, no AST.

## D3 — A mention exports as `@Display Name` — replacing what the library actually does

**Verified**, and it contradicts the scoping assumption that mentions would simply be dropped:

```
in : paragraph[ "ping ", mention{id:"u1",label:"Ada Lovelace"}, " now" ]
out: ping [@ id="u1" label="Ada Lovelace"] now      ← 3.28.0's default
re : parses back to the identical mention node       ← lossless, through itself
```

So the stock behaviour is a **lossless custom syntax that is unreadable everywhere else** — the
option the maintainer's decision names and rejects. Output becomes `ping @Ada Lovelace now`.

It is safe because in-app copy/paste never touches markdown: ProseMirror's `data-pm-slice`
`text/html` flavour is lossless and is what a yapm→yapm paste uses. Markdown is only what leaves the
building, and there a readable name is exactly what you want. Nothing matches names on the way back
in — a paste that silently notified a colleague because their name appeared in some text would be a
far worse failure than a lost chip.

Name resolution mirrors `richTextToPlainText` exactly rather than inventing a second rule: live
lookup → stored `label` → **nothing at all** (not a bare `@`).

**Mechanism: a pure pre-walk, not a serialiser hook.** `richTextToMarkdown` first normalises the
document — mention nodes become text nodes (`@` + resolved name), marks markdown cannot carry are
stripped (D7) — and then serialises. Two consequences that matter: the resolver never has to be
baked into a `MarkdownManager` instance, so one lazily-built manager is shared by every call
(measured: ~0.12 ms to construct, so this is tidiness rather than performance); and the normalisation
is a pure function over JSON, testable without an editor.

## D4 — 🔴 The portable-text correction: where it attaches, and what was rejected

**Verified defects**, both in private methods of `MarkdownManager`:

```
encodeTextForMarkdown(text, node, parent)  →  escapeMarkdownSyntax(encodeHtmlEntities(text))
escapeMarkdownSyntax(text)                 →  text.replace(/([\\`*_[\]~])/g, '\\$1')
```

1. Every non-code text node is HTML-entity-encoded. `a < b & c` → `a &lt; b &amp; c`.
2. The escape set has no block-leading characters, so `# not a heading` survives unescaped and
   **re-parses as a heading**; likewise `- `, `1. `.

**They are one defect, not two.** `> not a quote` round-trips today *only* because entity encoding
turns it into `&gt;`. Remove the encoding alone and `>` newly breaks. The correction is atomic.

`renderNodeToMarkdown` short-circuits `node.type === 'text'` **before** any handler lookup
(verified in the compiled source), so there is no extension-level hook for text. Options considered:

| Option | Rejected because |
|---|---|
| Accept and document | The feature's entire value proposition is symmetry; `a &lt; b` in Slack is the failure the change exists to prevent |
| Post-process the markdown string | Cannot distinguish a `#` this serialiser emitted for a heading from one in a paragraph, nor text inside a fence from text outside it |
| Override `paragraph`'s `renderMarkdown` (fully public) | Fixes block-leading escapes, but the only way to undo entity encoding at that level is a blanket decode of already-rendered children — which corrupts an inline code span in which the author literally typed `&amp;`. That is the same class of asymmetry, moved |
| Fork / vendor the serialiser | ~1300 lines to own for two functions, and every upstream fix becomes a merge |
| **Replace `encodeTextForMarkdown` on the manager instance** | **Chosen** |

The replacement is a total function — it does not call through to the original — so the correction
does not depend on the original's behaviour, only on the *name* being the text hook. The version is
pinned exactly at `3.28.0` (D9), and the installer asserts the property it depends on:

```ts
if (typeof manager.encodeTextForMarkdown !== 'function') throw new Error(…)
```

Fail fast with the name, per CLAUDE.md's env-validation convention. A version bump that renames the
method fails loudly at construction rather than silently emitting entities again — and the round-trip
tests fail alongside it.

The code context check is re-derived rather than read off the instance's private `codeTypes` set:
parent type `codeBlock`, or a `code` mark on the node. Two conditions, both true of this node set,
both stated in the file. That keeps the private surface this change depends on to exactly **one
method name**.

## D5 — The escape table (verified against re-parse, every row)

Applied to non-code text only. Inline escapes apply to every text node; block-leading escapes apply
only to a text node that is the **first child of a `paragraph`** (identity check against
`parent.content[0]` — the node objects are the same references during the walk).

| Case | Emitted | Note |
|---|---|---|
| `\` `` ` `` `*` `_` `[` `]` `~` | `\<char>` | the library's set, kept |
| `<` `&` `>` `"` `'` | verbatim | entity encoding removed |
| leading `#`…`######` + space | `\#` | |
| leading `-` `+` `*` + space | `\-` | |
| leading `>` | `\>` | previously masked by entity encoding |
| leading `\|` | `\|` | pre-emptive: change 17 adds tables |
| leading ` ``` ` / `~~~` | escaped by the inline rule already | |
| leading `1.` / `1)` | **`1\.`** — escape the *delimiter*, not the digit | `\1.` does not escape in CommonMark; verified re-parsing as a list |
| leading `---` / `===` alone on a line | `\---` | thematic break / setext underline |
| leading 4+ spaces | **trimmed to none** | there is no backslash escape for a space; the alternatives are `&#32;` (the entity garbage this change removes) or an indented code block. Markdown cannot carry it; the paragraph's text is what matters. Documented in the feature page |

Inside `codeBlock` and under a `code` mark: **verbatim, nothing escaped**. Verified:
`if (a < b && c) {}` survives both.

## D6 — `# ` → heading level 2, and the inbound clamp uses the same table

This editor configures `heading.levels = [2, 3]` (`rich-text.tsx`). The heading extension generates
its input rules **from those levels** — `^(#{2,2})\s$` and `^(#{2,3})\s$` — so **`# ` matches
nothing**, which is the "missing input rule" the scope names. Verified by reading the installed
extension.

Level 1 is absent deliberately: an issue description is already inside a page that has an `h1`, and
the design system's type scale has two heading steps. So `# ` maps to **level 2**, the largest
heading that exists here, rather than adding a level nobody styled.

The same mapping runs inbound, and it is not cosmetic: `#### four` parses to `heading level 4`
(verified), a node this schema does not have — TipTap drops it and the text with it on `setContent`.
One table, both directions:

| markdown | node |
|---|---|
| `# ` | heading 2 |
| `## ` | heading 2 |
| `### `…`###### ` | heading 3 |

`# ` and `## ` deliberately collide. A document that came from outside had its own `h1`; flattening
it into this editor's largest heading is right, and it is what re-serialises to `## `.

## D7 — What markdown cannot carry, and what is done about it

**Underline.** StarterKit 3.28 includes it and binds Cmd+U, so it is reachable in this editor.
3.28.0 serialises it as `++u++` (verified) — not CommonMark; GitHub, Slack and a terminal all render
the plus signs literally. **The mark is stripped in the pre-walk (D3) and the text survives.** The
inbound parse of `++…++` is left alone: accepting a format nobody else emits costs nothing.

Everything else the current node set can express round-trips (verified): bold, italic, strike, inline
code, links, headings 2–3, bullet and ordered lists including nesting, blockquotes, code blocks with
a language, horizontal rules, hard breaks (`two trailing spaces`), and nested marks
(`***both***`).

**Round-trip equality is asserted after normalisation through the ProseMirror schema**, not on raw
JSON. `getSchema(extensions)` → `Node.fromJSON(…).toJSON()` on both sides. Without it the tests
would fail on differences that are not losses: a parsed link mark carries `title: null` that the
source omitted, and an empty paragraph comes back as `content: []` rather than no `content` key.
Asserting raw equality would push the implementation toward "fixing" schema defaults.

**`markdownToRichText('')` returns `EMPTY_DOC`**, not `{type:'doc',content:[]}` — the manager's empty
output (verified) is not a valid document for a schema whose `doc` requires `block+`.

## D8 — The extension point change 17 uses

Change 17 (`editor-rich-content`) adds `image`, `table` and code-block-with-highlighting. Two places
change, both additive:

1. **Node rendering and parsing**: nothing. Those extensions carry their own `markdownName` /
   `parseMarkdown` / `renderMarkdown` — declared on `NodeConfig` by **`@tiptap/core` 3.28 itself**,
   not by the markdown package — and `MarkdownManager` picks them up from the extension list.
   `createRichTextExtensions()` is the single input, so adding a node there is the whole change.
2. **`normalizeForMarkdown()`** — the pre-walk from D3 — is where a node that markdown *cannot*
   carry gets its lossy fallback (an image without a resolvable URL, say). It is a `switch` on
   `node.type` with a default that recurses; a new case is one clause.

The escape table (D5) already reserves leading `|` for tables, so a paragraph starting with `|` will
not become a table row when they arrive.

**What change 17 must not do:** move this file into `packages/schema` to reach it from the server
(D1), or add a second `MarkdownManager` with a different extension list.

## D9 — Exactly `3.28.0`, never a caret

`reference/frontend-build.md` §11.1's pin-the-whole-graph rule goes from five catalog entries to six.
`@tiptap/markdown`'s peers are **exact** `@tiptap/core: 3.28.0` and `@tiptap/pm: 3.28.0` — what this
repo already resolves — so the graph does not move. A caret here is a runtime bug, not a style
preference: a split resolution duplicates `prosemirror-model` and the editor throws
`RangeError: Adding different instances of a keyed plugin` the first time it mounts, invisible to
typecheck and to build. `marked@^17` (MIT, zero deps) arrives transitively and gets no catalog entry.

Verification is the same as the `mentions` change used: exactly one `@tiptap/core` and one
`@tiptap/pm` directory in `node_modules/.pnpm` after install.

## D10 — Paste converts markdown only when nothing better is available

`handlePaste` returns `false` — today's behaviour, untouched — unless **all** of:

- the clipboard carries **no `text/html` flavour**. A yapm→yapm paste has `data-pm-slice` and is
  lossless; a paste from a browser or an editor has real HTML, and ProseMirror's HTML parse path is
  strictly better than round-tripping it through markdown.
- the caret is **not** inside a `codeBlock` and has **no `code` mark**. Pasting a markdown snippet
  into a code block must insert the characters, which is the entire point of a code block.
- converting the text actually changes something. `markdownToRichText` on a sentence with no markdown
  in it yields one paragraph with that sentence (verified), so the guard is cheap, but a paste that
  produces exactly what plain insertion would produce should take the plain path and leave undo
  history and cursor placement to ProseMirror.

Consequence accepted: pasting plain text containing `_foo_` from a terminal produces italics. That is
Linear's behaviour, it is what "paste markdown in" means, and Cmd+Z is one keystroke away.

## D11 — Test tiers, judged against PROCESS.md §3 rather than by reflex

The big-feature rule asks whether the change touches ≥2 of {synced entity/schema, mutator,
permission surface, signature UI}. This touches **one** — signature UI. No schema, no mutator, no
permission surface. **So: unit only, and no e2e.** There is no integration tier either — nothing here
reaches Postgres or zero-cache.

- **Unit, node** (`markdown.test.ts`): both conversion functions, the escape table row by row, the
  mention rendering, the clamp, the schema-normalised round trip. This is where the falsifiable check
  lives.
- **Unit, jsdom** (`markdown-editor.test.tsx`, `@vitest-environment jsdom` docblock — the convention
  `packages/ui/vitest.config.ts` already documents): the two input rules against a real editor, the
  clipboard serialiser, and all three paste refusals.

What that leaves unproven, honestly: **jsdom is not a browser and its `ClipboardEvent`/`DataTransfer`
are approximations.** "Copy from yapm, paste into Slack, and the text is right" is not agent-checkable
here — it is named in the change's human-judgement line rather than replaced by a test that cannot
fail.

---

## Decisions made during implementation

### I1 — The manager gets UNRESOLVED extensions, not `resolveExtensions(...)`

The plan said `new MarkdownManager({ extensions: resolveExtensions(createRichTextExtensions()) })`.
Verified by running it: **`resolveExtensions` is not idempotent.** It expands StarterKit but keeps
`starterKit` itself in the result (2 → 25 entries, no duplicate names), so resolving that result
again expands it a second time — 49 entries, 24 duplicate names, and TipTap logs
`Duplicate extension names found: [...]. This can lead to issues.`

`MarkdownManager` stores the array it is given as `baseExtensions` and later calls
`getSchema(this.baseExtensions)` (in `getSchemaParseDomTags`, reached from `parse`), and `getSchema`
resolves. So pre-resolving means resolving twice. The manager already does
`sortExtensions(flattenExtensions(extensions))` for its own registration, which is what
`resolveExtensions` does. Passing `createRichTextExtensions()` directly produces byte-identical
serialiser output on every probe case and no warning.

### I2 — Block-leading escapes also apply after a `hardBreak`, not only to `content[0]`

§D5 keys the block-leading escapes on "first child of a paragraph". A hard break emits a newline, so
the text node *after* one also opens a line: `line` + hardBreak + `# after break` serialised to an
unescaped `# after break` on its own line and re-parsed as a heading. The rule is now
`node === parent.content[0] || previous sibling is a hardBreak`. The sibling scan is guarded by a
cheap `^[ \t#\-+>|=\d]` prefilter, so it costs an `indexOf` only for text that could possibly begin
a block construct.

### I3 — A fourth paste refusal: a single unbroken run over a non-empty selection

§D10 lists three refusals. Verified while wiring `handlePaste`: `@tiptap/extension-link`'s
`linkOnPaste` (`helpers/pasteHandler.ts`) wraps a **non-empty selection** in a link when the
clipboard holds one bare URL — and `EditorView.someProp` consults `editorProps` **before any
plugin**, so this handler runs first and would have replaced the selection with the URL text
instead. `marked` autolinks a bare URL, so the "conversion changes nothing" guard does not catch it.

Fourth refusal: the selection is non-empty **and** the conversion yields exactly one paragraph
holding one text node whose text equals the pasted text. That is precisely the bare-URL case;
`**bold**` over a selection still converts, because the emitted text (`bold`) is not the pasted text.

`Node.fromJSON` is also wrapped in a `try`: the clipboard is arbitrary input and falling through to
ProseMirror's own paste is always safe.

### I4 — `richTextSliceToMarkdown` is exported

`clipboardTextSerializer` needs a `Slice` → markdown step (wrap bare inline content in a paragraph,
then serialise). It is exported from `rich-text.tsx` rather than inlined in `editorProps` so the
clipboard behaviour is reachable from a test without driving a real `copy` event through jsdom.

### I5 — The boundary rule matches `import 'pkg'` as well as `from 'pkg'`

Rule 3 was specified as "the same `from '<pkg>'` regex style as the two existing rules". A
side-effect import — `import '@tiptap/core'` — has no `from`, and costs the server bundle exactly as
much as a named one, so the pattern is `(?:from|import)\s+['"]…['"]`. Still one regex, no AST, no
new dependency.

### Evidence: rule 3 fires (task 1.4)

```
$ printf "import '@tiptap/core'\n" > packages/schema/src/__scratch-boundary.ts
$ node scripts/check-boundaries.mjs
Package boundary violations:

  ✗ packages/schema/src/__scratch-boundary.ts: schema imports "@tiptap/*" — packages/schema MUST NOT
    depend on the UI. apps/server imports @yapm/schema, so a TipTap, React or ProseMirror import here
    ships an editor to the server. See packages/schema/src/rich-text/plaintext.ts: it imports NOTHING,
    and that is why a rich-text walk is allowed to live in schema at all. The markdown serialiser
    lives in packages/ui/src/lib/markdown.ts for this reason.
EXIT=1

$ rm packages/schema/src/__scratch-boundary.ts && node scripts/check-boundaries.mjs
Boundaries OK: no package→app imports, no ZQL/mutator definitions outside packages/schema, no UI
dependencies in packages/schema.
EXIT=0
```

`import { useMemo } from 'react'` in the same scratch file fires the `react` rule; both import forms
were checked.

### Evidence: the graph did not split (task 1.2)

```
$ ls node_modules/.pnpm | grep -E '^@tiptap\+(core|pm|markdown)@'
@tiptap+core@3.28.0_@tiptap+pm@3.28.0
@tiptap+markdown@3.28.0_@tiptap+core@3.28.0_@tiptap+pm@3.28.0__@tiptap+pm@3.28.0
@tiptap+pm@3.28.0
```

Exactly one `@tiptap/core` and one `@tiptap/pm`.

### Evidence: the serialiser, run against this repo's extension set

The falsifiable check (`a < b & c` / `# not a heading`) emits exactly
`"a < b & c\n\n\\# not a heading"` and re-parses to the source document. Every §D5 row verified on
both the emitted string and the re-parse:

```
"# h"          => "\# h"            "###### h"  => "\###### h"
"- bullet"     => "\- bullet"       "+ bullet"  => "\+ bullet"
"* bullet"     => "\* bullet"       "> not a quote" => "\> not a quote"
"| a | b |"    => "\| a | b |"      "1. one"    => "1\. one"
"1) one"       => "1\) one"         "---"       => "\---"
"==="          => "\==="            "```js"     => "\`\`\`js"
"    indented" => "indented"        "a < b & c" => "a < b & c"
```

Every one re-parses to a paragraph holding the original text. Code is verbatim in both contexts:
`if (a < b && c) {}` survives a code block and a `code` mark unescaped and un-entitied. The whole
supported node set round-trips equal after normalising both sides through
`getSchema(createRichTextExtensions())`. Mentions: `ping @Ada Lovelace and @Fallback and  now`,
with no `id=`/`label=` syntax, and `markdownToRichText('@Ada Lovelace')` yields plain text.
Heading clamp: `#`/`##` → 2, `###`…`######` → 3. `''` → `EMPTY_DOC`.

### Evidence: the editor surface (jsdom probes, deleted after running)

Typing `# hello` yields `heading level 2`; `## two` still yields level 2 and `### three` still
yields level 3, so the new rule takes nothing away. `[yapm](https://yapm.dev)` yields a link mark
with that href and the text `yapm`. Neither fires inside a code block. Pasting
`## Title\n\n- one\n- two` as `text/plain` converts to a heading and a bullet list; the same text
with a `text/html` flavour present inserts `## Title` literally; `just a sentence` takes the plain
path. `richTextSliceToMarkdown` over a whole document gives
`"## Title\n\nping @Ada Lovelace a < b & c"` and over a partial inline selection `"ng @Ada Lovelace a < b"`.

⚠️ For whoever writes the editor tests: jsdom needs `Range.prototype.getClientRects`,
`Range.prototype.getBoundingClientRect` and `Element.prototype.scrollIntoView` stubbed, or every
transaction that scrolls the selection into view throws `target.getClientRects is not a function`
out of `prosemirror-view`.


### I6 — `richTextClipboardProps` is extracted, for the same reason I4 exported the slice helper

I4 exported `richTextSliceToMarkdown` so the copy behaviour was reachable without driving a real
`copy` event through jsdom. Writing the paste tests hit the identical wall one level up: **jsdom
implements neither `ClipboardEvent` nor `DataTransfer`** (verified — both are `undefined` under
`jsdom` in this Vitest setup), so a test that went through `RichTextEditor`'s React tree could only
ever hand `handlePaste` a stand-in clipboard *and* would have no way to reach the handler at all,
since the editor instance is private to the component.

`editorProps.clipboardTextSerializer` and `editorProps.handlePaste` therefore moved into an exported
`richTextClipboardProps(resolveMentionName)`, which `RichTextEditor` spreads. The tests build a real
`Editor` with the same object, so the function under test is the one that ships. Behaviour is
unchanged; `clipboard.types.includes(...)` became `Array.from(clipboard.types).includes(...)` because
`DataTransfer.types` is a `readonly string[]` in the DOM lib but only iterable in practice.

### I7 — A THIRD serialiser defect, out of reach, documented rather than fixed

Found while writing the code-verbatim test (task 3.3). An inline code span containing a backtick is
emitted with single-backtick delimiters:

```
"a `b` c"  =>  "`a `b` c`"  =>  parses as: code("a ") + text("b") + code(" c")
"`lead"    =>  "``lead`"    =>  parses as: plain text "``lead`"
```

CommonMark requires a run of backticks **longer** than any run inside the span. This is the same
family as §D4's two defects — an asymmetry in a symmetry feature — but unlike them it cannot be
reached from the one private method §D4 budgets. `getMarkOpening(markType, mark, mode)` renders the
mark against a **placeholder** string (`__TIPTAP_MARKDOWN_PLACEHOLDER__`) and slices off
everything before the placeholder, so a mark's delimiter never sees the text it wraps. A
content-dependent fence means overriding `renderNodesWithMarkBoundaries` — ~150 lines of private
surface, and every upstream fix becomes a merge.

**Decision: documented, not fixed.** The text itself still leaves yapm byte-intact, which is what the
portability promise is about; only the code-span boundary moves, and only for a span that contains a
backtick. It is pinned by a characterisation test (`an inline code span holding a backtick is emitted
verbatim and does NOT round-trip`) whose comment names the reason, so a future fix trips it and its
author reads this instead of rediscovering it. Recorded in `reference/frontend-build.md` §11.6 and in
the feature page's "what markdown cannot carry" table.

### I8 — The escape table has one row that was already green

`*` at the start of a paragraph is escaped by the library's **inline** set, not by the block-leading
rule, so `* bullet` round-trips against the uncorrected serialiser too. The row is kept in the table
because it is part of the documented contract, and the falsification run below records which rows
actually discriminate.

### Evidence: the tests can fail (tasks 3.x and 5.x)

Neutering `installPortableTextEncoding` — a one-line early return, restored afterwards — fails
**15 of `markdown.test.ts`'s 33 tests**: the falsifiable check, ten of the twelve escape-table rows
(`* bullet` and the fence are covered by the library's own inline set), the leading-space row, the
`>`-plus-punctuation row, the hard-break row, and the mid-paragraph row (which fails on entity
encoding rather than on escapes).

Removing `MarkdownShortcuts` from `createRichTextExtensions()` and disabling two paste refusals —
all restored afterwards — fails **4 of `markdown-editor.test.tsx`'s 15**: both input-rule tests, the
HTML-flavour refusal, and the bare-URL refusal. No test in either file passes vacuously.

### Evidence: nothing outside this change's surface moved (task 6.5)

```
$ git diff --stat origin/main -- packages/schema apps/server apps/web .env.example
(no output)
```

No migration, no Zero schema change, no jsonb column, no env var.
