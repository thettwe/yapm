## ADDED Requirements

### Requirement: A document is never written back with content the local bundle could not hold

The ProseMirror schema is versioned by the deployed bundle, not by the database, and TipTap drops
node and mark types it does not declare when parsing a document. The system SHALL therefore detect,
before an editor becomes editable, that a loaded document contains content the local bundle cannot
represent, and SHALL refuse to write in that case rather than persisting the pruned document.

Detection SHALL use two independent signals, both evaluated against the **raw stored JSON** before
any parse:

1. **Unknown type names** — every `type` on a node and on a mark, tested against the node and mark
   names the local extension set actually declares. The known-type sets SHALL be **derived** from
   the shared extension set, never listed by hand, so a type added to the editor is covered without
   a second edit.
2. **A document schema version** — a monotonic integer constant compiled into the bundle and stamped
   onto the stored document. A document stamping a version higher than the local constant SHALL be
   treated as skewed even when every type name is recognised, because an attribute-only change is
   invisible to signal 1. A document carrying no stamp SHALL read as version 1.

The stamp SHALL be written by the shared rich-text sanitizer that already runs inside every
description and comment mutator, on both the optimistic and the authoritative pass, so it is
deterministic, rebase-safe, mints nothing, and cannot be forgotten by a call site.

The detector SHALL be a pure function living beside the plaintext walker in the schema package, with
**no imports**, so it is reachable from the shared mutator without dragging an editor into the
server bundle.

Work-graph placement: this is a property of the `issue.description` and `comment.body` documents,
which are attributes of team-scoped entities. Sync/permission story: unchanged — the guard is a
client-side refusal to write and grants no read a member did not already have.

#### Scenario: A document holding an unknown node type blocks editing

- **WHEN** a document containing a node type the local bundle does not declare is loaded into the
  rich-text editor
- **THEN** the editor renders read-only, exposes a "reload to edit" state naming the reason, and
  emits no change callback, so no mutator is ever called with the pruned document

#### Scenario: A document stamping a newer schema version blocks editing

- **WHEN** a document whose stamped schema version exceeds the local constant is loaded, even though
  every node and mark type in it is recognised
- **THEN** the editor renders read-only and exposes the same "reload to edit" state

#### Scenario: An unstamped legacy document edits normally

- **WHEN** a document written before schema versioning existed — carrying no stamp and only
  long-declared node types — is loaded
- **THEN** the editor is fully editable and its next write carries the current stamp

#### Scenario: The write is refused, not merely discouraged

- **WHEN** a skewed document is loaded and the user types
- **THEN** there is no editable editor instance to type into, so no debounce, no autosave and no
  submit path can reach the mutator — the refusal is structural rather than a flag a handler checks

#### Scenario: Reload is reachable by keyboard

- **WHEN** a user with no pointer reaches a blocked editor
- **THEN** the banner's reload control is focusable and activatable by keyboard, and its purpose is
  announced by an accessible name

#### Scenario: A reader is told when a rendered document is missing content

- **WHEN** a skewed document is displayed in the read-only renderer
- **THEN** the same notice is shown, so a reader is never silently looking at a document with
  content invisibly removed

### Requirement: An image node stores an opaque attachment id and never a URL

An image in a document SHALL be stored as a node carrying an opaque `attachmentId`, an alt string,
and a coarse width bucket — and nothing else. It SHALL NOT carry a `src`, an absolute URL, or a
relative path. The rendering surface SHALL compute the byte path from the id.

The prohibition SHALL be enforced in the shared sanitizer, so it holds on the authoritative pass and
a crafted client cannot store a URL: any attribute outside the permitted set SHALL be removed, and
any URL-shaped value in an image node's *identifier* attribute (`attachmentId`) SHALL be rejected.
The ban is on the attribute the renderer dereferences. `alt` is display prose — never an `href` and
never a `src` — and SHALL NOT be tested for URL shape, because that test deletes ordinary alt text
of the form `Error: 500 on login` while protecting nothing (see design.md §I24). Pasted HTML SHALL
NOT parse into an image node at all.

Work-graph placement: the node references an `attachment` row, which is anchored to a team and
optionally to an issue or comment. Sync/permission story: unchanged from the attachments capability
— the id is a name, not a capability, and the bytes are served only by the permission-checked file
route. A member of another team who receives the id can read nothing.

#### Scenario: An inserted image stores only an id

- **WHEN** an image is uploaded and inserted into a document
- **THEN** the stored node holds the attachment id, the alt text and the width bucket, and no
  attribute the renderer dereferences — the id — contains a URL, a path, or a scheme

#### Scenario: A pasted HTML image does not become an image node

- **WHEN** HTML containing an `<img src="https://example.com/tracker.png">` is pasted into the editor
- **THEN** no image node is created and no external URL enters the document

#### Scenario: A crafted document cannot store a URL

- **WHEN** a client submits a document whose image node carries a `src`, any other attribute outside
  the permitted set, or a URL-shaped `attachmentId`
- **THEN** the shared sanitizer removes the extra attributes and empties the URL-shaped id before the
  authoritative write, so no attribute the renderer dereferences holds a URL

#### Scenario: Alt text that looks like a scheme is not destroyed

- **WHEN** an image node's `alt` reads `Error: 500 on login` — prose whose first word ends in a colon
- **THEN** the alt text survives the authoritative sanitizer verbatim, because it is display prose
  that is never an `href` and never a `src` (design.md §I24)

#### Scenario: An image is selectable and removable without a pointer

- **WHEN** the caret is adjacent to an image and the user presses an arrow key toward it
- **THEN** the image becomes the selection with a visible focus indicator that is not colour alone,
  and a subsequent Delete or Backspace removes it

#### Scenario: An image with no resolvable source degrades visibly

- **WHEN** a document containing an image node is rendered in a context that supplies no attachment
  source resolver
- **THEN** a bordered placeholder carrying the alt text is shown, rather than a broken image or an
  empty gap

### Requirement: Tables and highlighted code blocks are first-class, keyboard-operable nodes

The editor SHALL support a table node with a header row and a code-block node with syntax
highlighting over a curated, explicitly registered language set. Both SHALL be insertable, editable
and removable using the keyboard alone.

Column resizing SHALL NOT be offered: a column width is a synced attribute, a drag handle is a
pointer-only affordance, and widths are a needless source of last-write-wins churn.

A code block whose language is not in the registered set SHALL render unhighlighted rather than
failing, and the language selector SHALL offer only registered languages.

#### Scenario: A table is navigated by keyboard

- **WHEN** the caret is in a table cell and the user presses Tab
- **THEN** the caret moves to the next cell, Shift-Tab moves to the previous one, and Tab in the last
  cell appends a row

#### Scenario: Table structure is changed without a pointer

- **WHEN** the caret is inside a table
- **THEN** add-row, add-column, delete-row, delete-column and delete-table commands are reachable as
  labelled controls in the editor toolbar and from the insert menu, each operable by keyboard

#### Scenario: A code block highlights a registered language

- **WHEN** a code block's language is set to one of the registered languages
- **THEN** its content is tokenised and each token class is coloured from theme tokens

#### Scenario: An unregistered language degrades to plain

- **WHEN** a document contains a code block whose language is not registered
- **THEN** the block renders with its text intact and no highlighting, and no error is surfaced

#### Scenario: Syntax colours come from tokens in every theme

- **WHEN** a code block is displayed in any of the three presets, in light and in dark
- **THEN** every syntax colour resolves from a theme token, no stylesheet shipped by the
  highlighting library is loaded, and every token meets AA contrast against the code block's surface

### Requirement: The insert menu is a second suggestion surface that does not weaken the first

Typing `/` in a position where a block may be inserted SHALL open an insert menu listing the block
types the editor supports. The menu SHALL be a separate controller from the mention typeahead, with
its own ProseMirror plugin key, and the two SHALL coexist in one editor.

Escape SHALL dismiss only the open menu. It SHALL NOT reach the surrounding surface, and it SHALL
NOT discard the draft the editor holds. The mechanism SHALL be the existing one: the controller
records the exact native keyboard event it acted on, and the wrapper stands down on that identity —
never on `defaultPrevented`, which the view sets on every Escape whether or not anything handled it.

#### Scenario: The insert menu opens and inserts by keyboard alone

- **WHEN** a user types `/` at the start of an empty paragraph and types to filter
- **THEN** a listbox of matching commands is shown with the active option announced, arrow keys move
  the selection, and Enter inserts the chosen block in a single undoable step

#### Scenario: Escape dismisses the menu and keeps the draft

- **WHEN** the insert menu is open inside a comment composer and the user presses Escape
- **THEN** the menu closes, the composer keeps its text, and the surrounding panel does not close

#### Scenario: Escape with no menu open still cancels

- **WHEN** no popup is open in the editor and the user presses Escape
- **THEN** the surrounding surface's cancel behaviour runs exactly as before this change

#### Scenario: The trigger does not fire mid-word

- **WHEN** a user types a `/` inside a word, inside a code block, or inside an inline code mark
- **THEN** the insert menu does not open

#### Scenario: A command that cannot apply is not offered as if it could

- **WHEN** the caret is inside a table, or no upload path is available
- **THEN** the insert-table and insert-image commands are shown as unavailable rather than inserting
  something invalid

### Requirement: Uploading from the editor puts nothing in the document until the bytes are stored

An image SHALL be uploadable from the editor by choosing it from the insert menu, by pasting it, or
by dropping it. The upload SHALL use the existing authenticated, size-bounded, team-scoped file
route; this capability SHALL add no server route and no storage capability.

No node SHALL enter the document while the upload is in flight. Progress SHALL be shown as an
editor decoration outside the document, so a failed upload cannot leave a node naming an attachment
that does not exist.

#### Scenario: A pasted image is uploaded and inserted

- **WHEN** a user pastes image bytes into the editor
- **THEN** a progress indicator appears at the insertion point, the bytes are uploaded over the
  authenticated file route, and on success an image node carrying the returned id is inserted in one
  undoable step

#### Scenario: A failed upload leaves the document untouched

- **WHEN** an upload is refused — too large, an unsupported type, or the standard refusal for an
  issue the caller may not write
- **THEN** the progress indicator is replaced by an inline error naming what happened, and no node
  is inserted

#### Scenario: Insertion is reachable without a pointer

- **WHEN** a user opens the insert menu and chooses the image command by keyboard
- **THEN** a file picker opens, and the resulting image is inserted at the caret
