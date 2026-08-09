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
