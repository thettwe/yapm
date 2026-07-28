---
title: Images, tables & code
description: Insert images, tables and syntax-highlighted code blocks with a slash menu, all from the keyboard — and see every file an issue holds in one list.
---

Descriptions and comments hold more than paragraphs. Press `/` and you get a menu of blocks;
choose one and it lands at the caret. Everything on this page works with no pointer.

## The insert menu

Type `/` at the start of a line or after a space, and a menu opens.

| Key | Does |
|---|---|
| `/` | Opens the menu |
| Type letters | Filters — `/tab` finds Table, `/code` finds Code block |
| `↑` `↓` | Moves the highlighted command |
| `Enter` or `Tab` | Inserts the highlighted command |
| `Escape` | Closes the menu and **nothing else** — your draft stays exactly as it was |

Nine commands: Heading 2, Heading 3, Bullet list, Numbered list, Quote, Code block, Table, Image and
Divider. Inserting one is **a single undo** — press undo once and both the block and the `/` you
typed are gone.

The menu does not open where a `/` is a character you meant: not mid-word (`and/or` stays
`and/or`), not inside a code block, and not inside inline code. A command that cannot apply where the
caret is — a table inside a table, or an image where there is nothing to upload to — is shown greyed
with a reason rather than silently missing.

`/` and `@` coexist. [Mentions](/features/mentions/) keep working exactly as before, and Escape
dismisses only whichever list is open.

## Images

Three ways in, all of which upload the file first and insert the image only once the bytes are
stored:

- **`/image`** — opens your file picker.
- **Paste** — a screenshot straight from the clipboard.
- **Drop** — an image file onto the editor. A non-image drop is left to the browser.

While an upload is in flight you see a placeholder with the filename. It is **not part of the
document**: if the upload fails, the placeholder is replaced by the reason and nothing is inserted,
so a document can never point at a file that does not exist. The message clears itself the next time
you type.

The alt text starts as the filename with dashes and underscores turned into spaces — so name your
screenshots. Select an image with the arrow keys (it gets a visible outline) and the toolbar offers
**Image alt text** and **Remove image**; `Delete` or `Backspace` removes it too.

Images are also **searchable by their alt text**, because that text is the only thing about a
picture [search](/features/search/) can read.

:::note
There are **no image links to share**. An image in a description stores an opaque id, never a URL,
and yapm serves the bytes only to people who can read the issue. See
[Attachments](/self-hosting/attachments/) for why.
:::

## Tables

`/table` inserts a 3×3 table with a header row.

| Key | Does |
|---|---|
| `Tab` | Next cell — and in the last cell, adds a row |
| `Shift-Tab` | Previous cell |
| Arrow keys | Move within and out of the table |

With the caret inside a table the toolbar grows a row of controls: **Add row below**, **Delete row**,
**Add column after**, **Delete column**, **Toggle header row**, **Delete table**. Each is a real
button with a name a screen reader reads out.

**Columns cannot be resized, on purpose.** A column width would be a stored value that syncs to
everyone and changes under them when a colleague drags a handle — and a drag handle is a
pointer-only control besides. Tables here size themselves to their content.

A table cell holds paragraphs and lists. It does not hold another table.

## Code blocks

` ``` ` then `Enter`, or `/code`, gives you a code block. A dropdown on the block sets its language,
and the code is highlighted in your theme's colours — in all three themes, light and dark.

Fifteen languages are highlighted plus plain text: Bash, CSS, Diff, Dockerfile, Go, HTML,
JavaScript, JSON, Markdown, Python, Rust, SQL, TSX, TypeScript, YAML. Common short names work too —
` ```ts `, ` ```py `, ` ```sh `, ` ```yml ` — and are kept as you wrote them.

A block whose language is not in that list still shows your code, just without colours. Nothing
fails and nothing is lost.

Nothing inside a code block is interpreted: no markdown, no `/` menu, no `@` mention. The characters
are the content.

## Files on an issue

Every issue has a **Files** section listing everything attached to it: the filename, its size, who
uploaded it and when. Images you put in the description appear here too — a file is a row in the
database, and the image in your text only names it.

Each row is a download link named after its file, so a screen reader hears *"Download
staging-crash.png"* rather than nine controls all called "Download". If you can edit the issue you
can also remove a file, behind a confirm — removing it deletes the bytes, and an image in a
description that named it degrades to its alt text.

The Files section accepts **any** file, not only images: a log, a HAR, a crash dump. Only images
have a place in the text of a description.

Viewers see the list and can download from it. They see no upload and no remove.

## "Reload to see and edit all of this"

Occasionally, right after yapm is upgraded, an issue shows a bar reading:

> This was edited in a newer version of yapm. Reload the page to see and edit all of it.

Here is exactly what that is, because the honest explanation is short.

The set of things a description can contain — images, tables, code blocks — is decided by the
version of yapm **your browser loaded**, not by the one on the server. A tab you left open before an
upgrade does not know about anything the upgrade added. Editors of this kind silently discard
content they do not recognise, so that tab would quietly delete a colleague's table the moment you
typed a character into the description, and it would then be saved that way.

So yapm refuses. When it loads a document containing something this tab cannot represent, it shows
you the document read-only with that bar, and will not save. Reload and everything is there and
editable again. The worst case is a stale tab that will not save until you reload it — never a table
that vanished without anyone noticing.

Readers see the same notice on a document they can only read, so nobody is looking at a page with
content invisibly missing.

:::caution
This cannot protect the upgrade that **introduced** it. A tab running a build from before this
existed has none of this code and will still prune. That window is one deploy wide and closes for
good after it.
:::

## What this is not

yapm's editor is a **document** editor, not a block editor. There are no drag handles, no nested
blocks, no databases-in-a-page, no task lists. `/` inserts a block where the caret is and then gets
out of the way.

There is also no `fileAttachment` block. Files are rows on an issue, listed in one place — not
objects scattered through prose where a backup or a cleanup sweep can miss them.
