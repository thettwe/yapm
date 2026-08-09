# component-library Specification

## Purpose
TBD - created by archiving change design-system. Update Purpose after archive.
## Requirements
### Requirement: Strictly-tokenized core component set

`packages/ui` SHALL provide a core component set — button, input, label, badge, dialog, popover, dropdown/menu, avatar, and tooltip — each styled exclusively through semantic design tokens (no hardcoded color, font, radius, or fixed density). Each component SHALL render correctly under all three presets in both light and dark by virtue of reading tokens only. Interactive components MUST be built on the project's accessible primitives (Base UI) and MUST be fully keyboard-operable with a visible accent focus indicator.

#### Scenario: Component re-themes with no source change

- **WHEN** the active preset or mode changes
- **THEN** every core component re-renders in the new theme purely from token changes, with no component source change

#### Scenario: Keyboard operation of an overlay component

- **WHEN** a user opens a dialog, popover, dropdown, or tooltip and interacts using only the keyboard
- **THEN** focus is managed correctly (trap/return where applicable), Escape dismisses, and every control is reachable and operable without a pointer

#### Scenario: Focus is visibly indicated

- **WHEN** any interactive component receives keyboard focus
- **THEN** a visible focus indicator drawn from the accent token appears

### Requirement: Status glyphs and priority marks as themed components

`packages/ui` SHALL provide status glyph components (backlog, todo, in-progress, in-review, done, canceled) and priority mark components (no-priority, low, medium, high, urgent) as themed components that draw their colors from the semantic status/signal tokens, kept separate from the brand accent so the accent never denotes status. Each glyph MUST carry an accessible label describing the state it represents.

Both SHALL be drawn to the reality vocabulary's single geometry — round-capped strokes of one weight on one grid — so that the whole drawn set reads as one family: the status glyph draws **cycle position** (one loop filled as far as the work has run) and the priority mark draws **weight as ticks**, with one tick standing alone denoting urgent. The `done` glyph SHALL be a filled disc **carrying a check**, drawn on the same grid with the same cap style, its ink taken from a theme token that is distinguishable from every hue the glyph is inked with under every preset in light and dark. There SHALL be exactly one status glyph component and exactly one priority mark component in the system; a surface needing a different size scales the existing one rather than declaring its own.

#### Scenario: Status colors come from status tokens

- **WHEN** a status glyph or priority mark renders under any preset
- **THEN** its color resolves from the semantic status/signal tokens, never from the brand accent token

#### Scenario: Done is a disc with a check in it

- **WHEN** the done status glyph renders at any size a surface draws it
- **THEN** it draws a filled disc with a check inside, the check inked from a theme token rather than a literal color, and no surface substitutes a plain disc for it

#### Scenario: Glyphs are labelled for assistive tech

- **WHEN** a status glyph or priority mark is rendered
- **THEN** it exposes an accessible label naming the status or priority it represents

#### Scenario: The glyphs share one geometry

- **WHEN** a status glyph and a priority mark render beside each other
- **THEN** both are drawn with the same stroke weight, the same cap style and on the same grid, so they read as one family rather than two borrowed sets

### Requirement: Command-palette shell

`packages/ui` SHALL provide a command-palette shell — an accent-highlighted, keyboard-first overlay with a search input, a filtered result list with grouping, an empty state, and keyboard hints — styled to the active theme's tokens. The primitive is the shell only (structure, styling, keyboard behavior); it carries no commands of its own — the app wires the real command set onto it (see the command-palette capability). The palette MUST open, filter as the user types, move selection with arrow keys, activate the selected item with Enter, and dismiss with Escape — all without a pointer.

#### Scenario: Keyboard-only palette use

- **WHEN** a user opens the command palette, types to filter, moves the selection with arrow keys, and presses Enter
- **THEN** the list filters, the active row is accent-highlighted, and the selected item activates — with Escape dismissing — entirely via the keyboard

#### Scenario: Empty state

- **WHEN** the typed query matches no items
- **THEN** the palette shows a themed empty state rather than an empty or broken list

### Requirement: Issue-row primitive with reserved reality-track slot

`packages/ui` SHALL provide an issue-row primitive styled to the Warm mockup's density and layout (priority · status · key · title · a reserved reality-track slot · labels · cycle · date · assignee), reading tokens only. The reality-track slot SHALL be a first-class slot the primitive always lays out; with nothing to draw it SHALL render **reserved and inkless**, and the issue-list and issue-detail surfaces populate it from the delivery-signal computation seam, which the connector-fed work-graph entities make non-null. The row MUST support hover, keyboard-focus, and selected states drawn from the accent tokens, and MUST be focusable and operable by keyboard.

The primitive SHALL NOT carry a separate divergence-flag slot: divergence is drawn as the `//` break on the track itself (see the reality-vocabulary capability), and the primitive SHALL NOT render a warning symbol for it.

`packages/ui` SHALL NOT declare any provider-icon rendering of delivery reality — no pull-request lifecycle icon set, no CI check/cross/spinner icon set, and no deploy icon. Where a surface previously drew those, it draws the track.

#### Scenario: Reserved slots are present but quiet

- **WHEN** an issue-row primitive renders with no linked delivery data
- **THEN** the reality-track slot occupies its reserved measure in the layout, draws no ink at all, and the row layout does not shift when it is populated

#### Scenario: Divergence needs no second slot

- **WHEN** an issue-row primitive renders an issue whose status diverges from git reality
- **THEN** the divergence is visible as the break on the row's track, and the row lays out no separate divergence-flag slot and draws no warning symbol

#### Scenario: Row states use accent tokens

- **WHEN** an issue row is hovered, keyboard-focused, or selected
- **THEN** its hover fill, focus rail, and selected tint/border resolve from the accent tokens under the active preset

#### Scenario: Row is keyboard-focusable

- **WHEN** a user moves focus to an issue-row primitive via the keyboard
- **THEN** the row receives a visible accent focus indicator and is operable without a pointer

### Requirement: Themed showcase across every preset and mode

The change SHALL provide a themed showcase — Ladle stories for the component set and a dev-only `/showcase` route in `apps/web` — rendering the full component set AND a representative static issue-list mockup built from the issue-row primitive. The showcase SHALL let a reviewer switch `data-theme` and light/dark so all three presets in both modes are visually verifiable against the exploration mockups. The `/showcase` route MUST be available only in development builds and MUST NOT ship in production.

#### Scenario: Verify a preset in both modes

- **WHEN** a reviewer opens the showcase and switches to a given preset in light then dark
- **THEN** the component set and the static issue-list mockup render correctly in each, matching that preset's DIRECTION.md

#### Scenario: Showcase route is dev-only

- **WHEN** the application is built for production
- **THEN** the `/showcase` route is not present in the production build

#### Scenario: Keyboard-operable showcase controls

- **WHEN** a reviewer uses only the keyboard to change the preset and mode in the showcase
- **THEN** the controls are reachable and operable without a pointer and the showcase updates accordingly

### Requirement: Mention typeahead listbox inside the rich-text editor

`packages/ui`'s rich-text editor SHALL support an `@`-mention typeahead through a **data-agnostic**
prop: the component receives a list of candidate people and knows nothing about queries, teams or
permissions. Candidate resolution stays with the consuming application.

The mention node SHALL be registered in the shared extension set used by **both** the editable
editor and the read-only renderer, so a document round-tripping through the renderer never loses or
mangles a mention node. The read-only renderer SHALL never open a suggestion popup.

The popup SHALL be a bespoke listbox — not the command-palette primitive, whose input takes focus —
because focus must remain in the editor at all times. It SHALL be mounted **inside the editor's own
wrapper element**, not portalled to the document body, so that its `role="listbox"` participates in
the application's popup-ownership chain and its `aria-activedescendant` reference resolves within
the same subtree.

Every colour, font, radius and spacing value SHALL come from theme tokens. The popup, its active
row, its disabled row and its empty state SHALL meet AA contrast in all three presets, in both light
and dark.

#### Scenario: The read-only renderer round-trips a mention

- **WHEN** a document containing a mention node is rendered read-only and re-read
- **THEN** the mention node is preserved intact and no suggestion popup can open

#### Scenario: Focus stays in the editor

- **WHEN** the mention popup is open
- **THEN** the editor retains focus, the caret remains visible, and typing continues to edit the
  document

#### Scenario: The popup is themed and legible everywhere

- **WHEN** the popup is shown under each of the three presets in light and dark
- **THEN** every colour comes from a token and the active, disabled and empty states all meet AA
  contrast

### Requirement: A layered keyboard contract that never destroys a draft

The editor SHALL implement a layered keyboard contract in which an open mention popup consumes its
keys first and the editor's own shortcuts stand down for any event the popup has already handled.

While the popup is open: Up and Down SHALL move the active option, Home and End SHALL jump to the
first and last, Enter and Tab SHALL accept the active option, and Escape SHALL dismiss the popup
**and nothing else**.

While the popup is closed, the editor's existing shortcuts SHALL behave exactly as before: the
submit shortcut submits and Escape cancels.

The editor's wrapper-level shortcut handler SHALL ignore any keyboard event the popup has already
acted on, and SHALL identify those events by which event the popup consumed rather than by whether
the editor core marked the key as prevented — the core marks **every** submit and cancel key as
prevented whether or not anything handled it, so a guard on that flag disables both shortcuts
outright. Without the distinction, either dismissing the popup also fires cancel (discarding the
whole draft) or cancel never fires at all.

A key the editor or its popup consumed SHALL stop at the editor, because the surrounding dialog's
dismissal does not consult the prevented flag: declining to act is not enough to keep the surface
open. A key nobody consumed SHALL continue to propagate, so shortcuts owned by surfaces above the
editor keep working from inside it.

#### Scenario: Escape dismisses the popup without discarding the draft

- **WHEN** a member has typed a comment, opens the mention popup, and presses Escape
- **THEN** the popup closes, the drafted comment text remains, and the surrounding surface stays
  open

#### Scenario: Escape with no popup still cancels

- **WHEN** a member presses Escape with no mention popup open
- **THEN** the editor's cancel behaviour runs as before

#### Scenario: The submit shortcut accepts the option rather than submitting

- **WHEN** the mention popup is open and the member presses the submit shortcut
- **THEN** the active option is accepted and the draft is not submitted

#### Scenario: Full selection by keyboard alone

- **WHEN** a member types `@`, presses Down, and presses Enter
- **THEN** the second candidate is inserted as a mention with no pointer interaction

### Requirement: The typeahead is announced to assistive technology

The editor SHALL expose the popup's presence and the active option to assistive technology: an
expanded state, a reference to the popup, and a reference to the active option that resolves to an
element in the same subtree.

The popup SHALL be a listbox of options. A live region SHALL announce the number of matches, the
empty state, and the reason an offered-but-unavailable name cannot be selected.

An unavailable option SHALL be reachable by the arrow keys and marked as disabled, so that it is
announced rather than silently absent, and activating it SHALL insert nothing.

#### Scenario: The active option reference is valid

- **WHEN** the popup is open with an active option
- **THEN** the editor's active-descendant reference resolves to an element inside the editor's own
  wrapper

#### Scenario: Match count is announced

- **WHEN** the typed query narrows the candidate list
- **THEN** a polite live region announces the resulting number of matches

#### Scenario: An unavailable name is announced with its reason

- **WHEN** the arrow keys reach an option for a person who cannot be mentioned here
- **THEN** it is announced as disabled together with the reason, and activating it inserts nothing

### Requirement: Search result row and snippet renderer as strictly-tokenized components

The component library SHALL provide a search result row and a snippet renderer, both strictly
tokenized — no hardcoded colour, font, radius or spacing — and both data-agnostic, taking already
resolved display values so the library stays ignorant of queries, teams and permissions.

The result row SHALL render an entity glyph, an issue key in the mono token face, a title, an optional
snippet, and optional state labels (for example triage or canceled), truncating rather than wrapping,
at the same row density as the issue-row primitive. Its active state SHALL use the established
selection idiom — a soft accent wash plus an accent rule — with body ink rather than accent-coloured
text, because accent ink over the soft accent wash measures below AA in several preset and mode
combinations.

The snippet renderer SHALL take text carrying non-markup highlight delimiters and render it as
**segmented text**. It SHALL NOT interpolate its input as HTML under any circumstance.

#### Scenario: A snippet containing markup is rendered literally

- **WHEN** a snippet's text contains characters that look like markup
- **THEN** they are displayed as literal characters and no markup is interpreted

#### Scenario: Highlighted terms are emphasised and readable

- **WHEN** a snippet's highlighted segment is rendered in each of the three presets, light and dark
- **THEN** the emphasis is visible and both the emphasised and unemphasised text meet AA contrast
  against the row background, active and inactive

#### Scenario: The row appears in the themed showcase

- **WHEN** the component showcase is opened
- **THEN** the search result row and snippet renderer appear in every preset in both light and dark,
  including their active, snippet-bearing and state-labelled variants

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

