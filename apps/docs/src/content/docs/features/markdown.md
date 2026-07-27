---
title: Markdown
description: Type markdown to format, paste markdown in, copy markdown out — and read it wherever you paste it. yapm stores rich text, and markdown is how that text travels.
---

Descriptions and comments in yapm are **rich text**, not markdown files. Markdown is how that text
**travels**: what you type to format it, what you can paste into it, and what lands on the clipboard
when you copy it out.

That distinction is the whole design. Nothing you write is stored as markdown, so the editor never
shows you syntax you did not ask for — and everything you copy out is markdown, so it reads
correctly in a terminal, a Slack message, a commit body, or a pull request description.

## Typing

Every block and mark the editor supports has a keyboard route. Type the marker and it disappears
into the formatting it describes.

| Type | You get |
|---|---|
| `# ` or `## ` | A heading |
| `### ` | A smaller heading |
| `- ` or `* ` or `+ ` | A bullet list |
| `1. ` | A numbered list |
| `> ` | A quote |
| ` ``` ` then `Enter` | A code block (add a language after the backticks and it is kept) |
| `---` then `Enter` | A horizontal rule |
| `**bold**` | **Bold** |
| `*italic*` or `_italic_` | *Italic* |
| `~~strike~~` | ~~Strikethrough~~ |
| `` `code` `` | `Inline code` |
| `[text](url)` | A link labelled *text* |

`# ` and `## ` deliberately produce the same heading. yapm has two heading sizes, not six: an issue
description already sits inside a page with its own title, so a third level of hierarchy above the
one you are writing in has nowhere to go.

None of these fire inside a code block or inside inline code. In there, the characters are the
content — which is the entire point of a code block.

Everything on this page works with no pointer and no toolbar.

## Copying out

Select anything and copy it, and the **plain-text** clipboard gets markdown:

```md
## Migration plan

- Drain the queue
- Flip the flag, then watch [the dashboard](https://example.com/d)

Only run this when `a < b && c` holds.
```

Paste that into a terminal, a Slack message or a `git commit -m`, and it reads exactly as written.
Characters like `<`, `&` and `>` arrive as themselves rather than as `&lt;`, `&amp;` and `&gt;` —
which is what most markdown converters emit, and which is unreadable anywhere outside a markdown
renderer.

A paragraph that *begins* with something markdown would read as structure — `# `, `- `, `1. `, `> `,
`| `, with or without a space or two in front of it — comes out with a backslash, so pasting it back
gives you the paragraph you wrote rather than a heading you did not. A code block containing its own
` ``` ` line is fenced with enough backticks to hold it.

Copying a partial selection copies only the selection. This works **anywhere text is shown**, not
only where you can edit it: comments, and descriptions on an issue you can only read, copy as
markdown too.

**Copying inside yapm is unaffected.** A copy from one yapm editor into another uses the rich
clipboard flavour and is lossless, mention chips and all. Markdown is only what the text becomes
when it leaves.

## Pasting in

Paste markdown as **plain text** — from a terminal, a `.md` file, a chat message — and it becomes
rich text: headings become headings, lists become lists, `[text](url)` becomes a link.

It deliberately does **not** convert in four cases:

- **The clipboard carries formatted content.** Copying from a browser, another editor or another
  yapm editor puts a rich flavour on the clipboard alongside the plain one. That path is better than
  markdown at preserving what you copied, so it is the one that runs.
- **The caret is inside a code block or inline code.** The characters are inserted exactly as they
  are.
- **Converting would change nothing.** Pasting an ordinary sentence takes the ordinary path, so your
  cursor lands where you expect.
- **You pasted a bare URL over selected text.** The selection becomes a link to it rather than being
  replaced.

**Anything that looks like an HTML tag stays text.** Pasting `<div>hello</div>`, or a sentence like
`compare a<b and c>d`, gives you those exact characters. yapm never treats pasted plain text as
markup, so nothing you paste can quietly become a mention, a heading or an empty paragraph.

A conversion is **one undo**. Press undo once and the document is exactly as it was before the
paste.

One consequence worth knowing: pasting plain text that happens to contain `_underscores_` produces
italics. That is what "paste markdown in" means, and undo is one keystroke away.

## Mentions leave as names

A [mention](/features/mentions/) copied out becomes `@Ada Lovelace` — the person's current display
name, resolved live, exactly as it reads on screen.

It does **not** come back. Pasting `@Ada Lovelace` into a description produces the plain text
`@Ada Lovelace` and nothing else: no chip, no subscription, and **nobody is notified**. yapm never
matches a name in pasted text against the people in your workspace. A paste that quietly notified a
colleague because their name appeared in some text you copied would be a far worse failure than a
mention you have to re-type.

Copying a mention *within* yapm keeps the chip, because that path never touches markdown.

## What markdown cannot carry

Honest list. In each case the **words survive** and only the decoration is lost — nothing is ever
encoded into a syntax that renders as literal punctuation somewhere else.

| Lost on the way out | Why |
|---|---|
| **Underline** | There is no underline in CommonMark. GitHub, Slack and a terminal all render the `++plus signs++` some converters emit as plus signs. The text comes out unmarked |
| **Mention identity** | A mention becomes a readable name; the link to the person does not survive (see above) |
| **Leading indentation** | Four or more leading spaces mean "code block" in markdown, and there is no way to escape a space. A paragraph you indented comes out flush |
| **A backtick inside inline code** | `` `a `b` c` `` needs a longer fence than yapm currently emits, so that one span may re-parse oddly. The characters themselves are never altered |

Headings deeper than yapm has are folded rather than dropped: pasting `#### Four` gives you yapm's
smaller heading with its text intact, not a missing line.

## What this is not

There is **no markdown source mode**, no split-pane preview and no "edit as markdown" toggle.
Nothing is stored as markdown, so there is no source to show you.

There is also **no export yet** — no `export.md` endpoint, no bulk download. The conversion this
page describes is the piece that a future export needs, and it now exists and is tested; the export
surface itself is still an open gap.
