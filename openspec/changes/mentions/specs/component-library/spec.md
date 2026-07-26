## ADDED Requirements

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
