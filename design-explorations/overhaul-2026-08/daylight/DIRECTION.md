# daylight/ — the composite, corrected

**Thesis:** keep every drawn delivery fact the instrument direction earned, but make the app
speak product, not git. frame/'s shell carries the identity, warm-deepened's flat elevation
budget keeps it calm, instrument's drawn data survives — translated. Density lives in the
issue list alone; every other surface gets editorial air and a real display scale. A PM should
be able to read every visible word; an engineer should find the shas one level down, on demand.

## The phrase dictionary (used everywhere, verbatim)

| delivery state | what the UI says |
|---|---|
| not linked to a change | *(quiet — say nothing, draw nothing)* |
| PR open, review waiting | **In review — waiting 16h** |
| CI failing | **Checks failing** |
| merged, not deployed | **Built — not live yet** |
| merged + deployed | **Live** |
| status_behind_merge divergence | **Done in git, not on the board** |
| the divergence callout's second line | **The work moved, the ritual didn't.** |
| statusline | **Cycle 2, day 9 of 14 · 8 shipped · 3 deploys this week · 1 needs attention** |

Metric renames on Delivery: "CI failing" → **Checks failing**, "No linked PR" → **Not linked
to a change**, "PR cycle time" → **Open to merged**. Git vocabulary (PR #188, 8f21c4a, "14 of
14 checks passed", branch → main) survives only as smaller mono second lines in the detail
rail — never in the list, never in a header.

## What came from each sibling

- **frame/** — the shell: 244px `--bg-sidebar` sidebar, Acme masthead + ⌘K search,
  Inbox(3)/My Issues/Search, TEAMS tree with the terracotta active rail, user + connection
  footer, breadcrumb topbar; the palette's workspace-echo header, right-aligned mono keys and
  warm ink scrim [structural].
- **warm-deepened/** — the elevation budget: every persistent surface is flat, separated by
  1px hairlines; rounded card + warm shadow only on the transient palette [structural]. Also
  the drawn-break divergence mark (`//`) and the shared 6-cycle sparkline guide columns.
- **instrument/** — the drawn data, translated: connected reality tracks in rows (nodes +
  line + break, **no PR/CI/REV/DEP header row**; the selected row carries its plain phrase
  beside the track), the ship-cadence strip, the cycle-flow band with carry ribbons, the
  vertical metro rail on detail, and the statusline — now speaking human [structural].

## What this direction adds

- **Display scale** [structural]: Delivery masthead at 48px, hero numerals at 60px with
  deltas as designed pill-marks (▲/▼, colored by better/worse, not by direction); 34px
  secondary numerals; 34px title on issue detail. This is the A/B:
  - `delivery-a.html` — Figtree pushed (wght 650–700, tracking −0.032/−0.035em).
  - `delivery-b.html` — **Fraunces** (opsz 90) on the masthead title + hero numerals ONLY;
    everything else identical, so the A/B isolates the typeface.
- **Editorial air** [structural]: Delivery and detail get 52–64px margins, 640px prose
  max-width, 52–56px section rhythm. The issue list keeps 44px rows and 11 rows + 3 group
  headers above the fold; its masthead and filter frame breathe instead.
- **Quiet rows are actually quiet** [structural]: unlinked issues draw nothing — no empty
  four-dot track (both siblings self-criticized their "drawn nothing").
- **Human statusline** [structural]: bottom strip on every surface, Figtree not mono, zero
  percentages: the dictionary line above, "needs attention" in urgent.

## Token notes

Everything painted is the Warm LIGHT block from `packages/ui/src/styles/globals.css`,
verbatim [token]. Three extensions, noted in each file's head comment: row hairline `#efe9dd`
(lightened `--border`, from frame/), statusline bg `#f4efe5` (bg↔sidebar midpoint, from
instrument/), `--urgent-soft` `rgba(204,90,64,.08)` (urgent at `--accent-soft`'s derivation
rule). Fraunces appears in delivery-b only; it is already in the repo's font imports.

## Self-critiques

- `issue-list.html` — the money shot holds 11 rows + statusline with air to spare, but the
  five quiet rows now end ragged at the label column; a real 120-issue list would need to
  prove the raggedness reads as "nothing to report", not "not loaded".
- `issue-detail.html` — the rail tells the whole ENG-116 story in plain words, but the left
  column is still lighter than the rail is interesting; activity history would need to earn
  the balance back.
- `delivery-a.html` — the Figtree heroes are confident and the page finally breathes, though
  the carry ribbons between cycle bars are so polite they nearly vanish at a glance.
- `delivery-b.html` — Fraunces sits beautifully on the terracotta paper and makes 52/46h/26%
  feel like a report cover; risk is it reads more "annual report" than "tool" next to the
  all-Figtree rest of the app.
- `palette.html` — strongest inheritance, least invention: the delivery-phrase result rows
  prove the dictionary survives in a 12px right column, but "ISSUES · WHERE THE WORK REALLY
  IS" is one section title away from cute.
