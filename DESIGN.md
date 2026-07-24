# yapm — Design direction

Chosen 2026-07-24 from three rendered explorations (kept in `design-explorations/` as design history).

## Direction: Warm

A distinctive, human aesthetic that stays dense enough for an issue list — the opposite of enterprise-cold, without becoming a toy. The full token set, type scale, and density metrics live in [`design-explorations/warm/DIRECTION.md`](design-explorations/warm/DIRECTION.md); the mockups it was chosen from are the four PNGs beside it.

- **Base**: warm neutrals — soft paper off-white (light) / warm espresso charcoal (dark), never cold slate.
- **Accent**: one committed terracotta/clay, carrying every interactive state (selection, focus bar, links, primary action, command-palette highlight).
- **Type**: Figtree (humanist-geometric sans) for UI; IBM Plex Mono for issue keys, counts, and keyboard hints.
- **Status colors**: earthy semantic scale (honey in-progress, indigo in-review, green done) kept separate from the accent so terracotta never means "status."
- **Density**: ~44px rows — a touch roomier than Linear, still efficient.
- **Dark mode is first-class**, not an afterthought.

The winning direction becomes real theme tokens and core components in `packages/ui` (Tailwind v4 `@theme` + Base UI). Judge shipped screens against the Warm mockups.

## Theme system (built from the start)

yapm ships a **tokenized theme system**, decided 2026-07-24. Every component references semantic tokens (color, font, radius, density) — **never hardcoded values** — so themes are token-set swaps via a `data-theme` attribute. This discipline is non-negotiable regardless of how many themes ship; retrofitting it later means hunting hardcoded colors across the app.

**Shipping now (before/with issue-core):**
- **Three switchable presets** as pure token sets: **Warm (default)**, **Focused**, **Editorial** — differing in color + typography + density + radius only, each with first-class light and dark. Presets are token-level: per-theme *structural* flourishes from the explorations (e.g. Editorial's serif masthead layout, rule-fills) are NOT reproduced — Editorial keeps its serif *headings*, vermilion accent, and mono metadata as tokens, not its bespoke chrome. Distinct, honest, and cheap to maintain.
- **Accent-color customization**: a user-set accent token with auto-derived shades and an **auto-computed, contrast-safe on-accent text color** (users cannot make it unreadable). Covers most of what "customize the palette" means.
- **Per-user preference** for theme + accent, persisted and **synced via Zero** (dogfoods our own sync with a per-user-scoped entity), with a localStorage bootstrap cache to avoid first-paint flash.

**Deferred to a later dedicated change:**
- A **full multi-color theme editor** (arbitrary per-token colors, contrast validation, import/export of theme JSON). The token architecture already makes this a clean add; the editor UI is the cost. Not built while there is still no core tracker to theme.

All presets and any custom accent MUST pass WCAG contrast in both light and dark.

## Issue list: how yapm differs from Linear and Plane

Warm differentiates visually; these differentiate **structurally**. The thesis: **every other tracker's row shows *intention* (a status a human set); yapm's row shows *reality* (state derived from the linked PR ↔ CI ↔ deploy).** That is "reality over ritual" (VISION #3) expressed in the primary surface, and no competitor can copy it without rebuilding their data model.

Committed to the issue-core design (build the layout/model now; git-derived signals populate with `github-sync`, change 8):

1. **Reality strip (build now).** Each issue row reserves a compact delivery-signal slot beside status/priority/assignee — PR state (draft→open→approved→merged), a CI health dot, review age. Pre-github-sync it renders a quiet "not linked" state. The row is designed around this slot from day one so it is never bolted on.
2. **Divergence flag (bake in the concept now).** A quiet marker when the human-set status disagrees with git reality (marked In Progress but PR merged; Done but deploy failed). Rides on the reality strip's data; fires once github-sync lands. yapm's single most defining glyph.
3. **Reality-aware view/filter architecture (design now, populate later).** The saved-view and filter model must be able to query *derived delivery state*, not only status — so `blocked-on-review`, `failing-CI`, `merged-not-deployed` views can be added with github-sync. Do NOT ship those views empty in issue-core; just build the architecture to hold them.

Deferred to github-sync (needs real data, would ship half-empty now):

4. **"Blocked on" axis** — who/what each issue waits on (assignee / reviewer / CI) as a dimension distinct from status. The data model may anticipate it; the UI waits.

Restraint is itself the differentiator from Plane (which is cluttered): show the one right signal — delivery reality — not more chrome.
