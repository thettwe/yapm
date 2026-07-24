# theming Specification

## Purpose
TBD - created by archiving change design-system. Update Purpose after archive.
## Requirements
### Requirement: Tokenized theme architecture

Every color, font family, radius, and density value rendered by `packages/ui` or `apps/web` SHALL resolve through a semantic design token; components MUST NOT contain hardcoded color, font-family, radius, or fixed density values. Tokens SHALL be organized in two tiers: a raw per-theme layer of CSS custom properties (the palette, type, radius, and density values) and a Tailwind v4 `@theme inline` layer that maps utility classes to the raw layer. Swapping a theme SHALL rewrite only the raw layer; the utility layer and every component MUST remain unchanged. The single committed brand accent SHALL be the token `--accent` (carrying selection, focus, links, and the primary action); the scaffold's former neutral-hover meaning of that name MUST be removed so "accent" has exactly one meaning across the codebase.

#### Scenario: No hardcoded values in components

- **WHEN** any component in `packages/ui` or `apps/web` is inspected for styling
- **THEN** its colors, fonts, radii, and density come only from semantic token utilities, with no literal hex/oklch color, font-family name, or magic size

#### Scenario: A theme swap touches only the token layer

- **WHEN** the active theme's raw token layer is replaced
- **THEN** every component re-renders in the new theme with no change to component source or to the utility-token layer

#### Scenario: Brand accent carries interactive state

- **WHEN** an element is selected, focused, a link, or a primary action
- **THEN** its accent color resolves from the single `--accent` token, and no component uses a second conflicting meaning of "accent"

### Requirement: Theme selection by attribute, orthogonal light/dark

The active theme SHALL be selected by a `data-theme` attribute on the document root, and light/dark SHALL be an independent axis selected by the standard dark selector (`.dark` on the document root). The two axes SHALL compose freely: any theme MUST render correctly in both light and dark. Absence of a `data-theme` attribute SHALL resolve to the default theme (Warm), and absence of an explicit mode SHALL resolve from the operating-system `prefers-color-scheme`.

#### Scenario: Switching theme independent of mode

- **WHEN** `data-theme` changes while the mode (`.dark` presence) is held constant
- **THEN** only the theme's identity (palette, type, density) changes and the current light/dark mode is preserved

#### Scenario: Switching mode independent of theme

- **WHEN** the `.dark` class is toggled while `data-theme` is held constant
- **THEN** the same theme renders in the other mode with no change to the selected theme

#### Scenario: Default when unset

- **WHEN** the document root has no `data-theme` attribute
- **THEN** the Warm theme is applied, in the mode indicated by `prefers-color-scheme`

### Requirement: Three presets, each with light and dark

The system SHALL ship exactly three switchable presets as pure token sets — **Warm** (default), **Focused**, and **Editorial** — each with a first-class light AND dark token block, transcribed from the corresponding `design-explorations/<preset>/DIRECTION.md` palette, type scale, density, and radius. Presets SHALL differ in tokens only (color, typography, density, radius); per-theme structural chrome from the explorations MUST NOT be reproduced. Editorial SHALL retain serif headings, monospace metadata, and a vermilion accent as tokens (not as bespoke layout). Every preset MUST pass WCAG AA contrast for its text-on-surface and text-on-accent pairs in both light and dark.

#### Scenario: Each preset renders in both modes

- **WHEN** a preset is selected in light mode and again in dark mode
- **THEN** it renders a complete, correct token set in each mode, matching its DIRECTION.md palette and type/density metrics

#### Scenario: Presets are token-level only

- **WHEN** Editorial is selected
- **THEN** its serif headings, mono metadata, and vermilion accent apply as tokens while the app's structural layout is identical to the other presets (no serif-masthead chrome)

#### Scenario: All presets meet AA contrast

- **WHEN** each preset's text-on-surface and text-on-accent color pairs are measured in both modes
- **THEN** every pair meets the WCAG AA contrast threshold, and a preset that failed would fail CI

### Requirement: No first-paint theme flash

The applied theme and mode SHALL be present on the document root before first contentful paint, with no flash of an incorrect theme. A localStorage bootstrap cache of the resolved preference SHALL be applied synchronously at document load, before the application bundle runs. When the synced preference later resolves, it SHALL be treated as the source of truth: applied to the document root and written back to the localStorage cache. Light/dark mode SHALL be persisted device-locally (not synced), defaulting from `prefers-color-scheme`.

#### Scenario: Returning user sees no flash

- **WHEN** a user who has a cached preference reloads the app
- **THEN** the correct `data-theme` and mode are set on the document root before first paint, with no visible flash of a different theme

#### Scenario: Synced preference reconciles the cache

- **WHEN** the synced `{theme, accent}` preference resolves after load and differs from the cached value
- **THEN** the synced value is applied to the document root and written back to the localStorage cache as the new source of truth

#### Scenario: First-ever visit uses defaults

- **WHEN** a user with no cached preference and no synced row loads the app
- **THEN** the Warm theme is applied in the `prefers-color-scheme` mode, with no flash or error

