## Context

Everything this change touches already exists and already has one owner:

- `packages/ui/src/components/reality-track.tsx` owns both orientations. `HorizontalTrack` draws the
  stations and the reserved mono age column; `VerticalRail` draws the issue detail's rail. The shape
  is computed by `buildRealityShape(strip, { divergence })` / `buildRailShape(stations, …)`, and a
  fact-free horizontal shape is exactly `[empty, empty, empty, empty]` with three `dotted` segments
  and no `broken` segment.
- Every dense surface already passes a track through that one component. `issue-list.tsx` always
  passes `realityTrack`, with `age={null}` when there is no review age; `team-home.tsx` passes a
  track on its YOURS rows and on the divergence attention row; `issue-row.tsx`'s own
  `EmptyRealityTrack` fallback is what a caller that passes nothing gets. So the correction belongs
  in `HorizontalTrack`, not in three call sites.
- `packages/ui/src/components/status-glyph.tsx` draws all six statuses on one 20-unit grid with a
  1.6px round-capped stroke. `done` is currently `<circle r="7.6" fill="currentColor" />`, and the
  file's own comment argues the check away.
- `apps/web/src/zero/connection.ts` is the single place a connection state becomes words.
  `sync-indicator.tsx` renders `connection.label` and owns the four data hooks the e2e suite reads.
- `packages/ui/src/styles/globals.css` holds six token blocks; `contrast.test.ts` measures them and
  is the only mechanical guard on the palette.

Measured baseline, taken from the shipped tokens before any edit (sRGB, the same maths
`contrast.test.ts` uses):

| preset | `--status-in-progress` vs `--bg` |
|---|---|
| warm light | 2.69 |
| focused light | 2.17 |
| editorial light | 2.87 |
| warm dark | 8.80 |
| focused dark | 9.03 |
| editorial dark | 9.49 |

The three darks already clear both bars comfortably. Only the lights are broken.

## Goals / Non-Goals

**Goals:**

- A dense row with no delivery fact draws nothing in its reality slot, while the slot's reserved
  measure is bit-for-bit what a populated row's is.
- `done` reads as *finished* at 14px, in one family with the arcs and rings.
- Band 3's healthy state says `Synced`, and no other connection state's wording moves.
- `--status-in-progress` clears the contrast bar appropriate to each way it is actually drawn, in
  all six token blocks, with the measurement pinned in `contrast.test.ts` at the real bar.

**Non-Goals:**

- The vertical rail's empty station. Out of scope by explicit instruction and by argument: the rail
  is the issue detail's subject, and a page about the change that draws nothing where the change
  would be says less than one that states "no change linked yet".
- Any second connection label, any change to `data-testid="connection-status"`, `data-connection`,
  `data-recovery` or the retry affordance.
- Any schema, query, mutator or migration. Any new service. Any restyle beyond these four.

## Decisions

### D1 — The quiet rule is a property of the SHAPE, applied in one place

A horizontal track renders no ink when its shape carries **no fact and no break**: every station is
`empty` and no segment is `broken`. That predicate is computed once, inside `HorizontalTrack`, and
exported as a named helper so a test can assert the rule rather than re-derive it.

Rejected: a `quiet` prop that callers opt into. Three call sites setting a flag is three chances to
disagree about what "empty" means, and the constraint this vocabulary exists to enforce is that
there is exactly one empty state. Rejected also: fixing it in `issue-row.tsx`'s `EmptyRealityTrack`
fallback — `issue-list.tsx` never reaches that fallback, because it always passes a track built from
a possibly-null strip.

Consequence, stated plainly so the reviewer can object to it up front: **board cards go quiet too.**
`board-card.tsx` draws a horizontal track from `buildRealityShape(null)` and will now draw nothing
there. That is the same rule and the same mock behaviour, and forking a second empty state to spare
one surface is the bug this component was written to prevent.

A *partially* populated track is untouched: a strip with a PR but no deployment still draws its
hollow stations and dotted segments, exactly as `issues.html` draws them on ENG-115 and ENG-119.
The hollow ring is scaffolding **between facts**; with no facts at all there is nothing to scaffold.

### D2 — A quiet track is silent to assistive technology as well as to the eye

The blank slot renders as `aria-hidden`, with no `role="img"` and no "No delivery signal yet" label.

The alternative — keep the label — was considered and rejected. A screen reader reading a list
would announce "No delivery signal yet" on most rows on the page: the audible form of exactly the
ornament this correction removes. The precedent is in the same file: `issue-row.tsx`'s phrase slot
already documents that a row with nothing true to say renders "genuinely blank — never a dash,
never filler", and it carries no label either.

The label is **not** lost where it carries meaning: a track that draws any fact keeps its composed
`role="img"` label, and `realityTrackLabel(null)` still returns "No delivery signal yet" for the
surfaces that state it in words (the board card's own accessible text, the docs' description of the
label contract). What changes is that a blank drawing does not announce itself.

Fallout, both directions: `apps/web/e2e/issues.spec.ts` asserts `getByLabel('No delivery signal
yet')` is visible on a freshly created row — that assertion is rewritten to assert the reserved,
quiet slot. `apps/web/e2e/connectors.spec.ts` twice asserts that label has count 0 once a PR syncs
in; those would become vacuously true, so they are rewritten to assert the quiet marker is absent,
which keeps them meaningful.

### D3 — The reserved measure is proven by measurement, not by inspection

The slot keeps `width: REALITY_TRACK_WIDTH` and, when the surface draws an age column, the
`AGE_COLUMN_WIDTH` child. `reality-track.test.tsx`'s existing width-parity test is **kept and
strengthened**, not replaced: a quiet track and a populated one at the same measure must report the
same reserved width and the same age-column width, and additionally the quiet one must contain no
node, no segment and no break element. The alignment guarantee is the thing this correction is most
able to break, so it gains an assertion rather than losing one.

A `data-quiet` attribute on the slot gives the e2e suite something to point at that is not a colour.

### D4 — `done` carries a check as a knockout, and the knockout ink is a token

`done` stays a filled disc on the same grid; the check is drawn **inside** it, in a colour that
contrasts against the disc. Two candidate tokens were measured against every hue the glyph is ever
inked with (`--status-done`, and `--status-urgent`, which `team-home.tsx` applies to the glyph on an
urgent say row):

| preset | `--bg` vs done | `--bg` vs urgent | `--on-accent` vs done | `--on-accent` vs urgent |
|---|---|---|---|---|
| warm light | 3.82 | 3.85 | 4.09 | 4.11 |
| focused light | 5.00 | 3.66 | 5.00 | 3.66 |
| editorial light | 3.85 | 3.60 | 3.95 | 3.70 |
| warm dark | 6.06 | 5.39 | 6.06 | 5.39 |
| focused dark | 5.27 | 5.34 | 5.27 | 5.34 |
| editorial dark | 7.23 | 7.69 | 7.23 | 7.69 |

Both clear 3:1 everywhere. **`--bg` is chosen**: the check reads as the page showing through the
disc, which is the same knockout idiom the vertical rail already uses for its node haloes, and it
keeps the brand accent's ink token off a status mark (`component-library`: the accent never denotes
status). `contrast.test.ts` gains an assertion covering both hues so a later token edit has to argue
with the number.

The check itself keeps the family: round caps, the shared stroke constant, endpoints on the same
20-unit grid. If the 1.6px shared weight proves illegible at the 14px a dense row renders —
1.12 device px — the build may step the check's stroke up by one value **and record the exact value
and the reason here**, because a stroke weight the family does not share is a divergence the next
reader deserves to find written down.

`canceled` is untouched: it is the product's sixth status, already redrawn on this grid, and nothing
about it is wrong.

### D5 — `Synced` replaces `Connected`, at the one place a state becomes words

The edit is one string in `summarizeConnection`. Nothing else in that function moves — `connecting`,
`disconnected`, `needs-auth`, `error` and `closed` each already say something true and specific, and
"Synced" would be a lie in every one of them. `sync-indicator.tsx` is not edited at all: it renders
`connection.label`, and that is the correct seam.

Four unit-test fixtures across `apps/web/src` hard-code `label: 'Connected'` as a stub; those are
fixtures, not assertions, but they are updated so the stubs describe the product. The one real
assertion (`sync-indicator.test.tsx`) and `connection.test.ts` move to `Synced`.

The e2e suite reads `data-connection="connected"` — the state name, not the label — in fifteen
specs. None of them changes, which is exactly why the attributes are named in the spec.

### D6 — The amber is retuned in the lights, and the token SPLITS rather than being dragged to 4.5

`--status-in-progress` is drawn two different ways:

| usage | kind | bar |
|---|---|---|
| the in-progress half-arc (`status-glyph.tsx`) | non-text drawing | 3:1 |
| the label dot on an issue row (`issue-row.tsx` `LABEL_TONE`, a `bg-current` dot) | non-text drawing | 3:1 |
| the attention amber square (`team-home.tsx`) | non-text drawing | 3:1 |
| the connecting / needs-auth sync dot (`sync-indicator.tsx`) | non-text drawing | 3:1 |
| the project and roadmap `active` dots | non-text drawing | 3:1 |
| the retro caution card's mark | non-text drawing | 3:1 |
| the flow band's added-block outline (`flow-band.tsx`, `drawn.tsx`) | non-text drawing | 3:1 |
| the scope band's `+` in an added block (`drawn.tsx`, 9px bold) | **text** | 4.5:1 |
| the hero's in-progress count (`team-home.tsx`, 20px bold) | **large text** | 3:1 |

Only one usage is normal-size text, and it is 9px. Dragging one amber to 4.5:1 on a near-white
ground lands it around `#9a671c`–`#9c6d19`: a brown, not an amber, and in editorial light it closes
on that preset's `--status-urgent` (`#cc6b13`, itself an orange) rather than staying clearly apart
from it. That fails two of the three stated constraints to satisfy the third.

So the token **splits**, following the precedent already in this palette:

- `--status-in-progress` — the drawn hue. Retuned in the three light blocks until it clears **3:1**
  against `--bg`, staying recognisably amber and staying clearly separated from `--status-done` and
  `--status-urgent`. Unchanged in the three darks (8.80–9.49 measured), which are asserted rather
  than assumed.
- `--status-in-progress-ink` — the text ink, clearing **4.5:1** against `--bg` and against the two
  composited grounds amber text is drawn on. In the darks it aliases `--status-in-progress`, exactly
  as `--status-urgent-ink` does in two of the three dark blocks. The 9px `+` takes it.

This is the same shape as `--status-urgent` / `--status-urgent-ink` (PR #31), for the same reason,
and it means the amber stays amber. The alternative — one token at 4.5 — is recorded here so that a
later change wanting it finds the measurements rather than re-taking them.

The `>= 2.1` / `>= 1.3` pair in `contrast.test.ts` §"records the added cap's tint as reinforcement"
is **replaced** by real bars. The surrounding decision — that the flow band's added cap is an
outline separated by page ground rather than a stacked fill — stands on its own (two quantities must
be two shapes at any contrast, and amber-vs-green never reaches 3:1 in any preset), so the drawing
does not revert; only the assertion that documented a break becomes an assertion that prevents one.

### D7 — The mock is wrong about the amber, and `NORTHSTAR.md` says so

The northstar files carry the failing amber verbatim from the Warm LIGHT block. Accessibility wins.
`NORTHSTAR.md` §"What the build kept, and the two places it had to diverge (PR #33)" is the
established form for recording this; a third divergence is appended there with its measured numbers,
so a future assembly pass does not "fix" the product back to the mock.

The other three corrections move the product **toward** the mocks, so they need no divergence note.

### D8 — Scope, settled before the build starts

No new tables, no new queries, no mutators, no migration — this is drawing and tokens. These four
corrections are the whole change. Keyboard-first and the sub-100ms budget are untouched: nothing
here adds a network wait, a layout pass or a focus stop.

## Risks / Trade-offs

- **The quiet rule reaches board cards.** Argued and accepted in D1, but it is the one place where
  the correction's blast radius exceeds its brief. If a reviewer wants board cards to keep the
  placeholder, the honest answer is a second empty state and a reason written down, not a prop.
- **Silence for screen readers (D2).** Removing the label removes an announcement some reader may
  have relied on. Mitigated by the label surviving everywhere a fact is drawn, and by the phrase
  slot's identical precedent — but it is a judgement call, not a measurement.
- **The check's legibility at 14px cannot be settled by a test.** A geometry test can assert the
  path exists, that it is drawn on the shared grid with round caps, and that its ink is a token; it
  cannot assert that a human reads it as a check at 1.12 device px. That is eyes-on.
- **"Recognisably amber" is likewise not machine-checkable.** The contrast numbers are, and the
  separation from green and terracotta can be bounded numerically, but whether the retuned value
  still reads as amber in Warm light is a human call.
- **`--status-in-progress` is a `--chart-1` alias.** Retuning it moves any chart drawn from
  `--chart-1`. That is intended (the same hue, legible), but the delivery charts should be looked at
  once after the retune.
- **e2e churn.** Two spec files change assertions. The risk is weakening them by accident; both
  rewrites assert something *stronger* (the presence of a reserved-but-quiet slot, the absence of a
  quiet marker on a populated row) rather than deleting the check.
- `apps/web/e2e/projects.spec.ts` has shown timeout flake independent of any change. Re-run before
  diagnosing; do not loosen it.

## Decisions made during implementation

<!-- Ambiguities resolved while building go here: what was ambiguous, what was chosen, and why. -->
