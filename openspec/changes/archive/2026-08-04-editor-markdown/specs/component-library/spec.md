## ADDED Requirements

### Requirement: Markdown shortcuts complete the rich-text editor's typing surface

The rich-text editor primitive SHALL let a writer produce every block and mark it supports by typing
markdown, with no pointer and no toolbar. In addition to the shortcuts the editor already provides,
typing `# ` followed by text SHALL produce the editor's largest heading, and typing `[text](url)`
SHALL produce a link whose label is `text` and whose target is `url`. The link rule SHALL also apply
to pasted text, so a pasted markdown link becomes a link.

The rules MUST NOT fire inside a code block or under a code mark, where the typed characters are the
content.

#### Scenario: A heading from the keyboard alone

- **WHEN** a writer types `# ` at the start of an empty paragraph and continues typing
- **THEN** the paragraph becomes the editor's largest heading and the `#` and space are consumed

#### Scenario: A link from the keyboard alone

- **WHEN** a writer types `[yapm](https://yapm.dev)` in a paragraph
- **THEN** the text `yapm` is left carrying a link to `https://yapm.dev` and the brackets and
  parentheses are consumed

#### Scenario: Shortcuts are inert inside code

- **WHEN** a writer types `# ` or `[text](url)` inside a code block
- **THEN** the characters are inserted literally and no heading or link is created

### Requirement: Copying from the editor yields portable markdown

The rich-text editor primitive SHALL place markdown on the clipboard's plain-text flavour, so text
copied out of yapm keeps its structure wherever it is pasted. The rich HTML flavour SHALL be left
untouched, so pasting back into yapm stays lossless and pasting into a rich-text target stays rich.
Copying a partial selection SHALL serialise only the selected content.

#### Scenario: Structure survives a copy into a plain-text target

- **WHEN** a member selects a description containing a heading, a bullet list and a link and copies
  it, then pastes into a plain-text target
- **THEN** the heading arrives with its `#` prefix, the list items with their markers, and the link
  as `[label](url)` with the URL present

#### Scenario: Copying inside yapm stays lossless

- **WHEN** a member copies rich text from one yapm editor and pastes it into another
- **THEN** the rich flavour is used and the pasted content is identical to the source, including
  mention chips

### Requirement: Pasting plain markdown produces rich text, and every other paste is unchanged

The rich-text editor primitive SHALL convert pasted plain text from markdown into rich text. It MUST
NOT convert when the clipboard carries a rich HTML flavour, and MUST NOT convert when the caret is
inside a code block or under a code mark. Conversion SHALL be undoable in one step.

#### Scenario: Markdown pasted as plain text becomes rich text

- **WHEN** a member pastes `## Plan\n\n- one\n- two` copied from a terminal into a description
- **THEN** a heading and a two-item bullet list appear, and the literal `#` and `-` characters do not

#### Scenario: A rich paste is not routed through markdown

- **WHEN** a member pastes content whose clipboard carries an HTML flavour
- **THEN** the existing HTML paste path handles it and no markdown conversion runs

#### Scenario: Pasting into a code block inserts characters

- **WHEN** a member pastes markdown while the caret is inside a code block
- **THEN** the exact characters are inserted and no heading, list or link is created

#### Scenario: One undo restores the pre-paste document

- **WHEN** a member pastes markdown and presses the undo shortcut once
- **THEN** the document returns to its state before the paste
