## Why

yapm has a working data spine (foundation) and a real identity/access graph with row-level sync (workspace-auth), but its surface is still the raw shadcn/Base-UI scaffold: a near-monochrome default theme with hardcoded neutral tokens and no committed aesthetic. Before `issue-core` builds the primary tracker surface, the visual system has to exist — and it has to be **tokenized from the first component**, because retrofitting a token layer means hunting hardcoded colors across the whole app later (DESIGN.md). This change turns the chosen **Warm** direction into real semantic tokens and a strictly-tokenized core component set, ships three switchable presets, adds free per-user accent customization with guaranteed-readable contrast, and dogfoods our own sync with a per-user preference entity — establishing the design substrate `issue-core` will build on, including the reality-strip and divergence-flag slots that are yapm's structural differentiator.

Serves vision principles: **#1 Speed is the feature** (keyboard-first component set, the command-palette shell as a first-class surface, and a no-flash first paint that keeps theme application off the network); **#2 Opinionated defaults, real escape hatches** (Warm is the committed default; three presets plus accent customization are the escape hatch, without a config sandbox); **#3 Reality over ritual** (the issue-row primitive reserves the reality-strip and divergence-flag slots from day one so delivery truth is designed in, not bolted on); **#5 Free means free** (all theming and customization are unpaywalled, with no gates or upsell UI).

## What Changes

- **A tokenized theme architecture.** Every color, font, radius, and density value in `packages/ui` and `apps/web` resolves through semantic tokens — a two-tier scheme (raw per-theme CSS custom properties → Tailwind v4 `@theme inline` utilities). **No hardcoded colors, fonts, or magic sizes** in any component. **BREAKING** to the current scaffold: the generated `globals.css` is re-pointed so `--accent` means the single brand accent (Warm terracotta) rather than shadcn's neutral hover-surface, and `--primary`/`--ring` map to it; scaffold components are updated to the re-pointed tokens.
- **Themes switch via a `data-theme` attribute** on the document root; **light/dark is orthogonal**, driven by the existing `.dark` selector. Any preset composes with either mode (3 × 2 = 6 combinations).
- **Three presets as pure token sets** — **Warm (default)**, **Focused**, **Editorial** — each with first-class light AND dark, matching each `DIRECTION.md` palette/type/density/radius. Presets differ in **tokens only**; per-theme structural chrome from the explorations (e.g. Editorial's serif masthead) is NOT reproduced. Editorial keeps serif headings + mono metadata + vermilion accent as tokens. All presets pass WCAG AA in both modes.
- **Accent customization.** A user-set accent token with auto-derived hover/active shades and soft/line tints, plus an **auto-computed, contrast-safe on-accent text color** — the user never sets on-accent, so a chosen accent can never be made unreadable.
- **A per-user `{theme, accent}` preference**, persisted in the existing Postgres as a new **user-scoped** entity (`user_preference`) and **synced via Zero**, readable and writable ONLY by its owner — extending the row-level permission model to a user-scoped (rather than membership-scoped) shape. A **localStorage bootstrap cache** applied by a tiny inline script prevents first-paint theme flash. Light/dark mode is device-local (not synced), matching the exact `{theme, accent}` sync scope.
- **A strictly-tokenized core component set** in `packages/ui`: button, input, label, badge, dialog, popover, dropdown/menu, avatar, tooltip, and the **command-palette shell** (cmdk). Plus **status glyphs** and **priority marks** as themed components, and an **issue-row primitive** styled to the Warm mockup with a reserved **reality-strip slot** and a **divergence-flag slot** (placeholder content; `issue-core` wires real data later).
- **A themed showcase** — Ladle stories and a dev-only `/showcase` route — rendering the component set AND a representative static issue-list mockup, so every preset is visually verifiable in light and dark.

## Capabilities

### New Capabilities

- `theming`: the tokenized token architecture (two-tier semantic tokens, no hardcoded values), the three presets (Warm default, Focused, Editorial) each with light and dark, the `data-theme` × `.dark` orthogonal composition, WCAG AA guarantees, and the no-flash localStorage bootstrap.
- `theme-customization`: user-set accent with auto-derived shades/tints and an auto-computed contrast-safe on-accent color; the keyboard-operable theme switcher and accent picker; the guarantee that customization cannot produce unreadable text.
- `component-library`: the strictly-tokenized core component set, status glyphs and priority marks, the command-palette shell, the issue-row primitive with reserved reality-strip and divergence-flag slots, and the themed showcase — all keyboard-operable.

### Modified Capabilities

- `local-first-sync`: adds the per-user `user_preference` entity to the synced work graph as the first **user-scoped** (owner-only, not membership-scoped) row, with its own read/write permission story, and clarifies the existing server-controlled-query permission model to cover it.

## Impact

- **Schema** (`packages/schema`): new `user_preference` Kysely table + forward-only migration `0003_user_preference` + Zero schema table and relationship; new owner-scoped synced query and `preference.set` mutator (client-minted UUIDv7 at call site); an `isAuthenticated` context predicate; drift-test coverage for the new table. No new container — the table lives in the existing Postgres.
- **UI** (`packages/ui`): re-pointed `globals.css` with the two-tier token layer and all six preset×mode token blocks; new/updated tokenized components (button, input, label, badge, dialog, popover, menu, avatar, tooltip, command palette); status/priority glyph components; the issue-row primitive; accent-derivation and WCAG-contrast utilities; Ladle stories.
- **Web** (`apps/web`): the inline no-flash bootstrap script in `index.html`; a theme provider that applies the synced preference to the DOM and reconciles the localStorage cache; the theme switcher / accent picker UI; the dev-only `/showcase` route; fonts (Figtree, IBM Plex Mono, Inter, Fraunces, JetBrains Mono) added as tokenized families.
- **Dependencies**: add `cmdk` (command-palette shell) and the required font packages to the pnpm catalog; use existing Base UI primitives for popover/tooltip/avatar. No server or infrastructure change.

## Non-goals

- **The full multi-color theme editor** — arbitrary per-token color editing, contrast validation UI, and theme-JSON import/export. The token architecture makes this a clean later add; only accent customization ships now (DESIGN.md).
- **Any issue data or behavior** — the issue-row primitive is a presentational primitive with placeholder content and reserved slots; real issue entities, queries, keyboard list navigation (j/k/x), and the reality/divergence data all belong to `issue-core` and `github-sync`.
- **Reproducing per-theme structural layouts** from the explorations (Editorial's serif-masthead chrome, bespoke rule-fills). Presets are token-level only.
- **Syncing light/dark mode** — mode is device-local; only `{theme, accent}` sync.
- **A settings/preferences surface beyond theme** — no unrelated account settings are introduced.
