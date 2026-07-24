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

## Issue list: how yapm differs from Linear and Plane

Warm differentiates visually; these differentiate **structurally**. The thesis: **every other tracker's row shows *intention* (a status a human set); yapm's row shows *reality* (state derived from the linked PR ↔ CI ↔ deploy).** That is "reality over ritual" (VISION #3) expressed in the primary surface, and no competitor can copy it without rebuilding their data model.

Committed to the issue-core design (build the layout/model now; git-derived signals populate with `github-sync`, change 8):

1. **Reality strip (build now).** Each issue row reserves a compact delivery-signal slot beside status/priority/assignee — PR state (draft→open→approved→merged), a CI health dot, review age. Pre-github-sync it renders a quiet "not linked" state. The row is designed around this slot from day one so it is never bolted on.
2. **Divergence flag (bake in the concept now).** A quiet marker when the human-set status disagrees with git reality (marked In Progress but PR merged; Done but deploy failed). Rides on the reality strip's data; fires once github-sync lands. yapm's single most defining glyph.
3. **Reality-aware view/filter architecture (design now, populate later).** The saved-view and filter model must be able to query *derived delivery state*, not only status — so `blocked-on-review`, `failing-CI`, `merged-not-deployed` views can be added with github-sync. Do NOT ship those views empty in issue-core; just build the architecture to hold them.

Deferred to github-sync (needs real data, would ship half-empty now):

4. **"Blocked on" axis** — who/what each issue waits on (assignee / reviewer / CI) as a dimension distinct from status. The data model may anticipate it; the UI waits.

Restraint is itself the differentiator from Plane (which is cluttered): show the one right signal — delivery reality — not more chrome.
