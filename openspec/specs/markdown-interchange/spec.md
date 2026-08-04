# markdown-interchange Specification

## Purpose
TBD - created by archiving change editor-markdown. Update Purpose after archive.
## Requirements
### Requirement: Markdown is the interchange format and never the storage format

yapm SHALL store rich text exclusively as TipTap JSON in the existing `jsonb` columns, and SHALL use
markdown only as a wire format for text crossing the application boundary. Converting a document to
markdown or parsing markdown into a document SHALL NOT change what is persisted, MUST NOT require a
migration, and MUST NOT alter the shared document validation schema.

The conversion functions SHALL live in `packages/ui`, because the markdown library imports
`@tiptap/core` and `@tiptap/pm` and `apps/server` imports `packages/schema`. `packages/schema` SHALL
remain free of any UI, editor or ProseMirror dependency, and that freedom SHALL be enforced
mechanically rather than by convention.

#### Scenario: Storage is untouched by a conversion

- **WHEN** a document is converted to markdown and a markdown string is converted to a document
- **THEN** both are pure functions over JSON, no persisted row changes, and the document validation
  schema, the `jsonb` columns and the sync schema are all unchanged

#### Scenario: A UI dependency in the schema package is refused

- **WHEN** a file under `packages/schema` imports an editor, ProseMirror, React or UI-package module
- **THEN** the repository's boundary check fails with a message naming the file and the reason, and
  CI does not pass

### Requirement: Serialised markdown is portable outside yapm

Markdown produced by yapm SHALL be readable where it is pasted, not merely re-readable by yapm.
Text outside a code context MUST NOT be HTML-entity-encoded, and any character sequence that would
cause a paragraph to re-parse as a different block MUST be escaped. Content inside a code block or
under a code mark MUST be emitted verbatim, with no escaping and no encoding.

Round-tripping a document to markdown and back SHALL yield the same document, compared after both
sides are normalised through the editor's own schema.

#### Scenario: Punctuation survives leaving the application

- **WHEN** a paragraph reading `a < b & c` is serialised
- **THEN** the output is the literal text `a < b & c`, with no `&lt;` or `&amp;` entity anywhere

#### Scenario: A paragraph never re-parses as a block

- **WHEN** a paragraph whose text begins with `# `, `- `, `1. `, `> ` or `| ` is serialised and the
  result is parsed again
- **THEN** the result is a paragraph with exactly the original text, not a heading, a list, a
  blockquote or a table row

#### Scenario: Code is emitted verbatim

- **WHEN** a code block or inline code span containing `if (a < b && c) {}` is serialised
- **THEN** the emitted code is byte-identical to the source, with no backslash escapes and no
  entities

#### Scenario: Round trip over the supported node set

- **WHEN** a document using bold, italic, strike, inline code, links, headings, bullet and ordered
  lists including nesting, blockquotes, code blocks with a language, horizontal rules and hard breaks
  is serialised and parsed back
- **THEN** the parsed document equals the source document once both are normalised through the
  editor's schema

### Requirement: A mention leaves as a readable name and never returns as a mention

Serialising a mention SHALL emit `@` followed by the mentioned person's display name, resolved from
live data with the stored label as a fallback, and nothing at all when neither resolves. A custom
machine-readable mention syntax SHALL NOT be emitted. Parsing markdown SHALL NOT create a mention
node from any text, and SHALL NOT attempt to match a name against the workspace's people.

#### Scenario: A mention becomes a readable name

- **WHEN** a document containing a mention of a person whose display name is `Ada Lovelace` is
  serialised
- **THEN** the output contains `@Ada Lovelace` and contains no attribute syntax, no identifier and
  no bracketed token

#### Scenario: An unresolvable mention degrades quietly

- **WHEN** a mention whose identifier resolves to nobody and whose stored label is empty is
  serialised
- **THEN** it contributes nothing to the output, not a bare `@`

#### Scenario: Pasted text never becomes a mention

- **WHEN** markdown containing `@Ada Lovelace` is parsed
- **THEN** the result contains plain text and no mention node, and nobody is notified

### Requirement: Inbound markdown is coerced to the editor's own node set

Parsing markdown SHALL produce a document that is valid for the editor's configured schema. Heading
levels the editor does not define MUST be mapped to the nearest defined level rather than emitted as
an unknown node, and an empty markdown string MUST produce a valid empty document rather than a
document with no content.

#### Scenario: Out-of-range heading levels are clamped

- **WHEN** markdown containing `# One`, `#### Four` and `###### Six` is parsed
- **THEN** `# One` becomes the editor's largest heading, `#### Four` and `###### Six` become its
  smallest, and no heading node carries a level the editor does not define

#### Scenario: Empty input produces a valid document

- **WHEN** an empty markdown string is parsed
- **THEN** the result is a document containing one empty paragraph, which the editor accepts

### Requirement: What markdown cannot carry is dropped visibly, not encoded

Formatting with no portable markdown representation SHALL be dropped on serialisation while its text
survives, rather than emitted in a non-standard syntax that renders as literal punctuation
elsewhere. The lossy cases SHALL be documented for users.

#### Scenario: Underlined text keeps its words

- **WHEN** a paragraph containing underlined text is serialised
- **THEN** the output contains the words with no underline marker, and contains no `++` delimiters

### Requirement: Every new node type carries its own markdown serialisation

A node type added to the editor SHALL carry its markdown output on its own extension configuration,
so that adding a node is additive and the markdown manager itself is never modified. A node type
that ships without a serialisation case is a defect: copy-out drops it silently.

- A table SHALL serialise as a GFM pipe table with a header row and a delimiter row, one line per
  row, with a literal `|` inside a cell escaped.
- An image SHALL serialise as `![alt](<path to the file route for its attachment id>)`. The path
  appears only in the clipboard and is never stored in the document.
- A code block SHALL carry its language on the opening fence, and SHALL keep the content-dependent
  fence length that stops a block containing its own fence from closing early.

#### Scenario: A table survives copy-out

- **WHEN** a document containing a 2×3 table with a header row is copied
- **THEN** the plain-text clipboard flavour holds a GFM pipe table whose header, delimiter row and
  cell contents match the document

#### Scenario: A pipe inside a cell does not break the table

- **WHEN** a cell contains a literal `|`
- **THEN** the emitted markdown escapes it, and re-parsing the emitted markdown yields the same
  table shape

#### Scenario: An image survives copy-out as a resolvable path

- **WHEN** a document containing an image is copied
- **THEN** the plain-text clipboard flavour holds `![alt](/api/v1/files/<id>)`, using the alt text
  the author wrote, or an empty alt when there is none

#### Scenario: A code block keeps its language and its fence

- **WHEN** a code block whose language is `typescript` and whose body contains a triple-backtick line
  is copied
- **THEN** the emitted markdown opens with a fence longer than any run inside, carries `typescript`
  after it, and re-parses to the same code block

### Requirement: Inbound markdown never mints a node that names something outside the document

Parsing markdown into rich text SHALL NOT create an image node from `![alt](url)`. An image node
names an attachment row that must exist and be scoped to the reader's team; a pasted URL names
nothing this instance owns, and a document cannot be allowed to acquire a reference to bytes nobody
uploaded. The construct SHALL degrade to a link labelled with the alt text.

Constructs that name nothing outside the document SHALL parse normally: a GFM pipe table becomes a
table, and a fenced code block becomes a code block whose language is coerced to a registered
language or to plain text.

#### Scenario: A pasted markdown image becomes a link

- **WHEN** `![diagram](https://example.com/a.png)` is pasted as plain text
- **THEN** the document gains a link labelled `diagram` and no image node, and no request is made for
  the remote bytes

#### Scenario: A pasted markdown table becomes a table

- **WHEN** a GFM pipe table is pasted as plain text
- **THEN** the document gains a table with a header row and matching cell contents

#### Scenario: A pasted fenced block coerces its language

- **WHEN** a fenced block declaring a language the editor has not registered is pasted
- **THEN** a code block is created with its text intact and its language set to plain text

### Requirement: The plaintext projection enumerates every node type deliberately

The plaintext walk that feeds the mention fan-out and the search index SHALL have an explicit case
for each new node type, because its default — treat an unknown node as a block that contributes no
characters — is silently wrong for some of them and corrupts the search index without failing.

- An image SHALL contribute its alt text, trimmed and length-bounded, and nothing when the alt is
  empty.
- Table cells SHALL contribute their text with cells separated within a row and rows separated from
  one another, never welded into a single run.
- A code block SHALL contribute its text as one block.

#### Scenario: An image's alt text is searchable

- **WHEN** a description contains an image whose alt text is `login page 500`
- **THEN** the indexed plaintext for that issue contains that phrase

#### Scenario: Table cells do not weld together

- **WHEN** a description contains a table row whose cells read `alpha` and `beta`
- **THEN** the projected text separates them, so neither the search index nor a notification excerpt
  contains `alphabeta`

#### Scenario: A mention inside a table cell still notifies

- **WHEN** a mention is placed inside a table cell and the description is saved
- **THEN** the mention id is extracted and the fan-out reaches that person exactly as it would from a
  paragraph

