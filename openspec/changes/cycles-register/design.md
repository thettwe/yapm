# Design — Cycles, drawn as the register

The mock is `design-explorations/overhaul-2026-08/destinations/cycles.html` (`cycles.png`,
`cycles-full.png`) and its closing comment is part of the brief, not commentary on it. Where this
document and the mock disagree, the mock wins — unless the mock asks for a fact no row supports,
which it never does, because its whole closing comment is an inventory of what it refused to draw.

## The shipped page, inventoried before anything is removed

Every capability the surface has today, and where it lands:

| Shipped capability | Where it lands |
|---|---|
| Masthead `Cycles` + count, `+ New cycle` dialog (`new-cycle`) | Band 2, unchanged; the dialog is untouched |
| Cycle rail grouped Active / Upcoming / Completed, `aria-current` on the selected | **THE REGISTER** — one row per cycle, newest first, the active row selected |
| Featured cycle's name, key, status pill, date range | The register row states all four |
| Progress bar (`role="progressbar"`, name `Cycle progress`) | The row's **scope ledger** (D4 — the role changes, the fact gets *more* precise) |
| `Complete cycle` (`complete-cycle`) | Band 2 actions, acting on the selected row (D6) |
| Retro entry — `cycle-retro-link` / `cycle-open-retro` | The report band's header, for the selected cycle (D5) |
| `CycleDigestPanel` (`cycle-digest`) | **THE LAST REPORT** band, same component, same behaviour |
| `PmDigestShareCard` (`pm-digest-share`) | Below the report, unchanged |
| The featured cycle's issue list (`cycle-issue-row`) | **REMOVED** — the one deliberate removal (D3) |
| Empty states (no cycles / no issues) | D8 |
| Viewer read-only | Unchanged; every write control stays behind `canWrite` |

## D1 — The derivation lives once, in `packages/schema`, and is pure

`buildCycleRegister(input)` in `packages/schema/src/zero/cycle-register.ts`, beside `team-home.ts`
and following its shape exactly: plain row interfaces in, a rendered model out, no ZQL, no React,
no `Date.now()` reached for internally (the clock is an argument, as `buildTeamHome` takes it).

It goes in `packages/schema` rather than `apps/web` for one reason that is not taste: the **scope
band semantics** — `added` = `cycle_assigned_at > cycle.start_date`, carry-ins stay committed,
`landed` = `done`, one block per issue — already live there, in `buildHeroCycle`. Home's hero and
the register must be incapable of disagreeing about the same cycle, so the rule is extracted and
both call it. A second copy in `apps/web` is exactly the defect `delivery-journalism` recorded
("two projections of the same subtree, but only one population rule").

Input: the team's cycles, its issues (id, number, title, status, `cycleId`, `cycleAssignedAt`,
`carryoverCount`, `rolledOverFromCycleId`), its retros (`cycleId`, `closedAt`), its cycle digests
(`cycleId`, `status`, `content`), and `now`. Every one of those is already synced.

## D2 — The committed denominator degrades, and the rule is stated

The fold this page is built around, and the mock's §2. `cycle.complete` re-points each unfinished
issue at the successor and stamps `rolled_over_from_cycle_id` with the cycle it left. **That column
is overwritten on the next rollover.** So a completed cycle's carried set — and therefore its
committed total — is reconstructible only until one of those issues carries again.

The intactness rule, computed from cycle status alone and therefore deterministic:

- An **active** or **upcoming** cycle: its issues still point at it. Ledger = every issue with
  `cycleId = C`; committed = those with `cycleAssignedAt <= C.startDate` (or null); added = the
  rest; landed = `done`. Denominator **known** → `landed/committed+added` with a hollow remainder.
- The **latest completed** cycle in cycle order, with no completed cycle after it: its carried set
  is still addressable as `rolledOverFromCycleId = C`. Ledger = issues pointing at C **plus** that
  carried set. Denominator **known**.
- Any **earlier completed** cycle: only the issues still pointing at it are addressable. Ledger
  draws landed and added blocks, **no hollow remainder**, and reads `N landed` rather than `N/M`.
  Denominator **unknown**, and the row says so by not claiming one.

The mock names its own fault here: the degradation "is exactly right and completely invisible — it
looks like inconsistent formatting until someone explains the rollover, and no affordance on the
row admits that something is missing." The fix uses the house mechanism rather than a new one: the
register band header carries `how ·` (`packages/ui/src/components/how.tsx`), and its panel states
the rule in one sentence with the constraint line under it. A derived number never explains itself
at rest; the explanation is one keystroke away and folds again.

## D3 — The featured cycle's issue list is removed, and this is the only removal

Mock §5. That list is Issues filtered by cycle — a lens `openspec/specs/cycles/spec.md` already
grants the issue list — and Home's hero already answers "how is this cycle going". Redrawing it
here makes Cycles the third copy of a surface that exists twice.

What survives of it: the **scope ledger** is the progress indicator the spec asks for, at higher
fidelity than the bar it replaces (it states committed, landed and added separately, per issue);
and the **carried rows still open an issue**, so the page keeps a path into the work.

What is honestly lost: from Cycles you can no longer read the active cycle's full issue list in
place. This is recorded in the spec delta as a MODIFIED requirement rather than deleted quietly,
and `cycle-issue-row` disappears with it. `apps/web/e2e/cycles.spec.ts` is the only consumer of
that test id; its assertions are **replaced by stronger ones** about the ledger and the carry band,
never dropped.

## D4 — The ledger is `role="img"` with a truthful label, not a progressbar

The shipped bar is `role="progressbar"` named `Cycle progress` with `aria-valuenow` a percentage.
Three reasons that role does not survive:

1. A completed cycle is not a task in progress; announcing 80% on a cycle that ended three months
   ago is a false present tense.
2. Where the denominator is unknown (D2) there is no `aria-valuemax` that is true. A progressbar
   with an invented max is precisely the invention this page exists to refuse.
3. `ScopeBand` already draws this shape on Home and is `aria-hidden`, with the numbers stated in
   text beside it. Two accessibility treatments of one drawing is a bug waiting to happen.

So: the ledger cell is `role="img"` with a label that states exactly what the row knows —
`"8 landed of 12 committed, 3 added after the cycle started"`, or, degraded,
`"10 landed; the committed total is no longer reconstructible"`. Nothing is conveyed by colour
alone: `landed` / `open` / `added` are fill, hollow outline and outline-plus-`+`, which is the
shipped `ScopeBand`'s own three-channel encoding, reused rather than re-drawn.

The theme e2e currently anchors on `getByRole('progressbar', { name: 'Cycle progress' })` over a
cycle **with no issues** — where the ledger correctly folds. It re-anchors on the register row and
its cycle-status glyph label, which is present in every state and therefore a better probe of "the
page rendered in this theme". Equal strength, not weaker.

## D5 — `Wrapped ·` means a CLOSED retro, and the retro doorway is a separate control

`buildTeamHome` already publishes `chips.wrapped = retros.some(r => r.cycleId === c.id && r.closedAt != null)`.
Home and Cycles may not mean two different things by one word, so the register's `Wrapped ·` chip
uses that predicate verbatim (extracted, not copied).

But the shipped page's retro entry appears as soon as a retro **exists** — `retro.spec.ts` asserts
`cycle-retro-link` is visible immediately after completing a cycle, when the retro is open, not
closed. Those are two different facts, so they are two different controls: the **chip** is the
artifact (a closed retro is a document), and the **doorway** (`cycle-retro-link`, else
`cycle-open-retro` for a writer) sits in the report band's header for the selected cycle, where
the shipped page put it. Both test ids survive verbatim.

`Cycle report ·` follows the same rule as Home's chip: a stored digest with `status = 'ready'` and
non-null `content`. Mock §9: where no digest exists the slot draws **no ink** — not a "no digest"
label, which on a register would repeat down the column.

## D6 — `Complete cycle` acts on the selected row, and the selection is the interaction

The mock draws `Complete cycle` in band 2. The shipped button acts on the featured cycle, and
`retro.spec.ts` / `digest.spec.ts` both select a cycle and then press it. Moving it to band 2 while
keeping "the selected cycle" as its subject preserves both flows exactly. It is hidden for a viewer
and for an already-completed cycle, as today.

Selection is the page's one interaction: it moves the accent left-border and the selected tint to a
row, and re-points **CARRIED IN** and **THE LAST REPORT** below. Rows are buttons in a list with
`aria-current`, arrow keys and `Enter`/`Space` — the rail's keyboard contract, kept, on a different
shape. The active cycle is selected on arrival (`currentCycle`).

## D7 — The carry chain: drawn as the mock draws it, with the notation one keystroke away

The mock's self-critique is unambiguous that this is the weakest drawing on the page and that "the
honest answer may be one mono column and no graphic at all." Building it anyway, with the specific
defect closed:

- The chain is drawn from `carryover_count` alone. **Nothing is inferred from cycle ordering.** A
  node per boundary crossed; a solid node for the one origin the schema still names
  (`rolled_over_from_cycle_id`); an accent node for now; hollow nodes for hops the product cannot
  name; a dotted lead-in standing for the part before the record begins.
- The chain is `aria-hidden`; the row's fact is `carried N×` in text, and the row carries a
  truthful sentence for assistive tech: *"Carried 3 times; last left Cycle 1."*
- The band header carries `how ·`, whose panel states the notation and the schema limit that makes
  it necessary. That is the one thing the critique says is missing, supplied through the mechanism
  the product already has for it rather than a legend invented here.
- The amber wash on a deeply-carried row is `color-mix` off `--status-in-progress`, per the mock —
  and it is **not** urgent ink and **not** a badge, so the one attention number stays 4 (mock §8).

If the render (task 7.4) shows the chain reading as three near-identical dashes, the fallback
recorded here in advance is the critique's own: drop to the mono column, keep `carried N×` and the
origin phrase, delete the graphic. That is a decision to take **with the render in front of us**,
recorded either way under "Decisions made during implementation".

## D8 — The degenerate states, checked by rendering them

The lesson from the triage build: a panel that reserved its full measure over an issue with no
description shipped as a large empty box, passed every test, and was found only by looking at the
rendered page. Each of these is rendered and looked at, not reasoned about:

| State | What it must read as |
|---|---|
| A team with **no cycles at all** | The register's honest empty line; no carry band, no report band, no footnote orphaned above nothing |
| A team with **exactly one cycle**, its first | One register row. Carry band absent (nothing has crossed a boundary yet). Report band absent. The page must read as composed at one row, not as a header over a hole |
| A cycle with **no issues** | The ledger cell folds — the mock's C16 draws nothing there, not an empty rail |
| A cycle with **no carryover** | The carry band folds entirely rather than drawing `0` |
| A cycle whose **digest was never generated** | No `Cycle report ·` chip and no ink in the chip slot; the report band shows the existing evidence fallback for a completed cycle, and is absent for one still running |
| **Viewer** | No `Complete cycle`, no `+ New cycle`, no `cycle-open-retro`; every fact still readable |

## D9 — Tests: the tiers this earns

By PROCESS.md §3 this change touches exactly **one** of {synced entity/schema, mutator, permission
surface, signature UI} — signature UI. It is therefore a **small** change: unit + component, and
**no new e2e file**. The existing `apps/web/e2e/cycles.spec.ts` is updated because the surface it
drives moved, which is not the same as adding e2e reflexively.

**The falsifiable check** (fails on today's `main`, passes when this is correct), in two parts:

1. `packages/schema/src/zero/cycle-register.test.ts` — over a fixture of three cycles where an
   issue is carried twice: the register's newest-first rows carry the right glyph kind; the active
   and latest-completed cycles publish a **known** denominator while the earlier completed one
   publishes `landed` only; and the selected cycle's `carriedIn` names the issue with depth 2 and
   origin the cycle it last left. On `main` the module does not exist.
2. `apps/web/src/cycles/cycles-view.test.tsx` — the page renders one row per cycle newest-first
   with no cycle rail and no `cycle-issue-row`; the carry band is absent when nothing carried and
   present with `carried 1×` when something did; the `Cycle report ·` chip is absent where no
   digest row exists.

Plus: `packages/ui/src/styles/contrast.test.ts` extended for every ground this page paints, in all
six theme blocks; and the e2e rollover test asserting the carried-in row after completion — a
strictly stronger claim than "the issue appears under cycle B".

Two standing CI lessons apply: **no budget that encodes e2e fixture size** (the register's row
count is derived from the page, never asserted against a magic number — fixtures accumulate cycles
across specs), and **no test whose premise is what a Node runtime provides** (CI is Node 24; dev
machines here run 26).

## What is deliberately NOT built

- **A burndown, a burn-up, or any line falling over time.** There is no issue status-history table.
  `last_human_status_at` is a single scalar and cannot reconstruct a series. The footnote says this
  once, in one sentence, and the page draws no chart at all.
- **Velocity, capacity, a forecast, or a "cycles remaining" projection.** None is a stored fact.
- **Any per-person number** — no load, no throughput, no "who carried it".
- **A named chain older than one hop.** `rolled_over_from_cycle_id` holds the last origin only.
- **A second attention number.**
- **A new named query.** Four already-registered team-scoped queries serve the page. If the build
  finds one genuinely cannot, the new query carries the same team-scoped predicate as its siblings
  and the reason the existing reads could not serve is written under "Decisions made during
  implementation" — not assumed.

## Left standing, and named

- `cycles.html`'s mono keys `C10`–`C16` are that file's own numbering, and `DESTINATIONS.md`
  §"Remaining drift" flags them as a second numbering no other file uses. The build renders
  `cycleKey()` — the shipped `Cycle N` — so the product keeps one numbering. This is a deliberate
  divergence from the mock's lettering, not an oversight.
- The mock's `↓ 9 more` fold on the register: the shipped register is not folded in this change
  unless the render shows sixteen rows overwhelming the page. Cycles accumulate at roughly 26 a
  year, so the fold is a real future need and a premature complication today; whichever way the
  render decides, it is recorded.
- The two-urgent-inks split (`--status-urgent` in band 3, `--status-urgent-ink` on work surfaces)
  is the set's standing debt and is inherited here, not resolved.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no migration, no mutators.** Prefer **no new named query**; if one is genuinely
  needed it carries the same team-scoped predicate as its siblings and the reason the existing
  reads could not serve is written here.
- **Every shipped capability survives except the featured cycle's issue list** (D3), which is
  removed deliberately and recorded in the spec delta as a modified requirement.
- **The test ids `new-cycle`, `complete-cycle`, `cycle-retro-link`, `cycle-open-retro`,
  `cycle-digest` and `pm-digest-share` are preserved verbatim** — `retro.spec.ts`,
  `digest.spec.ts` and `pm-digest.spec.ts` drive this page through them.
- **No burndown, no velocity, no capacity, no forecast, no per-person load.**
- **Keyboard-first, sub-100ms, offline**: render from already-synced rows; selection is local
  state and waits on nothing.
- **Accessibility**: the cycle glyph carries a truthful label, no fact is conveyed by colour alone,
  and theme contrast holds in **every** theme block, light and dark.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### Build pass — the derivation, the vocabulary and the page (tasks 2–4)

**`buildCycleRegister(input)` takes no `now`.** The brief asked for the clock as an argument,
following `buildTeamHome`. Every fact the register publishes is a stored status, a stored count or
a stored timestamp rendered by the page — glyph kind is `cycle.status`, the ledger is a count of
rows, the chain is `carryover_count`, the chips are stored artifact rows. There is no derivation in
this file that a clock would change, so an unused `now` parameter would have been a false claim
about what the function depends on. `buildTeamHome` takes one because its day band, its ages and
its 24-hour window genuinely need it. If a later requirement makes this page time-dependent, the
argument arrives with the requirement.

**Three rules moved into `packages/schema/src/zero/cycles.ts` rather than being copied.** D1 named
the scope band; the build found two more shared rules and gave each one home:

- `buildScopeBand(issues, cycleStartDate)` (in `team-home.ts`, beside the `TeamHomeScope` type it
  returns) — `buildHeroCycle` now calls it, so Home and the register are one rule.
- `cycleKeyOf(cycle)` — `apps/web/src/cycles/model.ts`'s `cycleKey` now delegates to it, so the
  register, the issue list and triage cannot spell one cycle two ways.
- `hasCycleReport(digest)` / `isCycleWrapped(retros, cycleId)` — D5's "extracted, not copied",
  taken literally. `buildHeroCycle` and `buildRow` both call them.

**The carry wash is a token, not an arbitrary class.** The mock writes
`color-mix(in srgb, var(--status-in-progress) 10%, transparent)` inline. The shipped palette's
house pattern for a derived wash is a preset-level token (`--urgent-soft`), so `--carry-soft` is
declared in all six theme blocks of `globals.css` and mapped as `--color-carry-soft`, and the row
uses `bg-carry-soft`. Same value, but the wash is now a ground `contrast.test.ts` can measure by
name (task 5.9) instead of a string buried in a `className`.

**`PmDigestShareCard` sits outside THE LAST REPORT's gate.** The report band folds when the panel
inside it would render nothing (a running cycle with no digest row). `pm-digest.spec.ts` asserts
`pm-digest-share` is visible on exactly that cycle — a running one, seeded with a *pm* digest and
no cycle digest — so gating the share card behind the report band would have broken a spec this
change may not touch. The card follows the report and folds itself when the workspace shares
nothing, which is the behaviour it already had.

**The footnote's affordance reads `how ·`, not the mock's `more ·`.** `How` is the product's one
mechanism for "the explanation is one keystroke away and folds again", and its trigger word is part
of that vocabulary. Teaching it a second word for the same gesture buys the mock's exact string at
the cost of a synonym the reader has to learn. The panel content is the mock's.

**`carriedForward` is published only where the denominator is known.** `rolled_over_from_cycle_id`
is overwritten on the next rollover, so an older completed cycle's carried set undercounts by
however many of its issues moved again. A row that cannot count it says nothing rather than
printing a number that shrinks over time. This matches the mock, where only C13 carries the phrase.

**A degraded ledger whose visible band is empty folds entirely.** Dropping the `open` blocks from an
old completed cycle can leave nothing to draw (its remaining pointing set is all `canceled`). The
cell folds rather than drawing a bare `0 landed` beside an empty rail — the same rule as a cycle
with no issues (D8).

**The chain's named origin is stated with the cycle NAME.** The mock writes `Cycle 1`, which is
that file's own key lettering. The product renders `cycleNameOf(cycle)` — the cycle's name, falling
back to `cycleKeyOf` when it is blank — because the name is what the reader selected the row by.
(Where that name is *drawn* moved in the review pass below.)

**`deep` is depth ≥ 3.** The mock washes exactly one row, the one carried three times; 2× and 1×
are quiet. Exported as `CARRY_DEEP_DEPTH` so the threshold has one home.

**Arrow keys move focus; every row stays tabbable.** Not a roving-tabindex listbox: these are
buttons in a list (D6's contract, kept), so `Tab` reaches each row as it always did and `ArrowUp` /
`ArrowDown` are a shortcut over the same order. `Enter` / `Space` is the button's own activation,
which is what makes the selection.

**The register is not folded.** The mock's `↓ 9 more` is left unbuilt in this pass; whether it is
needed is a question for the render (task 7.4), and a fold added before then is a control over a
list nobody has looked at yet.

**`cycleProgress` is deleted from `apps/web/src/cycles/model.ts`.** The progress bar was its only
consumer (checked: `triage-view.tsx` and `issue-list.tsx` import `cycleKey`, `retros-view.tsx`
imports `CYCLE_STATUS_LABEL` / `formatCycleRange` / `CycleRowData`, and nothing else imports the
module). Its two unit assertions go with it.

**`new-cycle` becomes a labelled `+ New cycle` button.** The mock draws the word; the shipped
control was an icon button. `aria-label="New cycle"` is preserved verbatim, so
`getByRole('button', { name: 'New cycle' })` — which `retro.spec.ts`, `digest.spec.ts` and
`pm-digest.spec.ts` all wait on — resolves exactly as before.

**How the three untouched specs keep working.** They select a cycle with
`getByRole('button', { name: new RegExp(cycleName) })`, which used to resolve the rail button. The
register row is a button whose accessible name contains the cycle name, so the same locator resolves
the register row and `complete-cycle` (now acting on the selection) acts on the cycle they clicked.
Verified by reading each spec, not assumed.

**Lucide is gone from this page** (mock §7): `CircleDashedIcon`, `FlagIcon`, `MessagesSquareIcon`
and `PlusIcon` are removed. The two artifact chips carry the northstar's `g-cycles` and `g-retro`
marks, drawn inline on the same grid.

**The loading / team-missing states follow the triage precedent** (`'No such team.'` / `'Loading…'`)
rather than the older `'This team no longer exists.' / 'Loading team…'` pair the un-rebuilt pages
still carry — task 4.10's label register, matching the most recently rebuilt destination.

### Test-and-docs pass — three defects the tests and the contrast file found

**The latest completed cycle's ledger counted its own carried-out work as `added`.** Writing the
§5.1 fixture surfaced it: `cycle.complete` re-stamps `cycle_assigned_at` with the moment the issue
LEFT, so an issue read against the cycle it left always satisfies `cycleAssignedAt > startDate` —
"added after the cycle started", the exact inverse of the truth. A three-cycle fixture printed a
`2/1` ledger, a fraction above 1. `buildRow` now normalises each carried-out issue's stamp to null
before the band is built, so it counts as committed. Whether it was committed to that cycle or
added to it mid-flight is a distinction the overwrite destroyed; committed is the honest reading of
the pair, and it is the same call `metrics/scope.ts` already makes by excluding carried-out issues
from `addedMidCycle` entirely — a comment in that file names this trap in so many words.

**The ledger's ratio is now over the committed set alone**, numerator and denominator, which is
what the mock's `8/12` counts. It was `landed/committed`, mixing an all-origins numerator with a
committed-only denominator: an added issue that landed pushed the numerator past the denominator
and made `2/2` mean "one of the two committed issues is still open". The label follows
(`1 landed of 2 committed, 1 added after the cycle started, of which 1 landed`). And a cycle that
committed to nothing at all — created already running, then filled, which is what the e2e does —
reads `3 added` rather than `0/0`, a ratio about nothing.

**Three inks moved, each because `contrast.test.ts` measured them rather than because the mock
changed its mind.** (1) The selected register row's mono key was `--accent-strong`, which this file
already records at 3.84–4.38 on `--bg-selected` — the issue row hit exactly this and resolved it
the same way, so the key takes `--text-1` selected and `--text-2` at rest. (2) The register's mono
dates were `--text-3`, which measures 2.43 on editorial light's `--bg` — under the NON-text bar,
and a date range is a fact the row states; they take `--text-2`, the trade the reality rail's mono
fact line already made. (3) The deep-carry count was `--status-in-progress-ink` on the amber wash
it is drawn in, which measures 4.42 in focused light; the wash and the left rail carry the depth,
so the count keeps a readable ink. The chain's two 9.5px labels moved off `--text-3` and
`--accent-strong` for the same reason (and are gone entirely as of the review pass below). Each is
pinned as a bound that can fail, not deleted.

**`--status-backlog` is recorded as an inherited exemption, not fixed here.** The upcoming cycle's
dashed ring measures 2.47–4.98 on `--bg` — under 3:1 in the two lightest presets. It is the same
token at the same size the backlog issue glyph has always used, so this page adopts a treatment it
did not introduce; the assertion records the bound it actually holds and the reason it is
survivable (the glyph is a distinct SHAPE carrying the text label `Upcoming cycle`). Retuning the
palette is a product decision with six presets attached, not this change's to take.

**No e2e assertion was weakened.** `cycles.spec.ts` moved because the surface it drives moved: the
rollover test now asserts the issue appears in CARRIED IN with `carried 1×` and the band naming the
cycle it left — three claims where there was one; the theme test re-anchors on the register row and
its glyph label, which is present in every state including the issue-less cycle where the ledger
correctly folds and the old progressbar probe would have proved nothing; and the keyboard test
drives register rows (focus, `Enter`, `ArrowDown`, `Space`) plus the carried row, where it drove
the rail. `retro.spec.ts`, `digest.spec.ts` and `pm-digest.spec.ts` are untouched.

**The component tests activate rows by click, not by `Enter`.** jsdom does not synthesise a button's
default activation from a `keydown`, and this repo has no `@testing-library/user-event`. The rows
are real `<button>`s, so `Enter`/`Space` IS the platform's activation and a click is the same code
path; what the component test can hold on its own is the part the page adds — arrow movement over
the register's order — and the real key presses are driven in `cycles.spec.ts`.

### Review pass — two ledger inversions, and the chain's name moved into row text

**A carried-out issue's LIVE STATUS may not be read against the cycle it left.** The build pass
already normalised `cycle_assigned_at` on that set, because the rollover overwrote it; the same
argument applies to `status` and had been missed. An issue the rollover moved out of C did not land
in C — that is what being rolled forward means — so reading the status it has *now*, in a later
cycle, retroactively credits C with delivering it and prints a fully-delivered ratio beside
`1 carried forward`. `asCommittedCarryOut` now normalises both stamps, which is the same call
`metrics/scope.ts` makes when it computes `deliveredCounts.shipped` from `within` alone and never
from `carriedOut`. Pinned by flipping the §5.1 fixture's traveller to `done` and asserting Cycle 2
still reads `1/2`.

**The carried-in header names an origin only when EVERY row names that same one.** It previously
named one whenever exactly one *named* origin appeared among the rows, so a band mixing an issue
whose reference still names Checkout with one whose reference names nothing announced "out of
Checkout" over both. A row with no recorded origin is not agreement; it is the absence of a fact.

**The chain's origin label became row text, and the drawing became bounded.** Two defects with one
root: D7's per-chain `<text>` label was drawn under the first row only (to avoid three stacked
labels), so with mixed origins every row after the first drew a solid "named origin" node whose
name appeared nowhere on screen; and the SVG's intrinsic width grew 58px per hop inside an `auto`
track, so the deepest row — the exact row the band exists to surface — pushed its track out of the
container. So: the labels are gone, `carried N×` is joined by `· out of <cycle>` as row text
whenever the band header cannot state it for every row, and the drawing renders at most four nodes
with the dotted lead-in standing for the rest. Nothing is lost — the lead-in already meant "the
part of the chain before the record begins", the true depth is in text at any length, and every
row now keeps one height. This is the direction D7's own self-critique pointed at, taken to the
extent an agent can take it; whether the graphic survives at all remains the task-7.6 judgement
with the render in front of it, and the recorded fallback (mono column, no graphic) is unchanged.

**The register is O(issues), not O(cycles × issues).** `buildRow` filtered the team's whole issue
set twice per cycle. `buildCycleRegister` now builds a by-cycle and a by-rolled-over-from index in
one pass and the rows look up. Identical output; the difference shows on a team with three years of
cycles, where this derivation re-runs on every synced issue change.

**Both row grids compress rather than overflow.** The register row was seven fixed tracks with a
~967px min-content width, which put a sideways scrollbar on the page below ~1031px — where the
shipped issue row folds columns at `lg`/`md`/`sm`. The register row now folds the carry fact and
the artifact chips below `lg` and the date range below `md`; the carried row folds its rest phrase
and its chain on the same breakpoints. The ledger, the name and the key are on every row at every
width, which is the folding order the page's own hierarchy implies.

**The carried row's key takes the row ink.** It was `--text-3` — the token this change measured as
below the text bar and moved the register's dates off. It is the row's primary identifier and a
fact the row states, so it is `--text-2`, stepping to `--text-1` on the washed deep row exactly as
`issue-row.tsx` does. The report band's date range moves for the same reason. The bare counts in
band headers stay `--text-3`: that is the house `BandHeader`, not this page's invention.

**Not done in this pass, and owed:** the render gates (§7.4–7.6) — the 1440×900 render of the page
and of each degenerate state, and with it the task-7.6 decision about whether the carry chain
survives contact with a real screen. This pass ran `typecheck`, `biome ci`, the unit and component
suites, `check-boundaries` and the docs build; the full `build`, the compose smoke test and
Playwright run in CI on the push. Nothing here substitutes for looking at the page: the degenerate
states are covered by tests (a team with no cycles, a first cycle, an issue-less cycle, a cycle
that carried nothing, a cycle with no digest) and tests are exactly what the triage build's empty
decision panel passed.

### Second review pass — the overflow moved, and the docs kept the old legend

**A track with a floor is a floor on the grid.** The last pass folded columns at `lg`/`md` but left
`minmax(120px,1fr)` on the register row's name and `minmax(140px,1fr)` on the carried row's title.
The elastic track is the only one that can absorb a shortfall, so a floor on it is a floor on the
whole grid's min-content: at `lg` the register row measured 967px against the 960px a 1024px
viewport leaves, which turned the seven-track layout back on across a seven-pixel band where it
still did not fit. Both name tracks are now `minmax(0,1fr)`. They already truncate, so the row
gives up characters rather than the page giving up its width.

**The carried row's origin clause is bounded too.** Moving `· out of <cycle>` out of the SVG and
into an `auto` grid track reintroduced the overflow the four-node chain bound had just closed, in a
worse form: a cycle name is free text of any length, and an `auto` track takes its unwrapped
min-content as a floor. The track is `minmax(0,auto)` and the clause truncates; the count keeps
`shrink-0`, because the count is the fact and the origin is its qualifier. The full name is
unaffected in the row's `say`, which is where assistive technology reads it.

**The docs page carried the pre-bound legend.** `features/cycles.md` still asserted one node per
boundary crossed, with no bound and a lead-in that only meant "before the record begins" — a legend
the product no longer draws. It now states the four-node bound, that the lead-in absorbs the hops
past it, and that the tail is what is kept so the one nameable hop is never the one dropped. The
ledger section had the matching gap: `asCommittedCarryOut` normalises a carried-out issue's status,
so the set a cycle handed forward is always counted open against the cycle it left, however far it
has travelled since — the "a filled block per issue that reached Done" bullet now says so, and the
band header's origin rule is documented beside the per-row one.
