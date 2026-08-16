# Design — delivery-legibility

## Context

The mission input is `openspec/SCOPE-legibility.md`. Its "Found while walking" section
(`:218-229`) names these two drawings, and — unusually — names its own first draft's error about
them:

> Delivery's `CYCLE FLOW` and `REVIEW RHYTHM` are the two least readable drawings in the product:
> bars labelled `8 9 10 11 12 0` with no axis, and twenty micro-tracks with no legend. **Corrected
> 2026-08-15, and the correction is instructive.** An earlier draft of this line assigned the caption
> removal to B1. That was wrong: `openspec/specs/delivery-metrics/spec.md:263-266` *mandates* those
> sentences… The readability problem is real and stays open; it belongs to whoever next owns the
> Delivery surface, as a change that argues that requirement rather than routing around it.

This is that change. It argues `delivery-metrics` on its own terms, and it keeps every standfirst.

What already exists and must be **used, not rebuilt**:

- `packages/schema/src/zero/metrics/page.ts` — `buildFlow` (`:952-1045`) and `buildRhythm`
  (`:1051-1112`). Every string on these two sections is already produced here; the view "RENDERS
  and formats nothing" (`apps/web/src/delivery/delivery-view.tsx:43-46`).
- `packages/ui/src/components/distribution-strip.tsx` — the page's legible drawing, and therefore
  the working model: tick marks with the unit inside the label (`:182-203`), a labelled rule
  (`:205-225`), notes stating the population in words (`:253-286`), and an exported pure layout
  function that keeps two notes off one baseline (`layoutDistributionNotes`, `:81-123`).
- `apps/web/src/delivery/delivery-view.tsx:307-346` — `Section`, whose `aside` slot (destructured
  `:311`, typed `:317`, drawn `:330`) already carries a mono label on the rhythm section (`:404`,
  `showing 24 of 31`).
- `packages/ui/src/components/flow-band.tsx` and `review-rhythm.tsx` — structural props, static
  inline SVG, no motion, no tooltip, every colour a token. That contract does not change.

Constraints inherited and not negotiable here: **no product code in this change** (the maintainer's
process choice, `SCOPE-legibility.md:47`); tokens only, at the two bars `DESIGN.md:48-51` states;
keyboard-first; sub-100ms; every derivation in `packages/schema`.

## Goals / Non-Goals

**Goals**

- A reader who has never seen this page can say what a bar, a ribbon, a cap and a track are, from
  the page alone, without opening a `how ·` and without a legend.
- The 96-hour axis every rhythm track is drawn on is stated somewhere on the page at rest.
- One rule, written once, that binds the next drawing too — so the next chart does not re-decide it.
- A measured zero stops looking like a column that failed to render.
- Fewer words on `CYCLE FLOW` than it draws today.

**Non-Goals**

- Removing, shortening or folding a section standfirst (D1; `explanation-at-rest` D10).
- A legend, a key, a swatch table, an axis title, a caption, a footnote or a tooltip (D1).
- A y-axis on `CYCLE FLOW` (D5).
- Touching the refusal block, the mandated metrics promise, the stat tiles, the annotated timeline,
  the peek, the window selector or `OPEN TO MERGED` (D12).
- Any new metric definition, DORA key, synced entity, query, mutator, migration or container.

## Decisions

### D1 — The budget is *labels and drawn marks*, and every other shape is closed by name

Three separate rules converge on the same answer, which is why the fix has to be a mark:

| what a chart designer reaches for | why it is unavailable |
|---|---|
| a legend paragraph under the chart | `delivery-metrics/spec.md:265-266` — only labels and drawn marks; `:280` — *"no legend … appears beside the drawing"*; and `explanation-at-rest`'s merged `reality-vocabulary` rule (`specs/reality-vocabulary/spec.md:11`) makes **a legend** a derivation that folds behind `how ·` |
| a y-axis captioned `issues shipped` | `:280` forbids an **axis title** by name |
| a longer standfirst that explains the marks | `:268-269` — a standfirst SHALL state what the data *says*, derived from that data, not a fixed string; "green is shipped" is not a finding and would not track the rows |
| a tooltip on hover | `:271-272` and `:233` — no information reachable only by hover |
| putting it all in the `how ·` | it is already there (`page.ts:1041`, `:1108`) and the drawing is still unreadable at rest. `explanation-at-rest`'s D3 is the reason: `how.tsx` renders `{open ? … : null}`, so a folded key is **absent from the document**, for every reader. A key nobody can find is not a key |

What survives is a **label on a mark**. That is not a leftover; `DESIGN.md:33` states it as the
positive rule — *"chrome carries labels, surfaces carry phrases, and only the hero of a page is
allowed a sentence."*

**The line this change writes down: a name drawn on a mark is not a legend.** A legend is
*detached* from the ink it explains — a second block, in a second place, that a reader has to hold
in memory while looking somewhere else. That is what makes it a thing to learn, and it is what the
word diet was right to delete. `+2 added` sitting on the cap it names has been on this page since
`delivery-journalism` shipped and nobody has called it a legend. The distinction is drawn into the
journalism-cut requirement, at the site where its own scenario creates the ambiguity, so a later
change is bound by it rather than by this paragraph.

### D2 — The rule: a drawing names each quantity once, on the first mark of that kind

> Every quantity a drawing carries SHALL be named on the drawing, **once**, on the first mark of
> that kind in reading order, in the label register. The remaining marks of that kind carry the bare
> value.

Two halves, and both are already shipped somewhere on this page:

- **Named at all** — `northstar/delivery.html:255` labels its first carryover ribbon `2 carried`;
  `distribution-strip.tsx:192-201` carries `h` inside every tick label; the statusline on all five
  mocks reads `8 shipped` (`delivery.html:270`, byte-identical per `NORTHSTAR.md:42-43`).
- **Only once** — `DESIGN.md:34`: *"an ornament repeated on sixty of sixty-nine rows is noise in
  either modality."* Five ribbons each saying `carried` is that rule, five times over.

**"First in reading order" is not always the first mark, and the rule says so rather than leaving
two requirements to disagree.** A window's leftmost cycle may carry nothing and add nothing; a
rhythm's first drawn change may have run past the axis and drawn no merge disc at all (D6). In both
cases the first mark in reading order is not a mark of the kind being named. So the rule is written
as *the first mark of that kind **that is actually drawn***, and it **defers** to any per-drawing
selection rule the capability already states — the review-rhythm requirement's worked-example rule
is exactly such a rule, and the delta makes the deferral explicit on both sides rather than leaving
a reader to infer which sentence wins. The once rule keeps the count; the drawing's rule keeps the
choice.

The mock is caught between the two conventions: it names `carried` once and repeats `added` on all
six caps. The build then regularised in the wrong direction — `page.ts:994` gives **every** ribbon
`${count} carried`. This change settles it in the direction the mock chose for the harder case, and
applies it to all three quantities without exception. **A rule with an exception nobody can state is
not a rule**, which is why `+N added` is not spared: `+3` above an outlined cap, three columns after
`+2 added`, is the same fact in fewer words.

### D3 — `CYCLE FLOW`: three quantities, three marks, three names

```
today
──────────────────────────────────────────────────────────────────────────
 CYCLE FLOW                                                          how ·
 Carryover is shrinking — 1 item carried from Cycle 11 into Cycle 12,
 where 3 carried from Cycle 10 into Cycle 11.

   +2 added    +1 added    +3 added    +2 added    +4 added
     ┌─┐         ┌─┐         ┌─┐         ┌─┐         ┌─┐
     ┆ ┆         ┆ ┆         ┆ ┆         ┆ ┆         ┆ ┆      ← cap, outlined
     ███ 2       ███ 1       ███ 3       ███ 2       ███
     ███carried~~███carried~~███carried~~███carried~~███      ← ribbon, all four
     ███         ███         ███         ███         ███        labelled (page.ts:994)
  ───┴───────────┴───────────┴───────────┴───────────┴───────────────────
    5 ago       4 ago       3 ago       2 ago       1 ago       last
      8           9           10          11          12          0
      ▲                                                          ▲
      nothing on this page says                    a measured zero paints
      what these numbers count                     nothing at all


after
──────────────────────────────────────────────────────────────────────────
 CYCLE FLOW                                                          how ·
 Carryover is shrinking — 1 item carried from Cycle 11 into Cycle 12,
 where 3 carried from Cycle 10 into Cycle 11.          ← standfirst unchanged

   +2 added       +1          +3          +2          +4
     ┌─┐         ┌─┐         ┌─┐         ┌─┐         ┌─┐
     ┆ ┆         ┆ ┆         ┆ ┆         ┆ ┆         ┆ ┆
     ███ 2       ███ 1       ███ 3       ███ 2       ███
     ███carried~~███~~~~~~~~~███~~~~~~~~~███~~~~~~~~~███
     ███         ███         ███         ███         ███
  ───┴───────────┴───────────┴───────────┴───────────┴──────────▄▄───────
    5 ago       4 ago       3 ago       2 ago       1 ago       last
  8 shipped       9           10          11          12          0
      ▲                                                          ▲
      the statusline's own idiom,                    a flat stub: a cycle
      applied to the drawing the                     that shipped nothing,
      count belongs to                               not a missing column
```

Net word change on this section: **+1** (`shipped`) **−7** — three `carried` (four labelled ribbons
today, one after) and four `added` (five labelled caps today, one after).

The bar's label is chosen for the leftmost drawn bar, the ribbon's for the leftmost drawn ribbon,
the cap's for the leftmost drawn cap — each independently, because a window may draw bars with no
ribbon at all (`delivery-metrics/spec.md:409-410`) and the rule must still name what is drawn.

### D4 — A measured zero gets a mark, and that is not "ink with no fact"

`flow-band.tsx:139-146` paints `<rect … height={bar.shippedH}>`, and `shippedH = bar.shipped * unit`
(`:59`). A cycle that shipped nothing gets `height=0`, which paints nothing. The column keeps its
`last` label and its `0` and draws no ink.

`DESIGN.md:34` — *"Nothing draws ink it has no fact for"* — is the rule this looks like it might
break, and it does not: the fact is *this cycle shipped zero*, and `page.ts:945-947` says so in the
code, in as many words —

> Falling back to zero is only ever reached for a Delivered count, which is defined for every cycle
> in the window — a cycle that shipped nothing shipped zero, where a FLOW measure with nothing
> behind it is `undefined` and is never read through here.

So the page holds two distinct states — **a measured zero** and **no measurement** — and the same
capability already requires them to look different everywhere else. `delivery-metrics/spec.md:57`:
*"the drawing breaks across the gap rather than being drawn through it."* On the flow band the two
have collapsed into one appearance: nothing.

The stub is a bar of zero height drawn as a 2px cap on the baseline, in `--status-done`, the token
the bar already uses (pinned at `contrast.test.ts:603`). It is not a connection and it is not a cap,
so `delivery-metrics/spec.md:409-410` — *"no zero-valued connection or empty cap is drawn"* — is
untouched and is restated verbatim in the delta.

Considered and rejected: **leaving it, on the grounds that the `0` under the column already says
it.** The counts are the reading; the bars are the *comparison*, and a comparison with a silently
missing member is the failure the walk actually reported (`8 9 10 11 12 0` reads as six numbers over
five shapes).

### D5 — No y-axis on `CYCLE FLOW`, and the complaint named the wrong thing

The scope line says *"bars labelled `8 9 10 11 12 0` with no axis"*. The axis is the symptom the
walker had a word for; the disease is that the numbers have no noun. An axis with ticks
`0 4 8 12` and no title (which `:280` forbids anyway) leaves a reader knowing the *scale* of
something still unnamed.

And the counts are already exact under every bar. A y-axis would buy an approximation of a number
the drawing states precisely, at the cost of a gridline, five tick labels and roughly 60px of the
left margin. `flow-band.tsx:55` also caps the unit at `MAX_UNIT = 13`, so the vertical scale is
already a presentation choice rather than a measurement — drawing an axis over it would dress a
layout constant as a scale.

**Rejected, and recorded, because the next reviewer will ask for it.**

### D6 — `REVIEW RHYTHM`: one ruler, one worked track, and a mark unit in the slot that exists

```
today
──────────────────────────────────────────────────────────────────────────
 REVIEW RHYTHM   showing 24 of 31                                    how ·
 A first review arrived a median of 5h after a change opened, and reviews
 came back a median of 2 times per change.

  ○┈●━━◉      ○┈┈┈●━━━◉    ○┈●━◉        ○┈┈●━●━◉    ○┈●━◉    ○┈┈●━━◉
  ○┈┈┈●━━◉    ○┈●━◉        ○┈┈●━━◉      ○┈┈┈●━━━◉   ○┈●━◉    ○┈┈●━━◉
  ○┈┈┈┈●━━━◉  ○┈●━◉        ○┈┈┈┈┈●━━━◉  ○┈┈●━━◉     ○┈┈┈●━━◉ ○┈●━◉
  ○┈┈┈┈┈●━━━◉ ○┈●━◉        ○┈┈●━━◉      ○┈┈┈●━━◉    ○┈┈┈●━→208h  ○┈┈●━→236h

  twenty-four of these. no scale, no unit, no name on any mark. the only
  statement of what one row is lives in the SVG's `aria-label` (page.ts:1104-1105)


after
──────────────────────────────────────────────────────────────────────────
 REVIEW RHYTHM   one row · one merged pull request · showing 24 of 31  how ·
 A first review arrived a median of 5h after a change opened, and reviews
 came back a median of 2 times per change.             ← standfirst unchanged

  opened  merged
  ○┈●━━◉      ○┈┈┈●━━━◉    ○┈●━◉        ○┈┈●━●━◉    ○┈●━◉    ○┈┈●━━◉
  ├────┴────┤
  0   48h  96h

  ○┈┈┈●━━◉    ○┈●━◉        ○┈┈●━━◉      ○┈┈┈●━━━◉   ○┈●━◉    ○┈┈●━━◉
  ○┈┈┈┈●━━━◉  ○┈●━◉        ○┈┈┈┈┈●━━━◉  ○┈┈●━━◉     ○┈┈┈●━━◉ ○┈●━◉
  ○┈┈┈┈┈●━━━◉ ○┈●━◉        ○┈┈●━━◉      ○┈┈┈●━━◉    ○┈┈┈●━→208h  ○┈┈●━→236h

  the worked track is grid cell (0,0) and stays there — it shares its baseline
  with the five other tracks in row one. the ruler spans that cell's own 166px
  slot, 0 to the full 96h axis, not the track's own ink and not the width of the
  grid (review-rhythm.tsx:47, `x0 = (index % columns) * slot + 4`, COLUMNS = 6).
  nothing moves out of the grid. the other twenty-three tracks are bare.
```

Three moves, each argued separately:

**The ruler.** `charts-applied.html:187` — *"The scale runs 0–96h"* — was the only statement of this
axis that has ever been on a page, and the word diet deleted it. `REVIEW_RHYTHM_AXIS_HOURS = 96`
(`page.ts:122`) currently reaches a reader only through the `how ·` body (`page.ts:1108`) and the
`role="img"` label (`:1105`). The ruler restores it as ticks, in the mono idiom
`distribution-strip.tsx:192-201` already ships, with the unit inside the label (`48h`) rather than
as an axis title. Drawn **once**, under the **worked** track — the same row the two names land on,
so the ruler and the names read as one annotated example rather than as two annotations of two
different rows. Where `workedIndex` is `null` (every drawn change over-axis) the ruler falls back to
the first drawn track, because a scale with no worked row is still the scale.

**The worked track names two marks, not three.** `opened` above the open ring, `merged` above the
merge disc. `first review` is deliberately **not** drawn, and this is the decision most worth
disagreeing with. Two reasons:

1. The three marks sit at 0, `firstReviewHours` and `spanHours` on a 166px track
   (`review-rhythm.tsx:39-40`: `1120/6 − 20`). `first review` is twelve mono characters; on any
   track whose first review arrives early — which is most of them, since the standfirst reports a
   median of hours — it would overlap `opened`. Solving that needs a second baseline and a leader
   line, which is 14px of headroom and three more strokes to explain one word.
2. **The standfirst already names it.** `page.ts:1088` assembles *"A first review arrived a median
   of Xh after a change opened, and reviews came back a median of N times per change."* — so the
   section's one permitted sentence has already told the reader that first reviews and rounds are
   what this drawing counts. Naming the ends orients the track; the sentence supplies the middle.
   That is the journalism cut working as designed rather than being worked around.

If the eyeball pass (task 12.2) finds the review dot still unreadable, the third name goes on
its own baseline with a leader — the mechanism is already drawn on this page
(`distribution-strip.tsx:264-273`) and nothing in the delta forbids it. Recorded as the fallback so
it is a decision rather than a rediscovery.

**Which track is worked, by a stated rule over the data.** The first drawn track that is **not**
over-axis. An over-axis row has no merge disc at all — `review-rhythm.tsx:110-140` draws an arrow
and the row's own duration instead — so it has no `merged` mark to name. If every drawn track is
over-axis, only `opened` is named. This is the shape `delivery-metrics/spec.md:312-313` already
demands of the timeline's call-out: *"selected by a **stated deterministic rule** over the data"*.

### D7 — The mark unit goes in the `aside` slot that already exists, and only where no mark can say it

`markUnit` is declared on all four sections (`page.ts:682`, `:931`, `:1037`, `:1104`) and rendered on
**none**. A repository grep finds it in exactly two places, both assertions
(`packages/schema/src/zero/metrics/page.test.ts:454`, `:511`). It reaches a reader only inside each
chart's `role="img"` label.

So `delivery-metrics/spec.md:153` — the three drawings are drawn *"each stating what one mark
represents"* — is satisfied for assistive technology and for nobody else. **The sighted reader is
the one reader this page does not tell.** That inversion is the finding; rendering the value is the
fix.

It lands in `Section`'s existing `aside` slot (`delivery-view.tsx:311`, typed `:317`, drawn
`:330`), which the rhythm
section already uses for `capLabel` (`:404`): `one row · one merged pull request · showing 24 of 31`.
A mono label goes into a mono label slot already drawn on this section — no new chrome, no new
component, `Section` unedited.

The rhythm's `markUnit` shortens from *"one row is one merged pull request, from its open to its
merge"* to `one row · one merged pull request`, matching `apps/docs/…/delivery.md:115`'s own words.
The clause it drops is exactly what the ruler and the two names now draw. The full sentence survives
in the `role="img"` label (`page.ts:1105`), which is unchanged.

**`CYCLE FLOW` gets no aside, and that asymmetry is the rule rather than an exception to it.** The
aside states only what no mark can. On the flow band the marks now say everything: `8 shipped`,
`2 carried`, `+2 added`, and `5 ago … last` under each bar already says one bar is one cycle. On the
rhythm, no mark can say *what one row is* — a row is the whole drawing, and a drawing cannot label
itself from inside. `OPEN TO MERGED` keeps its empty aside for the same reason: its callouts
(`page.ts:902`, `18 of 26 merged inside 46h`) already state the population on the drawing, which is
the evidence this whole change rests on and would be silly to contradict two sections later.

### D8 — The naming decision lives in `packages/schema`, not in the drawing

The once rule is a decision about *which mark is first*, over an ordered list. The model has the
list; the drawing has pixels. `buildFlow` therefore emits the finished label per mark —
`countLabel` beside `shipped`, and the existing `addedLabel` (`page.ts:971`) and `carry.label`
(`:994`) narrowed to their first drawn instance — and `buildRhythm` emits the tick values, the two
mark names and the index of the worked track.

Three reasons, in order of weight:

1. **It is unit-testable without rendering.** "The second ribbon is bare" is an assertion over an
   array in `page.test.ts`, not a `queryByText` over an SVG.
2. `delivery-metrics/spec.md:274-275` already requires derivation text to be *"produced by the same
   layer that produces the number, not by the rendering surface"*, and `delivery-view.tsx:43-46`
   states the same discipline for this whole page.
3. `flow-band.tsx` and `review-rhythm.tsx` are shared `packages/ui` components with stories
   (`flow-band.stories.tsx`, `review-rhythm.stories.tsx`) and no schema import. Teaching them a
   naming convention would give a drawing an opinion about English.

### D9 — Separation is decided by one derivation, and it is the one already on this page

Two labels drawn on one baseline that run together are worse than one label, and this page has
already paid for that lesson: `delivery-metrics/spec.md:362-368` requires the distribution's
callout separation to be *"decided by a single derivation over the callouts' drawn positions and
estimated widths"*, with an estimate that *"SHALL NOT under-measure any type face the product's
presets bind to the mono role"* — implemented as `layoutDistributionNotes`
(`distribution-strip.tsx:81-123`) over `NOTE_CHAR_W = 7.2` (`:52-56`).

The worked track's two names have the same exposure at one data shape: a change that opened and
merged inside an hour draws `opened` and `merged` at nearly the same x. The rule is the same shape,
not a second machine — where the two would not clear a stated gap, `merged` is dropped and `opened`
stands alone, because a track whose ends coincide has nothing for the second name to disambiguate.
D6's track selection already excludes the over-axis case, which is the other shape that removes the
merge mark.

`CYCLE FLOW` needs none of this: its labels are centred under fixed-width columns
(`flow-band.tsx:50-51`), and lengthening the first count from `8` to `8 shipped` widens a label
inside a slot that is `(1060−60)/n` wide — 166px at the default window of six. Recorded so the task
list checks it at `n = 12`, the bound `delivery-metrics/spec.md:23` sets (83px per slot, and
`8 shipped` at 11px mono is roughly 65px).

### D10 — No new token, no new contrast pair, and the reason that is checkable

Every mark this change adds reuses ink already pinned for this page in
`packages/ui/src/styles/contrast.test.ts`:

| new mark | token | already asserted |
|---|---|---|
| the zero stub | `--status-done` | `:603` — *"the timeline's deployment dot, the rhythm's merge node, the flow band's shipped bar"*, ≥ 3.0 on `--bg` |
| `8 shipped` (the count label) | `--text-1` | the count text already uses it (`flow-band.tsx:185`) |
| `+2 added`, `2 carried`, the tick labels, `opened`, `merged` | `--text-2` | the cap label (`flow-band.tsx:170`), the bar label (`:175`) and the distribution's ticks (`distribution-strip.tsx:198`) all already use it |

So `contrast.test.ts` gains **no** pair, and that is a falsifiable claim rather than a hope: if a
task reaches for a new token or a new ground, the design is wrong and the assertion list is where it
shows up. `DESIGN.md:12` is the reason the zero stub is a *shape* on the baseline rather than a
faint tint of the bar — *"anything that must be told apart is told apart by shape too."*

### D11 — The northstar is annotated, not re-rendered

`CLAUDE.md` makes `design-explorations/overhaul-2026-08/northstar/` canonical, and this change moves
what two of `delivery.html`'s drawings look like. `SCOPE-legibility.md:65-68` settles the procedure —
*"the specs win, and the northstar is redrawn or annotated afterwards… Whichever change moves the
frame owns that redraw; leaving the mocks contradicting the product is the one outcome ruled out."*

This change **annotates**: a fourth entry under `NORTHSTAR.md` §"What the build kept, and the three
places it had to diverge" (`:54-83`), in the register the amber entry already uses — *"The mock is
wrong here and the product is right"* (`:79`). Re-rendering the five HTML files is rejected: their
consistency guarantees are `md5`-checked across all five (`:40-41`), the four other files draw no
chart, and a hand-edited SVG in one file would break a check that has real value for a change that
has none of its own to add there.

The annotation must say the honest thing, which is not flattering to either side: **on
`REVIEW RHYTHM` the build did not diverge from the mock at all** — `delivery.html:261` draws the
same unlabelled micro-tracks the product ships. The mock is where the illegibility entered, in the
same correction pass that was right about everything else.

### D12 — What this change does not touch, and why each is somebody else's

- **The refusal block** (`delivery-view.tsx:426-471`) — `explanation-at-rest`'s D1 protects it, and
  it is a refusal rather than a key to a drawing.
- **The mandated metrics promise** (`delivery-view.tsx:146`) — `app-frame/spec.md:228-230` mandates
  it, `SCOPE-legibility.md:96-103` records it as examined and kept, and
  `delivery-view.test.tsx:278`/`:280` plus `page.test.ts:856-865` run unedited as the proof.
- **The stat tiles, the annotated timeline, the peek and the window selector** — none is a drawing
  the walk could not read.
- **`OPEN TO MERGED`** — it already obeys D2, which is the evidence D2 is built on.
- **The three standfirsts** — D1, and `explanation-at-rest` D10.
- **A DORA metric, or any new metric definition** — `delivery-metrics/spec.md:458-467` requires the
  definition→place mapping to stay total, so a new definition needs a home and a drawing. Different
  change, and `:186-221` is the requirement it would have to argue.

## Risks / Trade-offs

- **The once rule asks the reader to transfer a name across marks.** A reader who scans right-to-left
  meets `12` before `8 shipped`. Accepted: the alternative is the repetition `DESIGN.md:34` calls
  noise, and the drawing is read left-to-right because its own x-axis is time. The `role="img"`
  label (`page.ts:1038`) states every cycle and its count regardless, so the transfer is never the
  only route to the fact.
- **One ruler under one track, read as governing twenty-four.** Every track shares the scale but
  each column restarts at its own origin (`review-rhythm.tsx:47`), so the ruler literally aligns
  with column one only. This is the sharpest aesthetic risk in the change and it is what task 12.3
  exists to look at.
- **`first review` is unnamed** (D6). Mitigated by the standfirst; the fallback is written down.
- **`8 shipped` at a twelve-cycle window.** D9 sizes it; the task list checks it rather than
  assuming.
- **A zero stub could read as a very small bar.** It is drawn at the baseline with no height, which
  is a different shape from a short bar; the count `0` under it is the disambiguator, and it is
  already drawn.
- **This change edits two shared `packages/ui` components**, which `explanation-at-rest` deliberately
  avoided. Unavoidable here — the marks are the fix — and bounded: both components are used by the
  Delivery view and their own stories, and nothing else (`grep -rl 'FlowBand\|ReviewRhythm'`).

## Migration Plan

Nothing to migrate. No schema, no data, no env, no container, no route, no dependency. Two model
functions gain fields, two drawings gain marks, one view passes one more prop.

## Open Questions

None blocking. Two judgements no assertion can settle, both named as tasks rather than approximated:
whether one ruler under one track reads as governing the grid (12.3), and whether the unnamed review
dot is genuinely carried by the standfirst above it (12.2).

## Appendix — the delta-hazard check, run rather than assumed

PROCESS.md §1 requires this before a delta is written, and `openspec validate --all` cannot catch
what it looks for. Run 2026-08-16:

```sh
grep -rn "Requirement:" openspec/changes/*/specs/*/spec.md
```

It was run **twice**, and the second run is why it is worth writing down. The first covered the four
in-flight changes PROCESS.md §1 names (`explanation-at-rest`, `front-door`, `destination-budget`,
`decision-record`). By the time this proposal was finished there were **six** — `phrase-is-news` and
`config-wait` were authored in parallel, in the same working session, and `validate --all` grew from
47 items to 50 without a word about it. That is the hazard doing exactly what §1 says it does: the
set of siblings is not a fact you check once.

**Neither run found any in-flight change touching `delivery-metrics`.** The capabilities under
contention are `app-frame` (`destination-budget`, `front-door`, `decision-record`), `team-home`
(`explanation-at-rest`, `destination-budget`, `decision-record` — the collision PROCESS.md §1 was
written from), `reality-vocabulary` (`explanation-at-rest`, `phrase-is-news`), `issue-list`
(`front-door`, `phrase-is-news`), `projects`, `board`, `retrospective`, `issue-detail`,
`command-palette`, `triage`, `decisions`, `local-first-sync` and `self-host-deploy`. None of the four
requirement names this change touches — *"The page is a journalism cut — a sentence, then the
evidence"*, *"Cycle flow is drawn as bars with the carried work flowing between them"*, *"Review
rhythm is drawn as one small multiple per change"*, and the new *"A drawing states its own key, on
its marks"* — appears in any sibling.

So the baseline is `openspec/specs/delivery-metrics/spec.md` as it stands, and **this change imposes
no archive-order obligation and inherits none.** The existing obligation among the siblings —
`explanation-at-rest` → `destination-budget` → `decision-record` (`SCOPE-legibility.md:202-204`) —
is unaffected either way, and this change may archive at any point in it. Task 14.1 re-runs the grep
before archive, because the answer is only true as of the hour it was asked, and this appendix has
already been wrong once about how many siblings there were.

One adjacent hazard, checked and clear: `explanation-at-rest`'s `reality-vocabulary` delta is merged
but **not archived**, so `openspec/specs/reality-vocabulary/spec.md` is stale. This change does not
delta `reality-vocabulary`, and it does not restate anything that change wrote — including
`delivery-metrics/spec.md:271`'s stricter page-local `how ·` obligation, which
`explanation-at-rest`'s design D2 deliberately left standing and which this change's
journalism-cut delta carries through **verbatim**.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **A name on a mark is not a legend** (D1). A legend is detached from its ink; that is what makes it
  a second thing to learn, and it is what the word diet was right to delete.
- **Named once, on the first mark of its kind that is actually drawn** (D2), applied to all three of
  the flow band's quantities without exception — including the `+N added` cap the mock repeated. The
  once rule **defers** to a drawing's own stated selection rule for *which* mark carries the name;
  the review-rhythm worked-example rule is the one such rule in play, and the delta says so in both
  requirements.
- **A measured zero draws a stub** (D4); it is neither a connection nor a cap, so
  `delivery-metrics/spec.md:409-410` is untouched.
- **No y-axis on `CYCLE FLOW`** (D5). The missing thing is a noun, not a scale.
- **The rhythm names two marks, not three** (D6), with the third's fallback recorded rather than
  forgotten.
- **The mark unit is drawn only where no mark can carry it** (D7) — the rhythm's aside, not the flow
  band's and not the distribution's.
- **The naming rule lives in `packages/schema`** (D8), so "the second ribbon is bare" is an assertion
  over data.
- **No new token and no new contrast pair** (D10). If a task reaches for one, the design is wrong.
- **The northstar is annotated, not re-rendered** (D11), and the annotation says that
  `REVIEW RHYTHM` is a place the build did not diverge and should have.
- **Not one standfirst is removed, shortened or folded.** `explanation-at-rest` D10 handed this
  problem forward on exactly that condition.
- **`ROADMAP.md` is not edited by this change** — siblings are authored in parallel and that file is
  the guaranteed conflict; the row is taken once by whoever integrates
  (`SCOPE-legibility.md:190-193`).

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
