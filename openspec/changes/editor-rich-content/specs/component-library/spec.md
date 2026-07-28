## ADDED Requirements

### Requirement: The rich-text primitive carries the image, table and code-block node types

The shared rich-text primitive SHALL expose one extension set — used by both the editable editor and
the read-only renderer — that includes the image, table and syntax-highlighted code-block node
types, so a document round-tripping through the renderer never loses one of them. Exactly one
code-block node type SHALL exist in the set: the starter kit's own is disabled and replaced, and the
portable-markdown fence correction shipped with the markdown change moves onto the replacement
rather than being lost with it.

The primitive SHALL NOT know the file API's base path. It SHALL accept an attachment-source resolver
from the application, so the package boundary that forbids a package importing an app is preserved.

#### Scenario: The renderer preserves every node type the editor can produce

- **WHEN** a document containing an image, a table and a code block is rendered read-only and its
  JSON is read back
- **THEN** every node is present and unchanged

#### Scenario: The primitive resolves image bytes through an injected resolver

- **WHEN** the primitive is used without an attachment-source resolver
- **THEN** it renders an alt-text placeholder and imports nothing from an application package

### Requirement: A skewed document puts the primitive into an inert reload state

The rich-text primitive SHALL check a loaded document for content the local bundle cannot represent
before constructing an editable editor, and SHALL render a read-only view plus a reload affordance
instead of an editor when it finds any. In that state the primitive SHALL expose no change or submit
callback.

#### Scenario: The blocked state is inert and labelled

- **WHEN** the primitive is given a document naming an unknown node type
- **THEN** it renders a non-editable view, a status message explaining that a newer version wrote the
  content, and a reload control — and it invokes neither its change nor its submit callback for any
  input

#### Scenario: The blocked state is keyboard reachable

- **WHEN** a keyboard user tabs into a blocked rich-text surface
- **THEN** the reload control receives focus with a visible focus indicator and activates on Enter or
  Space

### Requirement: Two suggestion popups share one keydown path without weakening it

The primitive SHALL support two independent suggestion surfaces — the mention typeahead and the
insert menu — each with its own ProseMirror plugin key, each mounted inside the editor's own wrapper
so that `aria-activedescendant` remains a same-subtree reference, and each recording the exact
native keyboard event it handled.

The wrapper's key handling SHALL stand down on that recorded event identity and SHALL NOT consult
`defaultPrevented`, because the editor view marks every Escape and every Enter as prevented whether
or not anything handled them.

The two list components SHALL remain separate: the mention list carries eligibility state, rejection
counts and per-row explanatory copy that a command list has no use for.

#### Scenario: Each popup dismisses only itself

- **WHEN** either popup is open and Escape is pressed
- **THEN** that popup closes, the editor keeps focus and content, and the surrounding surface's
  cancel handler does not run

#### Scenario: An unhandled key still bubbles

- **WHEN** a key no popup handled is pressed — for example the command-palette shortcut
- **THEN** it reaches the surrounding surface unchanged

#### Scenario: Each popup is a listbox with an announced active option

- **WHEN** either popup is open
- **THEN** the editable region exposes the listbox by reference and names its active option, and a
  persistent polite region announces the list opening and its size

### Requirement: Syntax highlighting, tables and images are strictly tokenized

Every colour used by a code block's syntax highlighting, a table's borders and header surface, and
an image's selected outline SHALL come from a theme token. No stylesheet shipped by the syntax
highlighting library SHALL be loaded.

The syntax token family SHALL be defined in all three presets, in light and in dark, and every
member of it SHALL meet AA contrast against the code block's surface — asserted by the existing
token contrast test rather than by inspection.

#### Scenario: No hardcoded colour reaches the new surfaces

- **WHEN** the stylesheet for tables, code blocks and images is inspected
- **THEN** it contains no literal colour value, only token references

#### Scenario: Every syntax colour passes AA in all six theme variants

- **WHEN** the token contrast test runs
- **THEN** each syntax token in each of the three presets, light and dark, is at least 4.5:1 against
  the code block surface — including the comment colour

#### Scenario: An unmapped highlight class is plain, never invisible

- **WHEN** the highlighter emits a token class the stylesheet does not map
- **THEN** that text inherits the primary text colour
