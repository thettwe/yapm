# Design — projects-roadmap-daylight

Three surfaces, one entity, one fixture: the Projects index, one project's page, and the Roadmap.
The mocks are `design-explorations/overhaul-2026-08/destinations/projects.html` (frames A and B)
and `roadmap.html`, reconciled onto one set of nine projects on 2026-08-09 and re-rendered
(`projects.png` 1440×1610, `roadmap.png` 1440×900).

The rulebook is `northstar/ia.html`: three bands, band 1 and band 3 held constant, band 2 owned by
the page; the word diet's CHROME tier on chrome, dictionary phrases on work surfaces; ONE attention
number; `how ·` on every derived number; the peek for anything dotted.

---

## D1 — No bar. Ever. And the refusal is drawn, not just obeyed

A project stores `created_at`, `target_date`, `status`, `name`, `lead_id`. It stores **no start
date**. Every bar has a left edge, so every bar on this page would be an invention, and the whole
Gantt grammar that follows a bar — spans, overlaps, slips, critical path — would be invented with
it.

Earliest-issue-`created_at` is available and is **rejected**, not overlooked: it dates when somebody
typed a title, not when work began, and a drawn left edge reads as a commitment the product never
captured. The consequence is that this page has to earn its density some other way (D3).

The refusal is **stated on the surface**, in the roadmap's footnote, in the mock's words:

> **What this page won't guess:** a project's start — only a target is stored, so nothing here
> draws a bar.

The single place a left edge appears anywhere in this change is the project page's target strip,
where the left end is a **labelled** `<date> · created` dot — the label is the disclosure, and it
says `created`, never `started`. That is the rule the brief sets: derive a left edge from something
real only if you say so on the surface.

A test asserts the sentence is present and that no roadmap row renders a positioned element whose
width encodes a duration. The sentence is a fact of the surface, not decoration.

## D2 — Projects are WORKSPACE-scoped and the deck is TEAM-scoped; draw the seam

`project.workspace_id` exists and `project.team_id` does not. `projects.all` is gated by `isMember`
and its related issues are re-scoped by `teamScoped`, so:

- every workspace member sees every project, including a viewer;
- a project's **issues** are only the ones in the reader's own teams;
- two readers in different teams see the same project with different counts, legitimately.

Three drawings carry that, rather than one paragraph explaining it:

1. **A scope chip in band 2** on the index and on the project page — dashed border,
   workspace-marked, `A Acme workspace`. Dashed because it is wider than the solid deck above it.
2. **A team split column** on the index (`ENG 11 · DES 2`), from `issue.team_id`. It names only the
   teams whose issues actually arrived — see D9.
3. **A mono footline**, once per surface: `workspace-scoped · counted over the issues in your
   teams`, carrying a `how ·` whose panel states the predicate.

The chip rides the `Masthead`'s existing `lens` slot (band 2 is the page's to adapt, and the slot is
already `flex items-center gap-1` immediately after the count). `packages/ui` and
`apps/web/src/frame/` are **not** edited — two other destination rebuilds are building in parallel
worktrees off the same main, and shared-code edits are the collision.

## D3 — What the roadmap draws instead of a bar

Per row, left to right:

| Mark | Source column | What it means |
|---|---|---|
| status glyph | `project.status` | cycle position, the shared family (`planned` open ring · `active` half arc · `completed` filled disc **carrying a check** · `cancelled` ring with ×) |
| name, lead avatar | `project.name`, `project.lead_id` | |
| Done meter | `issue.status` where `issue.project_id = P` | one tick per readable issue, filled for done |
| `done/total` | same | the count the meter's fill encodes |
| target mark | `project.target_date` | one point on the axis, at its date |
| issue dots | `issue.cycle_id` → `cycle.start_date`/`end_date` | where the project's work is actually scheduled |

The axis header carries month ticks, **cycle boxes drawn from real `cycle.start_date` /
`cycle.end_date`**, and the `today` caret. Where the team has created no further cycles the tail
carries a mono `no cycles past <date>` instead of ruled columns — a fact about the axis, drawn
rather than hidden.

Two faults in this drawing are known and inherited from the mock's own self-critique; both are
carried, not laundered:

- The dots carry roughly a bar's visual weight while meaning something else, and an eye trained on
  roadmaps will read a cluster in Cycle 2 and a cluster in Cycle 3 as a span. Mitigation: the axis
  header labels what a dot is, and the row's `role="img"` label says it in words (D8).
- The Done meter's **length** encodes issue count, so a 14-issue project's meter is twice a
  7-issue project's and two rows cannot be compared at a glance. Carried, because the alternative
  (a percent) is the thing item 9 of the mock's fold-list rejects: a percent over a project with no
  issues reads 0%, which is a lie about a project nobody has broken down yet.

## D4 — Cycles are team-scoped; a project's issues are not. How the dots stay truthful

The roadmap route is `/teams/$teamId/roadmap`, so there is a deck team. Its cycles rule the **grid**
(`cycles.byTeam(teamId)` — an existing query). But a project may hold issues from several teams, and
another team's cycle is not on that grid.

Chosen: **each dot is positioned from its own issue's cycle's real dates**, not from the grid. That
requires `cycle` related on the issues inside `projects.all` — one relation on an existing named
query, inside the same `teamScoped` predicate (so it can only ever reach cycles of teams the reader
belongs to). A dot for an issue in another team's cycle therefore lands at the truthful place on the
time axis even though no box is drawn around it, and an issue with no cycle draws no dot at all.

The axis header states whose cycles the boxes are. Rejected alternatives: dropping dots for
off-grid cycles (silent under-drawing); drawing every contributing team's cycles as boxes
(overlapping boxes that would read as one team's rhythm).

## D5 — The project page speaks the reality vocabulary, which costs one query extension

Frame B draws its issues in the shared row anatomy, including the phrase (`Done in git, not on the
board`) and the reality track with its `//` break — and the reserved-but-inkless slot on the row
that has no linked change. That is the shipped `reality-vocabulary` requirement, and a project page
that drew a lesser row would be a second vocabulary for the same facts.

`projects.get` — an existing named query that **nothing renders today** — gains `.related('labels')`
and the shared `withLinkedDelivery(...)` subtree, exactly as `issues.byKey` and `issues.detail`
carry it. Same predicate, same wrapper, no new query.

The deployment fact is the wrinkle: `deployment` is team-anchored (`deployments.byTeam`), and this
page is cross-team. A track drawn without deployments cannot distinguish "not deployed" from "not
synced", and the phrase `Built — not live yet` would then be a claim the reader cannot check —
exactly what `reality-vocabulary` forbids. So the page subscribes `deployments.byTeam` **once per
team that actually contributes an issue to the open project** (a tiny subscriber component per
team id, results merged through the shared `buildDeploymentIndex`; `deploymentKey` is repo + merge
commit, so merging across teams is sound). The set is bounded by the teams the reader belongs to
that have work in this one project — small, and `teamScoped` denies any team they are not in, so
the subscription cannot widen a read.

## D6 — `?open=<id>` is the project page's URL; no new route file

The mock splits index from project page. The shipped route already validates `?open=`; the roadmap
already navigates to it; `projects.spec.ts` already drives it. So `?open=` present renders the
project page (full surface, breadcrumb back), absent renders the index. A new
`teams.$teamId.projects.$projectId.tsx` would buy a prettier URL and cost the roadmap's navigation
contract and two e2e flows. Rejected.

The breadcrumb is a real link back to the index (`?open` cleared), and `Escape` on the project page
does the same, so the page is leaveable from the keyboard.

## D7 — The index is a PROGRESS READING, so its phrase register is honest about being softer

`Past target — N open` fires on `target_date < today AND status != completed`, with `N` the count of
readable issues not at done. It uses the urgent register's ink (`--status-urgent-ink`, the work-
surface ink, not band 3's `--status-urgent`).

It **does not** join the ONE attention number. That badge carries exactly four exception classes —
done in git not on the board, waiting on review over a day, checks failing, new in triage — and a
passed date is not one of them. Adding a fifth silently would break the invariant `ia.html` states
and `buildAttention` implements.

The mock's own self-critique names the residual weakness and it is real: `target_date` is a field
somebody typed once, the schema records no re-agreement, so an abandoned project cries wolf forever
while a re-planned one goes quiet the instant the date is edited, and the page cannot tell the two
apart. Not solvable without a project history table, which this change does not add. It is
disclosed here and in the `how ·` panel behind the phrase, which states the comparison in full:
*target date is a single stored field; nothing records whether it was re-agreed.*

## D8 — Accessibility: the drawn things say what they draw, and colour is never the only channel

- Every axis SVG carries `role="img"` and a **truthful** label naming what it draws, e.g.
  *"Checkout rebuild — target Aug 1, six days past; 11 of 13 issues done; 3 issues scheduled in
  Cycle 2."* A row that draws no mark at all (undated, no cycled issues) carries **no** `role="img"`
  and no label, following the reality track's rule that an inkless drawing states nothing to
  assistive technology either.
- The state bar on the project page keeps the mock's label form (*"11 done, 1 in progress, 1
  todo"*), and its three segments are also named in text beneath it.
- Every status distinction is carried by **glyph shape** as well as hue (the cycle-position family);
  `Target passed` and `Past target — N open` are **words**, not a red dot; the Done meter's fill is
  restated as `done/total` in text.
- The `how ·` affordances are real focusable controls (the shipped `How` component), Escape-closable.
- Contrast: every pair this change introduces is asserted in `packages/ui/src/styles/contrast.test.ts`
  in **every** theme block, light and dark. Where a mock ink misses its bar the **ink moves and the
  mock loses** — the precedent set by `issue-list-daylight` DI-2 and `triage-daylight` B8. Any
  measurement recorded below a bar must be recorded as scaffolding with its reason, never as a
  known failure written down at a lower bar.

## D9 — What "counted over the issues in your teams" means, and why nothing counts what it cannot see

The team-scoped issue read means issues from teams the reader is not in **never sync**. The client
cannot count them and cannot even prove they exist. So:

- the team split names only the teams whose issues arrived — never "and 2 teams you can't see";
- `done/total`, the meter and the state bar are all over readable issues only;
- the rule is stated once per surface in the mono footline, with a `how ·`, rather than implied by
  a number that looks complete.

## D10 — The degenerate states are drawn deliberately, not discovered later

The triage build shipped a panel that reserved its full measure over an issue with no description
and passed every test. This change names its empty shapes up front, and task 7.4 requires **looking
at each of them rendered**:

| State | What draws |
|---|---|
| workspace with no projects | the index's honest empty state — a label, not a paragraph; the `+ New project` action still offered to a writer |
| project with no issues | index row reserves team / meter / count and draws **nothing**; roadmap row draws its target mark and `No issues yet`; project page draws `No issues yet` |
| project with no target date | index reserves the target slot, draws nothing, and sorts the project last inside its status group; roadmap holds it under the `No target date` group header with its cycle dots still drawn |
| roadmap window with nothing scheduled | the row's axis draws the target mark and `Nothing scheduled` — six real issues nobody has put in a cycle is **not** the same nothing as no issues at all |
| project past its target | `Past target — N open` on the index, `Target passed` on the roadmap, the delta pill and the strip's urgent overrun on the project page |
| completed project past its target | **no** past-target phrase anywhere — the comparison excludes `completed` |
| project with no lead | the avatar slot is reserved and blank |

## D11 — The two spellings stay split

`issue.status` spells it `canceled` (`migrations/0004_issue_core.ts`); `project.status` spells it
`cancelled` (`migrations/0008_projects.ts`). Both mocks handle this correctly. This change keeps
each spelling correct for its own entity and reconciles nothing. A `Cancelled` group header is not
drawn over zero rows — a header is a container for rows, not a legend for the enum — but the label
and the status remain `Cancelled` for a project that has one.

## D12 — Tests: the tiers this earns

PROCESS.md §3's big-feature rule counts {synced entity/schema, mutator, permission surface,
signature UI}. This change touches **one** of them — signature UI. The two query relations widen no
predicate and add no entity. So: **unit + component + contrast, and the existing e2e spec is
UPDATED, not extended with a new file** — the same call `issue-list-daylight` made (DI-9) and the
same one `triage-daylight` made.

- **Unit** (`apps/web/src/projects/model.test.ts`): the derivations. Status grouping and intra-group
  order; the team split summing to the total; the past-target reading including the completed
  exclusion and the exactly-today boundary; the issue state segments; the target strip geometry; the
  roadmap axis over real cycles, including a window with no cycles at all and a cycle tail shorter
  than the axis.
- **Component** (`apps/web/src/projects/projects-view.test.tsx`, `project-page.test.tsx`,
  `roadmap-view.test.tsx`): what actually renders, including every row of D10's table.
- **Contrast** (`packages/ui/src/styles/contrast.test.ts`): every new pair in every theme block.
- **E2E** (`apps/web/e2e/projects.spec.ts`): selectors updated where the surface moved
  (`project-rail-item` no longer exists). No assertion weakened. `projects.spec.ts:188` and `:246`
  fail intermittently with `browserContext.close: Protocol error (Target.disposeBrowserContext)` for
  reasons unrelated to any diff — **re-run**, confirm the signature is the timeout and not an
  assertion disagreeing, and do not touch them otherwise.
- Two standing CI lessons: no test hard-codes a budget encoding e2e fixture size (fixtures
  accumulate across specs — derive bounds from the page), and no test's premise is what a Node
  runtime provides (CI is Node 24, dev machines here run 26).

**The falsifiable check** — fails on today's `main`, passes when this change is correct:

```
pnpm --filter @yapm/web test -- src/projects/projects-view.test.tsx -t 'past its target'
```

A workspace seeded with two projects sharing a target date of yesterday — one `active` with two
issues not done, one `completed` — renders `Past target — 2 open` on the first and no past-target
phrase on the second, and the index renders `Active`/`Completed` group headers with their counts.
On `main` the file does not exist, the string appears nowhere in the repository, and the surface is
a rail of `project-rail-item` buttons with no group headers.

## What is deliberately NOT built

Milestones · dependencies / blocking arrows / "blocked by" of any kind · resource levelling ·
per-person allocation or capacity · confidence, health or risk scores · budget · a project
description or brief entity · burn-up / burndown / any curve over the project's life · a project
activity timeline · slip history · a "will it land" projection · a percent per row · review rollups
· check durations · a second attention number · a `Cancelled` group header over zero rows · a new
route file · a new table, migration, mutator or named query.

The roadmap's `Jul – Nov ▾` control is drawn in the mock as a button. It ships as a **mono label**
stating the axis window the data produced, not a dropdown: the shipped roadmap has no window
control, adding one would be a new capability rather than a redrawing, and a chevron on something
that opens nothing is a lie about an affordance. Recorded as a deliberate difference from the mock.

## Left standing, and named

- The mock's `more▾` menu, drawn open on frame A, covers 14px of the Active group header. That is a
  property of the *drawing* (a transient drawn open to show where the destination is reached from),
  not of the app: in the app the menu is closed on arrival. Nothing to build.
- `DESTINATIONS.md` §4 records `--text-3` at 2.9:1 on `--bg` as an inherited, shipped-token problem.
  This change does not retune the token; where it would carry a fact, the ink moves (D8).
- The mock's frame B says `11/13` twice, once as a number and once as a bar — the redundancy
  `delivery.html` spent a diet removing, and named in the mock's own self-critique. Carried as
  drawn, because the number is the fact and the bar is the composition; if the render pass (7.4)
  says it reads as repetition, the bar keeps its segments and the number keeps its `/13 done`.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no migration, no new mutator, no new named query.** The only schema-side edits
  are two `.related(...)` extensions on two existing project queries, both inside their existing
  predicates.
- **Every shipped capability survives.** Inventory, taken before any edit, of what the two shipped
  views can do today: create a project (writer-gated dialog: name, lead, status, target date), edit
  one, delete one (issues survive with `project_id = null`), select a project and read its issues,
  open an issue from a project into its team's list, read progress as `done/total · percent`, a
  viewer reading everything and offered no write control, the roadmap's month axis + now line +
  undated projects held aside + roving-focus keyboard order + `Enter` opens. **All of it survives**;
  the shapes change. Any deliberate removal is reported here with its reason before it lands.
- **Keyboard-first**: the roadmap's roving focus is preserved verbatim; the index gains the same
  model; the project page's issue rows are focusable and openable; the project page is leaveable
  with `Escape`; every `how ·` is a real control.
- **Sub-100ms, offline**: every fact renders from already-synced rows; the derivations are pure
  functions over them.
- **Accessibility**: truthful `role="img"` labels on every drawn axis, nothing conveyed by colour
  alone, contrast asserted in every theme block.
- **`ROADMAP.md` is not edited** — parallel builds; the maintainer adds the row at archive time.

---

### B1 — Both query extensions landed inside their existing predicates

`projects.all`'s related issues gained `.related('cycle')`; `projects.get`'s gained
`.related('labels')` and the shared `withLinkedDelivery(...)` wrapper. Both sit **inside** the
existing `teamScoped(...)` call, so the relations hang off issues the predicate has already
admitted and every related row carries the issue's own `team_id`. No predicate, ordering, table,
migration, mutator or named query changed. `queries.test.ts` now asserts the relation **aliases**
on the issues subquery (`cycle` on `all`; `labels` and `issueLinks` on `get`) rather than assuming
them, beside the two existing team-scoping assertions, which are untouched.

### B2 — The roadmap view was RE-WIRED in this pass, not redrawn

Task 3.7 requires deleting `roadmapTimeline` rather than leaving it beside its replacement, and
`roadmap-view.tsx` was its only caller — so leaving the old function would have been the one thing
the task forbids, and deleting it without touching the view would have broken the build. Chosen:
delete `roadmapTimeline` and port `roadmap-view.tsx` onto `roadmapAxis` **without redrawing it** —
same rows, same roving-focus model, same `roadmap-row` / `data-roadmap-index` contract the e2e
drives. Three things changed along the way because leaving them would have contradicted the
change's own constraints in an intermediate state: `{n}% done` became `done/total` (no percent
anywhere), the four status dots became the shared cycle-position glyph family, and the refusal
footnote and the `Target passed` phrase are now on the surface. **Task group 6 still owns the
redrawing** — the cycle bands, the issue marks, the `no cycles past <date>` statement, the
`role="img"` labels and the axis-window label are computed by `roadmapAxis` but not yet drawn.

### B3 — `?open=` is dispatched inside `ProjectsView`, and the route file gained one prop

`ProjectsView` now takes `teamId` and returns `ProjectPage` when `openProjectId` is present, the
index otherwise. The route file's only edit is passing `teamId` through; no new route file, and the
roadmap's navigation contract and both e2e flows are unchanged. `ProjectsView` itself calls no
hooks before the branch, so the two surfaces are separate hook trees.

### B4 — The index row is a focusable `div`, not a `button`

Ambiguous: the row must be the keyboard target AND carry a real `how ·` control, and an interactive
element cannot nest inside a `<button>`. Chosen: the shipped `IssueRow` shape — a focusable element
with `data-slot`, a roving `tabIndex`, `onClick` and a container-level `onKeyDown` that only acts on
events whose target is a row (so the `how ·` panel keeps its own `Enter` and `Escape`). The status
glyph on a row is `aria-hidden`: the group header above it already states the status in words, and
`StatusGlyph`'s own label speaks the ISSUE vocabulary (`Todo`), which would be wrong over a project.

### B5 — The project page subscribes deployments per contributing team, lifted through one index

One `deployments.byTeam` subscription per team that actually contributes an issue, each in its own
zero-drawing subscriber component (hooks cannot be called in a loop), publishing its rows into a
`Map` keyed by team id that is merged through the shared `buildDeploymentIndex`. The publish guard
compares row identity, so a stable sync tick cannot loop. `teamScoped` denies any team the reader is
not in, so the set is bounded by their own memberships and no read widens.

### B6 — `targetStrip` returns no `createdFraction`, because it would always be 0

The left end of the strip is the created dot at position zero by construction, so returning a
number for it would have put a per-project *left edge* in the model's vocabulary for no information.
The view draws the dot at the origin and **labels it `created`** — the label is the disclosure. The
model returns only `{ targetFraction, nowFraction, overrun }`, and the roadmap's row shapes carry no
start, span, duration or width at all, asserted over the returned object keys in `model.test.ts`
rather than by reading the source.

### B7 — Deliberate differences from the mocks (this pass)

- **The `how ·` on the project page's footline** reads `how ·`, not the mock's `more ·`: `How` is
  the shipped affordance and its trigger word is part of the language, not per-page copy.
- **The state bar's `todo` segment** is drawn at full token opacity, not the mock's `fill-opacity
  .45`: a wash cannot be measured against the contrast bar, and 7.8 has to measure it.
- **Segment order** on the state bar is the shared `ISSUE_STATUSES` order (backlog → canceled), so
  the bar reads left-to-right as cycle position; the mock draws done-first for its one fixture.
- **The `+ New project` control** is a text button carrying its own accessible name (`+ New
  project`), replacing the shipped icon-only `PlusIcon`. The `new-project` test id is unchanged.
- **The `Cancelled` label** stays correct for a cancelled project; the header is simply never drawn
  over zero rows. Neither enum spelling was touched (`PROJECT_STATUS_TO_KIND` is the single place
  the project's `cancelled` meets the issue glyph family's `canceled`).
- The mock PNGs were **not** compared in this pass — the render comparison is tasks 9.4/9.5.

### B8 — Capabilities: every shipped one survives, one shape changed

Create / edit / delete a project (same dialogs, moved verbatim into `project-controls.tsx` so the
index and the project page can both mount them without a circular import), read a project's issues,
open an issue into its own team's list, the viewer reading everything with no write control, the
roadmap's roving-focus keyboard model, undated projects held aside. **Removed:** the 256px
`project-rail-item` rail and the percent readings, both by the mock's fold-list item 13/9; the
`Project progress` `role="progressbar"`, whose fact is now the `done/total` reading over a labelled
state bar. `apps/web/e2e/projects.spec.ts` and `triage.spec.ts` were migrated to the new selectors
with no assertion weakened — but Playwright was **not run in this pass** (the orchestration reserves
it for CI), so task 7.9 is left unticked until it is verified green.

### B9 — What this pass did not read

`northstar/ia.html` and `reference/zero.md` were not re-read (tasks 1.4/1.5 left unticked). No new
Zero API was used — the two edits are `.related(...)` calls beside existing ones — and the band-2
rules were followed from the mocks and from `masthead.tsx`'s own contract. A later pass should close
both before the change lands.

---

### B10 — The Roadmap axis is a fixed 1000px measure, not a percentage of the viewport

The shipped roadmap laid its axis out as `flex-1`, so a cycle band would have been a different width
on a narrow window than on a wide one and the header's bands would have drifted off the rows'
gridlines at some widths. Chosen: the mock's own measure — a 1000px axis under a 260px name column
and a 140px Done column — with the whole page scrolling sideways as one drawing. A band is then the
same width in the header and on every row, and one day is the same distance everywhere on the page.

### B11 — The row's TEXT is HTML, not SVG `<text>`

`Target passed`, `Nothing scheduled`, `No issues yet` and the mono target date are absolutely
positioned HTML spans over the drawing rather than glyphs inside it. Two reasons, both load-bearing:
the phrases must be readable by assistive technology even on a row whose drawing carries **no**
`role="img"` and no label (task 6.6 — an inkless drawing states nothing), and HTML text is measured
by the browser, so the mock's hand-computed `x` offsets after a date string are unnecessary. The SVG
draws only marks and rules.

### B12 — A third phrase the mock does not have: `Scheduled outside this window`

The mock has two nothings. The model carries three states, because `scheduledCount` counts issues in
*some* cycle whether or not that cycle falls inside the drawn window. Drawing `Nothing scheduled`
over a project whose work is scheduled in a cycle off the edge of the axis would be false. So:
`No issues yet` (no issues at all) · `Nothing scheduled` (issues, none in any cycle) · `Scheduled
outside this window` (issues in a cycle the axis does not reach). The third is quiet ink; only the
middle one is the mock's.

### B13 — Deliberate differences from `destinations/roadmap.html`

- **The axis window is a mono LABEL in the masthead's `lens` slot, not the mock's `Jul – Nov ▾`
  button.** The page has no window control; a chevron over nothing is a lie about an affordance.
- **The filter line's left slot states `Cycle bands <team>` instead of the mock's `Status` / `Lead`
  chips.** Neither chip filters anything on the shipped page, and the slot is the only place the
  team-vs-workspace scope split can be said where it is read: the bands are this team's cycles, the
  projects are the workspace's. It carries the one `how ·` that discloses that rule.
- **The footnote's fold reads `how ·`, not the mock's `more ·`** — precedent B7; `How` is the
  shipped affordance and its trigger word is part of the language, not per-page copy.
- **Both edges of every cycle band are ruled, not one line per boundary.** Two consecutive cycles do
  not share a date (one ends the day before the next starts); merging the two lines, as the mock's
  hand-drawn grid does, would close a gap the stored dates leave open.
- **Undated rows draw their phrase too.** The mock leaves its two undated rows silent, which is the
  gap its own closing note complains about; the two nothings must read differently everywhere, so an
  undated row states its phrase at the left of the drawing where there is no target mark to hang it
  from.
- **The cancelled target mark is a ring carrying an ×**, matching the shared cycle-position family;
  the mock's fixture has no cancelled project so it draws none.
- **The mock PNGs are not in the repository** (`destinations/*.png` do not exist on this branch), so
  tasks 9.4/9.5 cannot compare against them from here. The comparison is against the HTML mock as
  rendered, and the render sweep is still owed.

### B14 — The Done meter past twenty issues

One tick per readable issue is the drawn fact, and its length encoding issue count is the meter's
known fault (the mock says so). A 60-issue project would simply overrun the 140px column, so past
twenty issues the ticks share the track instead of each taking 3px — still exactly one tick per
issue, never a resampled bar, and the mono `done/total` beside it carries the exact number either
way.

### B15 — What this stage did NOT do

`packages/ui/src/styles/contrast.test.ts` (task 7.8) is untouched: this stage was scoped away from
`packages/ui` while two other destination rebuilds are in flight in parallel worktrees. The pairs it
owes are named in the task. Task 7.10's e2e assertion is written into `projects.spec.ts` but is left
unticked because Playwright was not run here — CI on the open PR is where it is proved.
