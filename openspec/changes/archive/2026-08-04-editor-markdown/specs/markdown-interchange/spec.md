## ADDED Requirements

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
