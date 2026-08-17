# yapm — Design direction

Chosen 2026-07-24 from three rendered explorations (kept in `design-explorations/` as design history).

## Direction: Warm

A distinctive, human aesthetic that stays dense enough for an issue list — the opposite of enterprise-cold, without becoming a toy. [`design-explorations/warm/DIRECTION.md`](design-explorations/warm/DIRECTION.md) is where the colour set, type scale, radii and row density were fixed, and stays authoritative for exactly those; its **sidebar, topbar and toolbar metrics are superseded** by the three-band frame below, and the four PNGs beside it draw a 244px left sidebar the product no longer has.

- **Base**: warm neutrals — soft paper off-white (light) / warm espresso charcoal (dark), never cold slate.
- **Accent**: one committed terracotta/clay, carrying every interactive state (selection, focus bar, links, primary action, command-palette highlight).
- **Type**: Figtree (humanist-geometric sans) for UI; IBM Plex Mono for issue keys, counts, and keyboard hints.
- **Status colors**: earthy semantic scale (honey in-progress, indigo in-review, green done) kept separate from the accent so terracotta never means "status." **Hue separation, not contrast, is what keeps amber, green and urgent apart** — amber against green never reaches 3:1 at any usable lightness, so anything that must be told apart is told apart by shape too (which is why the flow band's added cap is an outline).
- **Density**: ~44px rows — a touch roomier than Linear, still efficient.
- **Dark mode is first-class**, not an afterthought.

The winning direction becomes real theme tokens and core components in `packages/ui` (Tailwind v4 `@theme` + Base UI). **Judge shipped screens against [`design-explorations/overhaul-2026-08/northstar/`](design-explorations/overhaul-2026-08/northstar/)** — five files whose [`NORTHSTAR.md`](design-explorations/overhaul-2026-08/northstar/NORTHSTAR.md) is the canonical set, and which also records the divergences the build was right to take (the active stop's ink, Decisions folded away for want of an entity, and the retuned in-progress amber — the one place the mock is wrong and the product is right).

## The settled vocabulary

Six changes (`one-reality-vocabulary` → `design-corrections`) rebuilt the frame, the team home, the issue list, the issue detail and the Delivery view against the northstar set. What settled, one line each:

- **The frame** — three bands on every authenticated page: the **deck** (48px, identical everywhere), the page-owned **masthead** (title · count · lens · meta · actions), and the **statusline** (32px — the team's day and the sync state).
- **The deck's eight destinations** — Home · Issues · Cycles · Delivery on the bar, then `more▾` holding Triage · Retros · Projects · Roadmap, plus workspace/team, the `⌘K` pill, the attention badge, Inbox and you. Below the deck's comfortable width the bar folds into `more▾` from the right (Delivery, then Cycles); the band never wraps. At most eight destinations, at most four on the bar, at most six menu items at any width.
- **Board is a lens, not a destination** — it lives in the Issues masthead beside List, and the deck's Issues stop stays lit on it.
- **One attention number** — the deck badge, the statusline segment and Home's NEEDS ATTENTION are one derivation over four disjoint exception classes; at zero it is absent, not zeroed.
- **The reality track** — four stations (PR · checks · review · deployed) joined by segments, with the divergence `//` as a *segment kind* positioned by which divergence fired. One language on the row, the digest, the rail and the peek.
- **Glyph geometry** — status is **cycle position** (dashed ring → open ring → half arc → three-quarter arc → filled disc, `done` carrying a knockout check); priority is **weight in ticks**, urgent as one tick standing alone. One family, one 20-unit grid, one 1.6 stroke.
- **Phrases at rest** — a surface says its reality in words from ONE shared dictionary (`Checks failing`, `Done in git, not on the board`, `Built — not live yet`), in three registers: `neutral` for the surfaces of record, `personal` for your own work, and `news` for the dense lists, which draws a phrase only where the row is an **exception** and hands the rest to the reality track's accessible name. A register resolves every key to *drawn*, *quiet* (the words exist and the drawing speaks them) or *silence* — and only where the drawing tells that key apart from every other key it quiets.
- **The two-register bifact** — a plain line for a PM directly above a mono line for an engineer, both built from one signal and one timeline so they cannot drift.
- **The peek** — hover *or* focus opens, ⏎ goes, esc stays; at most one open per page by construction.
- **The `how ·` dot** — a derived number carries a quiet mono `how ·` and explains itself only when asked (click or Enter, never hover).
- **The provenance mark** — monochrome, 12–14px, `currentColor`, after the fact it sourced. Our glyphs carry meaning; brand marks carry provenance.
- **The word diet** — chrome carries labels, surfaces carry phrases, and only the hero of a page is allowed a sentence. Explanatory prose on a work surface is a bug.
- **Nothing draws ink it has no fact for** — a row with no linked change reserves its slot and lays down nothing, and it is `aria-hidden`, because an ornament repeated on sixty of sixty-nine rows is noise in either modality. The issue detail's vertical rail is the deliberate exception: that page's subject *is* the change.

## Theme system (built from the start)

yapm ships a **tokenized theme system**, decided 2026-07-24. Every component references semantic tokens (color, font, radius, density) — **never hardcoded values** — so themes are token-set swaps via a `data-theme` attribute. This discipline is non-negotiable regardless of how many themes ship; retrofitting it later means hunting hardcoded colors across the app.

**Shipping now (before/with issue-core):**
- **Three switchable presets** as pure token sets: **Warm (default)**, **Focused**, **Editorial** — differing in color + typography + density + radius only, each with first-class light and dark. Presets are token-level: per-theme *structural* flourishes from the explorations (e.g. Editorial's serif masthead layout, rule-fills) are NOT reproduced — Editorial keeps its serif *headings*, vermilion accent, and mono metadata as tokens, not its bespoke chrome. Distinct, honest, and cheap to maintain.
- **Accent-color customization**: a user-set accent token with auto-derived shades and an **auto-computed, contrast-safe on-accent text color** (users cannot make it unreadable). Covers most of what "customize the palette" means.
- **Per-user preference** for theme + accent, persisted and **synced via Zero** (dogfoods our own sync with a per-user-scoped entity), with a localStorage bootstrap cache to avoid first-paint flash.

**Deferred to a later dedicated change:**
- A **full multi-color theme editor** (arbitrary per-token colors, contrast validation, import/export of theme JSON). The token architecture already makes this a clean add; the editor UI is the cost. Not built while there is still no core tracker to theme.

All presets and any custom accent MUST pass WCAG contrast in both light and dark, against **two explicit bars** asserted in `contrast.test.ts` for all six theme blocks:

- **Non-text drawing — 3:1** (WCAG 1.4.11), and not against `--bg` alone: against every ground a row or a card is painted on — plain, hovered, the selected row's tint, a selected board card's soft-accent wash and the divergence row's urgent wash.
- **Text — 4.5:1.** A hue that cannot hold both bars **splits** rather than being dragged to 4.5: the drawing keeps the hue and a `-ink` sibling token carries the text, which is why `--status-urgent-ink` and `--status-in-progress-ink` exist in every block. Dragging one amber to 4.5 on near-white produces a brown that closes on editorial's orange urgent — the split is what keeps the family separable.

**Syntax highlighting is a token family, not a stylesheet.** `editor-rich-content` added seven
`--code-*` tokens (keyword, string, number, comment, function, type, punctuation) to every preset in
both modes, each derived from that preset's own hues and asserted at AA against the code block's
surface. **No `highlight.js` theme is ever loaded** — the ~250 it ships hard-code hex, which is
exactly the "hunting hardcoded colors" this section exists to prevent — and an `hljs-*` class with no
mapping inherits `--text-1`, so an unmapped token is plain rather than invisible.

## Issue list: how yapm differs from Linear and Plane

Warm differentiates visually; these differentiate **structurally**. The thesis: **every other tracker's row shows *intention* (a status a human set); yapm's row shows *reality* (state derived from the linked PR ↔ CI ↔ deploy).** That is "reality over ritual" (VISION #3) expressed in the primary surface, and no competitor can copy it without rebuilding their data model.

Committed to the issue-core design (build the layout/model now; git-derived signals populate with `connectors`, change 8):

1. **Reality track (build now).** Each issue row reserves a compact delivery-signal slot beside status/priority/assignee — PR state (draft→open→approved→merged), CI health, review age. The row is designed around this slot from day one so it is never bolted on. **Pre-connectors, and for any issue with no linked change, the slot in a dense row is reserved and renders NO INK at all** — corrected in `design-corrections` after the northstar was first rendered: a placeholder repeated on sixty of sixty-nine rows is an ornament, and `issues.png` draws nothing there. The vertical rail on the issue detail is the deliberate exception and keeps an explicit "no change linked yet" station, because that page's subject *is* the change. **Four signals since `deploy-history-edge`**: a Live station joins them, reached once a deployment carrying the linked PR's merge commit has succeeded — shape, never hue alone, and labelled "Deployed" with no environment claimed (yapm cannot know which environment string means production). Every track, empty or full, occupies one width constant, so the fourth signal still shifts nothing. **Drawn as a track since `one-reality-vocabulary`**: four stations joined by segments, replacing the icon strip that preceded it, so the row, the team digest and every page after them draw delivery in one language — see [`apps/docs` → The reality vocabulary](apps/docs/src/content/docs/features/reality-vocabulary.md).
2. **Divergence (bake in the concept now).** A quiet mark when the human-set status disagrees with git reality (marked In Progress but PR merged; Done but deploy failed). Rides on the reality track's data; fires once connectors lands. yapm's single most defining mark — drawn since `one-reality-vocabulary` as a `//` **break in the track** at the segment the disagreement falls on, rather than the warning triangle beside the row that preceded it.
3. **Reality-aware view/filter architecture (design now, populate later).** The saved-view and filter model must be able to query *derived delivery state*, not only status — so `blocked-on-review`, `failing-CI`, `merged-not-deployed` views can be added with connectors. Do NOT ship those views empty in issue-core; just build the architecture to hold them.

Deferred to connectors (needs real data, would ship half-empty now):

4. **"Blocked on" axis** — who/what each issue waits on (assignee / reviewer / CI) as a dimension distinct from status. The data model may anticipate it; the UI waits.

Restraint is itself the differentiator from Plane (which is cluttered): show the one right signal — delivery reality — not more chrome.
