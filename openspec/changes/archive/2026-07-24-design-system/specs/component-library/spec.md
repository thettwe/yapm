## ADDED Requirements

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

`packages/ui` SHALL provide status glyph components (backlog, todo, in-progress, in-review, done) and priority mark components (no-priority, low, medium, high, urgent) as themed components that draw their colors from the semantic status/signal tokens, kept separate from the brand accent so the accent never denotes status. Each glyph MUST carry an accessible label describing the state it represents.

#### Scenario: Status colors come from status tokens

- **WHEN** a status glyph or priority mark renders under any preset
- **THEN** its color resolves from the semantic status/signal tokens, never from the brand accent token

#### Scenario: Glyphs are labelled for assistive tech

- **WHEN** a status glyph or priority mark is rendered
- **THEN** it exposes an accessible label naming the status or priority it represents

### Requirement: Command-palette shell

`packages/ui` SHALL provide a command-palette shell — an accent-highlighted, keyboard-first overlay with a search input, a filtered result list with grouping, an empty state, and keyboard hints — styled to the active theme's tokens. This change ships the shell only (structure, styling, keyboard behavior) with placeholder items; real commands are wired by a later change. The palette MUST open, filter as the user types, move selection with arrow keys, activate the selected item with Enter, and dismiss with Escape — all without a pointer.

#### Scenario: Keyboard-only palette use

- **WHEN** a user opens the command palette, types to filter, moves the selection with arrow keys, and presses Enter
- **THEN** the list filters, the active row is accent-highlighted, and the selected item activates — with Escape dismissing — entirely via the keyboard

#### Scenario: Empty state

- **WHEN** the typed query matches no items
- **THEN** the palette shows a themed empty state rather than an empty or broken list

### Requirement: Issue-row primitive with reserved reality-strip and divergence-flag slots

`packages/ui` SHALL provide an issue-row primitive styled to the Warm mockup's density and layout (priority · status · key · title · a reserved reality-strip slot · labels · cycle · date · assignee · a divergence-flag slot), reading tokens only. The reality-strip slot and the divergence-flag slot SHALL be first-class reserved slots present from the start (rendering a quiet placeholder / empty state now); `issue-core` and `github-sync` populate them later. The row MUST support hover, keyboard-focus, and selected states drawn from the accent tokens, and MUST be focusable and operable by keyboard.

#### Scenario: Reserved slots are present but quiet

- **WHEN** an issue-row primitive renders with no linked delivery data
- **THEN** the reality-strip slot and the divergence-flag slot are present in the layout in a quiet placeholder/empty state, and the row layout does not shift when they are later populated

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
