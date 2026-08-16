## Why

Two drawings on the Delivery page cannot be read. A UX walk of the running app found them
(`openspec/SCOPE-legibility.md:218-219`): **`CYCLE FLOW`**, bars labelled `8 9 10 11 12 0` under
`5 ago / 4 ago / … / last` with no statement anywhere of what those numbers count; and
**`REVIEW RHYTHM`**, roughly twenty micro-tracks of dots and segments with no scale and nothing
naming a single mark.

The interesting part is not that they are hard to read. It is **why**, and the answer is on the
record with a date.

`design-explorations/overhaul-2026-08/plays/charts-applied.html` — the play these two sections were
assembled from — carried one legend paragraph under each chart. Under the flow band, `:178-179`:

> What each cycle **shipped** (green), **carried into the next** (amber — the count rides the
> ribbon), or **canceled** (hollow). +n is scope added after the cycle started.

Under the small multiples, `:186-188`:

> One line per merged change, no names: sand is waiting for the first look, violet is review (dots
> are rounds), the green dot is the merge. **The scale runs 0–96h**; → means it ran past.

The northstar assembly deleted all three legends, deliberately and correctly.
`design-explorations/overhaul-2026-08/northstar/delivery.html:6` records it in the file's own header
— *"Corrections applied: word diet — chart legends and derivation footnotes are gone"* — and
`NORTHSTAR.md:35` counts the saving: *"~45% — legends and derivation footnotes gone, one rule line
kept."*

**Nothing replaced them.** `OPEN TO MERGED` did not need replacing, because its marks had already
been drawn to name themselves: ticks carrying their unit (`distribution-strip.tsx:192-201`, `48h`,
`96h`), a median rule labelled `median 46h` (`:216-225`), and callouts stating the population in
words (`page.ts:902`, `18 of 26 merged inside 46h`). The other two had no such marks, so when the
paragraph went, the key went with it. The word diet was right; its application was total where it
should have been a **transfer**.

The build then reproduced the mock faithfully. `flow-band.tsx:187` draws `{bar.shipped}` as a bare
number and the string `shipped` appears **nowhere** in the flow section — the one occurrence in the
entire mock is in the statusline, one band below (`delivery.html:270`, `8 shipped`).
`review-rhythm.tsx` draws no tick, no axis label and no mark name at all.

Vision principles served: **speed is the feature** (`VISION.md:41`), whose text is about interaction
latency — *"Sub-100ms interactions, keyboard-first, command palette everywhere… If yapm is slow,
nothing else matters"* — and whose claim this change extends by one step, from how fast the page
arrives to how fast it can be read: a drawing a reader must decode costs more than the number it
replaced, and the decode is not the kind of slowness a profiler catches. And **reality over ritual**
(`VISION.md:45` — *"Wherever a fact can come from git, CI, or deploys, it is never asked of a
human"*): the page whose whole subject is not asking currently asks its reader to guess what a bar
is.

## The constraint, which is the whole design problem

`openspec/specs/delivery-metrics/spec.md:263-266` **mandates** the section standfirsts and, in the
same breath, sets the budget every fix has to live inside:

> The Delivery view SHALL be composed of sections, each of which leads with **one sentence stating
> what the data says** and then draws the evidence for it. Those section standfirsts SHALL be the
> only place on this work surface where a full sentence is allowed; everywhere else the page SHALL
> speak in **labels and drawn marks**.

The sentences therefore stay. `explanation-at-rest` (built, PR #59) declined to remove them for
exactly this reason and recorded the decision as a deliberate departure from its own scope line
(its `design.md` D10: *"Deleting them is an amendment to `delivery-metrics`… Dressing that up as
enforcement of the `how ·` prohibition would be precisely the quiet contradiction this family exists
to stop"*). **This change is the one D10 handed the problem forward to, and it does not reverse
D10** — not one standfirst is deleted, shortened or folded.

Two further walls close the box, and they are the reason this is design work rather than a trim:

1. **`delivery-metrics/spec.md:280` forbids the obvious fix by name.** Its scenario ends *"…and no
   legend, **axis title** or derivation footnote appears beside the drawing."* So a y-axis captioned
   *"issues shipped"* is not available.
2. **A legend is banned product-wide as of `explanation-at-rest`.** Its `reality-vocabulary` delta
   (`openspec/changes/explanation-at-rest/specs/reality-vocabulary/spec.md:10-13`) defines a
   derivation as *"a caption sentence, **a legend**, a footnote, a tooltip, or a mono clause line"*
   and requires it to fold behind `how ·`. Restoring `charts-applied.html`'s paragraphs would revert
   a change merged four days ago.

What is left is **labels and drawn marks**. That is not a poverty budget; it is the brief. Everything
a legend would have said has to be said **on a mark**.

## What Changes

**One rule, taken from the drawings that already obey it.** A drawing SHALL name each quantity it
carries **once**, on the first mark of that kind *that is actually drawn*, in reading order, in the
label register; the remaining marks of that kind carry the bare value. Where a drawing's own
requirement already states a deterministic rule for choosing the named mark, **that rule governs and
the once rule defers to it** — the review-rhythm worked example is the one such rule here, and the
delta writes the deferral into both requirements so they cannot be read as contradicting. This is
not invented here:

| where it already ships | the naming mark | the bare ones |
|---|---|---|
| `northstar/delivery.html:255` (the mock) | first ribbon `2 carried` | `1`, `3`, `2`, `4` |
| `flow-band.tsx:163-174` | every cap `+2 added` | — (the rule is applied to *all*) |
| `distribution-strip.tsx:192-201` | ticks carrying `h` | — |
| statusline, all five mocks (`NORTHSTAR.md:42-43`) | `8 shipped` | — |

The mock caught itself between two conventions: it names `carried` once and repeats `added` six
times. The build then regularised the wrong way — `page.ts:994` labels **every** ribbon `N carried`,
which is `DESIGN.md:34`'s ornament rule (*"an ornament repeated on sixty of sixty-nine rows is noise
in either modality"*) five times over. This change settles it: once, on the first mark, for all
three quantities. **The flow band ends up with fewer words than it draws today.**

**`CYCLE FLOW` — three quantities, three marks, and now three names.**

| mark | at rest today | after |
|---|---|---|
| the bar's count (`flow-band.tsx:187`) | `8` `9` `10` `11` `12` `0` | `8 shipped` `9` `10` `11` `12` `0` |
| the ribbon (`page.ts:994`) | `2 carried` `1 carried` `3 carried` `2 carried` | `2 carried` `1` `3` `2` |
| the cap (`page.ts:971`) | `+2 added` `+1 added` `+3 added` | `+2 added` `+1` `+3` |

**And a measured zero stops drawing like missing data.** `flow-band.tsx:139-146` paints the shipped
rect at `height={bar.shippedH}`; a cycle that shipped nothing gets `height=0` and paints nothing, so
the walk's last column is empty ground under the label `last`. The page already requires the
opposite distinction elsewhere — `delivery-metrics/spec.md:57` makes a metric's *absence* break the
drawing *"rather than being drawn through it"* — and here the two states have collapsed into one
appearance. A zero gets a flat stub on the baseline, so the eye counts six columns where the labels
promise six.

**No y-axis is added, and that is a decision rather than an omission.** The complaint named the
missing axis; the missing thing is a noun. An axis with ticks `0 4 8 12` and no title would leave a
reader knowing the scale of something unnamed, while the exact counts are already printed under every
bar — so the axis costs ink and buys an approximation of a number the drawing already states.

**`REVIEW RHYTHM` — the scale and the marks, each stated once.**

- **A tick ruler under the worked track only** — `0`, `48h`, `96h` in the mono tick idiom
  `distribution-strip.tsx:192-201` already ships. `REVIEW_RHYTHM_AXIS_HOURS = 96` (`page.ts:122`) is
  stated at rest for the first time; today it lives only in the `how ·` body (`page.ts:1108`) and in
  the `role="img"` label.
- **One track is a worked example** — the first drawn track that is *not* over-axis, which is
  usually but not always the first (design D6): `opened` at its open ring, `first review` at its
  first review mark, `merged` at its merge disc. The other twenty-three are bare. Where those names
  cannot clear a stated separation on that row's own geometry, `first review` is dropped before the
  other two — the same shape of rule `delivery-metrics/spec.md:362-368` already imposes on the
  distribution's callouts, and the same layout discipline `layoutDistributionNotes`
  (`distribution-strip.tsx:81-123`) already implements.
- **`one row · one merged change` joins `showing 24 of 31`** in the section kicker's existing `aside`
  slot — destructured at `delivery-view.tsx:311`, typed `aside?: string | null` at `:317`, drawn at
  `:330`, and already passed by the rhythm section at `:404`. No new chrome: a mono label goes into a
  mono label slot that is already drawn on this section.

**A model value that has been computed and never drawn since `delivery-journalism`.** Every section
carries a `markUnit` — `page.ts:682`, `:931`, `:1037`, `:1104` — and a grep of the repository finds
it referenced in exactly two places, both assertions (`packages/schema/src/zero/metrics/page.test.ts:454`
and `:511`). It reaches the reader only inside each chart's `role="img"` label. So the page states
what one mark represents to assistive technology and to no one else: **the sighted reader is the one
reader this page does not tell.** `delivery-metrics/spec.md:153` already requires the three drawings
to be drawn *"each stating what one mark represents"*; this change makes that true of the drawing and
not only of its alt text.

### Explicitly out of scope — this is the argument, not the caveat

- **The section standfirsts stay, all three of them.** `delivery-metrics/spec.md:263-266` mandates
  them and `explanation-at-rest`'s D10 declined to remove them. Nothing here shortens, folds or
  conditions one. The delta restates that requirement with its standfirst rules **verbatim**.
- **No legend, no key, no swatch table.** Banned three ways over: `:265` (labels and marks only),
  `:280` (no legend beside the drawing), and the merged `reality-vocabulary` rule that folds a legend
  behind `how ·`. The distinction this change writes down is that **a name drawn on a mark is not a
  legend** — a legend is detached from the ink it explains, which is what makes it a second thing to
  learn. `+2 added` has been on this page since it shipped and no one has called it a legend.
- **No axis title, and `:280` is not amended.** The unit rides inside the tick label (`48h`), which
  is what `tickSuffix` (`distribution-strip.tsx:145`, `:200`) already does one section above.
- **No caption, no footnote, no tooltip, no hover.** `:271-275` is restated verbatim, including the
  stricter page-local `how ·` obligation `explanation-at-rest` deliberately left standing.
- **The refusal block is not touched.** `delivery-view.tsx:426-471`'s honesty line and its `more ·`
  are the sentence `explanation-at-rest`'s D1 protects; nothing here folds, moves or edits it.
- **The mandated metrics promise is not touched.** `delivery-view.tsx:146` keeps
  ` · team-level only — never a per-person number`, `app-frame/spec.md:228-230` keeps mandating it, and
  `delivery-view.test.tsx:278`/`:280` run unedited.
- **The stat tiles are not touched**, nor the annotated timeline, nor the peek, nor the window
  selector, nor `OPEN TO MERGED` — whose marks already self-name, which is precisely the evidence
  this change is built on. Its kicker's `aside` slot stays empty.
- **No DORA metric is added**, and no metric definition is added or retired.
  `delivery-metrics/spec.md:458-467` requires the definition→place mapping to stay total; a new
  definition would need a home and a new drawing, which is a different change.
- **No new synced entity, named query, mutator, permission predicate, migration, dependency, env var
  or container.** The two sections stay pure functions over rows already in memory
  (`:165-179`).

Non-goals folded deliberately: the Delivery page is not redesigned, no destination moves (that is
`destination-budget`), no row goes silent (that is `phrase-is-news`), and no surface is re-registered
to the settled vocabulary (that is `register-seam`).

## Capabilities

### New Capabilities

<!-- none: this change amends the two drawn sections of a capability that already exists -->

### Modified Capabilities

- `delivery-metrics`: a new requirement states that every drawing names its own marks, once each, in
  the label register, draws the line between a name on a mark and a banned legend, and defers to a
  drawing's own selection rule for which mark carries the name; the
  journalism-cut requirement gains the same boundary at the site where its own scenario creates the
  ambiguity, with its standfirst and `how ·` rules restated unchanged; the cycle-flow requirement
  gains the once-named quantities and the drawn zero; the review-rhythm requirement gains the stated
  axis, the worked first row and the visible mark unit, with the no-reviewer rule restated unchanged.

## Impact

- `packages/schema/src/zero/metrics/page.ts`: `buildFlow` (`:952-1045`) emits the per-mark labels
  under the once rule — the bar count gains a `countLabel`, `addedLabel` (`:971`) and
  `carry.label` (`:994`) name themselves only on their first drawn mark. `buildRhythm`
  (`:1051-1112`) gains the axis ticks and the three mark names. **The naming rule lives in
  `packages/schema`**, where it is unit-testable without rendering, which is also what
  `:274-275` requires of text produced beside a number.
- `packages/ui/src/components/flow-band.tsx`: the count text at `:178-188` renders the model's
  label instead of `{bar.shipped}` (`:187`); a zero-shipped bar draws a baseline stub instead of a
  zero-height rect (`:139-146`). Structural props only — the component still formats nothing.
- `packages/ui/src/components/review-rhythm.tsx`: a tick ruler under the worked track, three
  mark names above it, and a `layoutRhythmMarkNames` pure export mirroring
  `distribution-strip.tsx:81-123`. The worked track stays in its grid cell — `x0` (`:47`) is
  untouched — so `FIRST_ROW_Y` (`:31`), a ruler band under the worked row, and the computed `height`
  (`:42`) carry the headroom, and `ROW_H` (`:30`) does not move.
- `apps/web/src/delivery/delivery-view.tsx`: `Rhythm` (`:398-420`) passes the mark unit into the
  `aside` slot beside `capLabel`. `Flow` (`:374-396`) passes no aside — the bar labels
  `5 ago / … / last` already say what one bar is. `Section` (`:307-346`) is not edited.
- Tests: `packages/ui/src/components/delivery-charts.test.tsx:298-331` counts `rect` and `path`
  elements exactly and asserts `getByText('3 carried')` / `getByText('+2 added')` — both move with
  the once rule and the zero stub, and the "nothing carried, nothing added" case at `:333-342`
  gains the zero column. The two rhythm tests at `:347-388` and `:390-405` gain the ruler and the
  worked row; `:409-466`'s no-literal-colour sweep gains nothing, which is the point.
  `page.test.ts:454`/`:511` are unaffected.
- **Deliberately unedited, and asserted to still pass**: `delivery-view.test.tsx:243-269` (the
  section order and every section leading with a sentence ending in `.`), `:272-281` (the binding
  rule, once), `:283` (the `how ·` on every reading), and `packages/schema/src/zero/metrics/page.test.ts:856-865`.
- **No e2e spec is affected**, and the grep says something both narrower and stronger than an earlier
  draft of this line claimed. `grep -rn "cycle-flow\|review-rhythm\|carried" apps/web/e2e` returns
  **no `cycle-flow` and no `review-rhythm` match anywhere**, and **fifteen `carried` matches across
  five files, none of them on this page**: `cycles.spec.ts:8`, `:115-118`, `:182` and `:190-193`
  drive the **Cycles** view's carryover band (`carried-row` is
  `apps/web/src/cycles/cycles-view.tsx:501`); `retro.spec.ts:223` asserts the **Retro** seed panel's
  `[data-metric="carried_twice_plus"]` widget; `connectors.spec.ts:210` and `:218` use the word in
  English, in comments about which commit a deployment carried; and `fixtures.ts:168` and
  `e2e/README.md:21` are prose about PR #41. The stronger fact is that **no e2e spec navigates to
  `/teams/$teamId/delivery`** (`apps/web/src/routes/teams.$teamId.delivery.tsx:20`) at all — the one
  spec whose title says "Delivery" (`connectors.spec.ts:177`) exercises the **issue list's** Delivery
  filter (`:229`, `Filter by Delivery` → `Merged, not deployed`), which this change does not touch.
  By PROCESS.md §3's big-feature rule this change touches one of four axes (signature UI), so it is
  small: unit and component tiers only.
- `packages/ui/src/styles/contrast.test.ts`: the new marks reuse tokens the delivery block already
  pins — the zero stub takes `--status-done` (`:603`) and every new label takes `--text-2`, the ink
  the tick labels and the `+N added` cap label already use. Gains an assertion only if a new
  token/ground pair appears, which the design says it must not.
- `design-explorations/overhaul-2026-08/northstar/NORTHSTAR.md`: a fourth entry under §"What the
  build kept, and the three places it had to diverge", per `SCOPE-legibility.md:65-68` — the specs
  win and the northstar is annotated afterwards. The five HTML files are **not** re-rendered.
- `ROADMAP.md` is **not** edited by this change; siblings in this family are authored in parallel and
  that file is the guaranteed conflict, so the row is taken once by whoever integrates
  (`SCOPE-legibility.md:190-193`).

Docs: `apps/docs/src/content/docs/features/delivery.md` §"Cycle flow" (`:91-109`) and §"Review
rhythm" (`:110-124`) — what each mark is called on the drawing, and where the 96-hour axis is now
stated; `:163`'s *"not a heading, not an axis, not a zero"* needs the one-word distinction between a
section with no data and a cycle that measured zero; `README.md:174-175` and
`apps/docs/src/content/docs/index.md:66-67`, which both describe these two drawings in a sentence.
