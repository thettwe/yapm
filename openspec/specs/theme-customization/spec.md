# theme-customization Specification

## Purpose
TBD - created by archiving change design-system. Update Purpose after archive.
## Requirements
### Requirement: User-set accent with auto-derived shades

A user SHALL be able to set a single base accent color that overrides the active preset's accent. From that one base color the system SHALL auto-derive the accent hover shade, the accent active shade, the soft selected-row tint, and the selection-border line color — the user setting none of these directly. When no custom accent is set, the preset's own accent tokens SHALL apply. A base accent value SHALL be validated as a parseable color; an unparseable value MUST be rejected by the shared mutator on both client and server.

#### Scenario: Setting an accent updates all derived states

- **WHEN** a user sets a base accent color
- **THEN** the accent, its hover and active shades, the soft selection tint, and the selection-border color all update from that single value, across every component that uses accent

#### Scenario: Clearing the accent restores the preset default

- **WHEN** a user clears their custom accent
- **THEN** the active preset's own accent tokens apply again

#### Scenario: Invalid accent is rejected

- **WHEN** a client submits an unparseable accent value
- **THEN** the shared mutator rejects the write on both client and server and the stored accent is unchanged

### Requirement: Auto-computed contrast-safe on-accent text

The text color drawn on top of the accent (`--on-accent`) SHALL be auto-computed and MUST NOT be user-settable. It SHALL be chosen so that text on the accent meets WCAG AA contrast: the computation evaluates a near-white candidate and the darkest text candidate and selects the one meeting the AA threshold (the higher-contrast one when both qualify, and the higher-contrast one when neither reaches the threshold). Because the user controls only the base accent, no accent choice SHALL be able to produce unreadable on-accent text.

#### Scenario: Dark accent gets light on-accent

- **WHEN** a user sets a dark accent color
- **THEN** the on-accent text is automatically computed to a light color meeting AA contrast

#### Scenario: Light accent gets dark on-accent

- **WHEN** a user sets a light accent color
- **THEN** the on-accent text is automatically computed to a dark color meeting AA contrast

#### Scenario: User cannot make on-accent unreadable

- **WHEN** a user sets any accent, including an extreme mid-tone
- **THEN** on-accent remains the most-readable available choice and is never a low-contrast color the user selected

### Requirement: Keyboard-operable theme switcher and accent picker

The theme switcher (selecting one of the three presets and toggling light/dark) and the accent picker (setting or clearing the custom accent) SHALL be fully operable without a pointer. Every control MUST be reachable by Tab, adjustable by keyboard (Arrow/Enter/typing a value), and MUST expose an accessible name. Applying a change SHALL update the live UI immediately (optimistically) and persist the `{theme, accent}` preference.

#### Scenario: Keyboard-only preset change

- **WHEN** a user tabs to the theme switcher, selects a different preset with the keyboard, and confirms
- **THEN** the theme changes immediately with no pointer interaction and the preference is persisted

#### Scenario: Keyboard-only accent change

- **WHEN** a user tabs to the accent picker, enters or adjusts an accent value via the keyboard, and confirms
- **THEN** the accent and its derived states update immediately and the preference is persisted

#### Scenario: Keyboard-only mode toggle

- **WHEN** a user tabs to the light/dark toggle and activates it with Enter or Space
- **THEN** the mode flips immediately and is persisted device-locally, with no pointer interaction

