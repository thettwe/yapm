## ADDED Requirements

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
