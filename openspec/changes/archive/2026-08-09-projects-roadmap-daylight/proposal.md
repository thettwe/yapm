## Why

`design-explorations/overhaul-2026-08/destinations/projects.html` (two frames: the index, and one
project's page) and `roadmap.html` are the approved drawings of the two surfaces reached from
`more▾` — `g p` and `g m`. Both sit inside the shipped three-band frame (PR #33) wearing
pre-overhaul interiors. PR #32/#38 gave the product its drawn vocabulary, PR #34 its phrase
dictionary, PR #42 the most recent destination rebuilt to its mock; these two were never drawn.

They are ONE change because they are two readings of one entity over **one reconciled fixture**:
`DESTINATIONS.md` §1 records that the two mocks originally described two different workspaces at
the same instant, and closed that by making `roadmap.html`'s nine projects canonical and rewriting
`projects.html` onto them. The code has the same coupling — one derivation module
(`apps/web/src/projects/model.ts`), one e2e spec, and the roadmap's `Enter` opens the project page
this change creates.

What the shipped surfaces get wrong, concretely:

1. **Projects is a master–detail rail, not a destination.** A 256px rail lists every project, a
   detail pane repeats one of them, so the page lists each project twice and squeezes the reading
   into what is left. The mock splits it into two surfaces: an index that is a **progress reading**
   of all nine, and a project page worth a URL.
2. **The progress bar is inked with the brand accent.** DESIGN's rule is that the accent is never a
   status. Progress is a Done share; it is inked `--status-done`.
3. **A percent stands where a count belongs.** `62% done` over a project with no issues reads `0%`,
   which is a lie about a project nobody has broken down yet. The mocks draw a meter plus
   `done/total`, and a project with no issues draws **no ink at all**.
4. **The roadmap says `No target date` on every undated row**, as a per-row italic ornament, and
   shows nothing else about those projects. The mock lifts it to one group header and gives those
   rows their real content back.
5. **Nothing on either surface says a project is WORKSPACE-scoped** while the deck above it is
   team-scoped. A reader is invited to assume the project belongs to the team named two stops to
   the left. One project can hold issues from several teams.
6. **The roadmap's axis carries months only.** Cycles have real `start_date` / `end_date` columns;
   the axis can be truthful about the team's actual rhythm instead of generic month gridlines.
7. **Neither surface draws the reality vocabulary.** A project page listing issues draws them
   without the phrase, the reality track or its reserved-empty slot — the vocabulary every other
   dense row in the product now speaks.
8. **Lucide's `TargetIcon` stands where a mono date is the fact**, and three prose sentences
   ("No projects yet. Create a project to see it on the roadmap.", "No issues in this project yet.
   Assign issues to it from the issue list.", "No project selected.") are chrome writing essays.

Vision principles served: **honesty about what the data can support** (the whole reason the roadmap
mock is good — see below), **sub-100ms and offline-capable** (every fact renders from rows Zero has
already synced), **keyboard-first**, and **team-level metrics only** (a project has a lead; it never
has an allocation).

### The hardest constraint, and the reason the roadmap mock is good

**A project has no start date.** Only `target_date` is stored. A bar with a left edge is therefore
an invention, and the Gantt idiom that follows one — spans, slips, critical paths — would all be
invented with it. `roadmap.html` refuses the bar outright, draws dated target marks and computed
progress instead, and **states the refusal on the surface**: *"What this page won't guess: a
project's start — only a target is stored, so nothing here draws a bar."* That sentence ships.

Earliest-issue-`created_at` was available as a derivation and is **rejected, not overlooked**. If a
future change derives a left edge from something real it must say so on the surface; this change
draws no bar and no left edge of any kind.

## What Changes

**The Projects index** (`g p`) — nine projects as one list, grouped by status, sorted by target
inside each group with undated projects last:

- Masthead `Projects` + mono count + a dashed, workspace-marked **scope chip** (`A Acme workspace`),
  because band 2 is where this surface argues it is wider than the deck above it.
- Row anatomy: status glyph (the shared cycle-position family) · name · spring · phrase · **team
  split** (`ENG 11 · DES 2`, from `issue.team_id`) · progress meter inked `--status-done` ·
  `done/total` · lead avatar · mono target date.
- `Past target — N open` in the urgent register when `target_date < today AND status != completed`.
  It does **not** join the ONE attention number — that count carries exactly four exception classes
  and a passed date is not one of them.
- Quiet rows draw no reality ink: a project with **no issues** reserves the team / meter / count
  slots and draws nothing in them; a project with **no target** reserves the target slot and draws
  nothing. A `Cancelled` group header is not drawn over zero rows.
- A mono footline stating the counting rule once: `workspace-scoped · counted over the issues in
  your teams`, with a `how ·`.

**One project's page** — the same route, `?open=<projectId>`, which is now a full surface rather
than a detail pane. The mock features the overdue project, because past-its-target is the moment
worth designing:

- A breadcrumb back to the index, the name, its status pill, and the same scope chip.
- Two vitals: an **ISSUES** reading (`11 /13 done` over a state bar segmented done / in progress /
  todo) and a **TARGET** reading (the date, a `6 days past` delta pill, and a created→target→today
  strip **where `created_at` is labelled as exactly what it is** — the one place a left edge is
  drawn, and it is labelled `created`, not `started`).
- Its issues grouped by status, drawn with the **shared row anatomy** — priority mark, status
  glyph, mono key, title, phrase, reality track (reserved and empty when the issue has no linked
  change), age, labels, avatar — with a fold over the done ones.
- `No issues yet` where there are none, drawn as the mock draws it, not as a paragraph.

**The Roadmap** (`g m`) — one axis over a real time window:

- The axis header carries **month ticks and cycle boxes drawn from real `cycle.start_date` /
  `cycle.end_date`**, a `today` caret, and — where the team has created no further cycles — a mono
  statement of that fact (`no cycles past <date>`) rather than ruled columns that would imply
  planning nobody has done.
- Per row: status glyph · name · lead · a **Done meter** (one tick per issue, filled for done) ·
  `done/total` · and on the axis a **target mark** at its date plus each of the project's issues as
  a dot in the cycle column it was actually placed in. A project past its target and not completed
  reads `Target passed` beside its mark.
- **No bar, no left edge, no dependency arrow, no milestone, no confidence score.** The refusal is
  stated in the page's footnote.
- Undated projects move from a repeated per-row ornament to one `No target date` group header, and
  those rows now show where their work is scheduled.
- Rows sort by target date (the sequence a time axis makes legible), and the filter bar says so.
- The keyboard model that ships today — roving focus, `j`/`k`/arrows, `Enter` opens — survives
  unchanged and now opens the project page.

**One query extension, no new query, no new table, no new mutator.** `projects.all` relates each
readable issue's `cycle` (for the roadmap's dots); `projects.get` — an existing named query nothing
renders today — gains `labels` and the shared `withLinkedDelivery` subtree so the project page can
speak the reality vocabulary. Both keep their predicates character for character: `isMember` on the
project, `teamScoped` on the issues.

Non-goals, folded deliberately — each is recorded in the mocks' closing comments and this build
honours all of them:

- **No bar and no start date**, per above. **No milestones or phases** (a project owns exactly one
  dated thing). **No dependencies or blocking arrows** — there is no issue↔issue or project↔project
  link table of any kind.
- **No burn-up, burndown, or slip history.** There is no issue status-history table and no project
  history table, so a curve or a "was Aug 1, moved to Aug 15" would be fabrication.
- **No confidence, health or risk score; no budget; no resource levelling; no per-person
  allocation.** Nothing stores them, and the last two would break the team-level rule twice over.
- **No project description entity.** The project is name, lead, status, target date. The page never
  reserves room for prose it cannot fill — the lesson the triage build paid for.
- **No second attention number.** `1 project past target` is not one of the four exception classes;
  it is drawn as a row phrase and a delta pill and stays uncounted.
- **No `Cancelled` group header over zero rows**, and **no reconciliation of the two spellings**:
  an issue is `canceled` (migrations/0004) and a project is `cancelled` (migrations/0008). Each
  spelling stays correct for its own entity.
- **No new route file.** The project page is `?open=<id>` on the existing route, which the roadmap
  already navigates to and the e2e already drives.

## Capabilities

### New Capabilities

<!-- none: this change re-draws two existing destinations of one existing capability -->

### Modified Capabilities

- `projects`: the index as a status-grouped progress reading with the team split, the past-target
  phrase and quiet rows that draw no ink; the project page as a surface of its own carrying two
  vitals and its issues in the shared row anatomy; the roadmap's axis carrying real cycle
  boundaries, the drawn refusal of the bar, the Done meter and the per-cycle issue dots; the
  workspace-vs-team scope made legible on both surfaces; and the two query extensions that feed
  them, with both read predicates unchanged.

## Impact

- `packages/schema/src/zero/queries.ts`: `projects.all` relates `cycle` on its (already
  team-scoped) issues; `projects.get` gains `labels` and `withLinkedDelivery`. No new named query,
  no predicate change, no new table, no migration, no mutator.
- `apps/web/src/projects/model.ts`: extended with the pure derivations both surfaces read — status
  grouping, the team split, the past-target reading, the issue state segments, the target strip
  geometry, and a roadmap axis that takes real cycles. `roadmapTimeline` is superseded by it.
- `apps/web/src/projects/projects-view.tsx`: split into the index and the project page.
- `apps/web/src/projects/roadmap-view.tsx`: rebuilt to `roadmap.html`.
- `apps/web/src/routes/teams.$teamId.projects.tsx`: unchanged contract (`?open=`), which now
  selects the project page instead of a rail selection.
- `packages/ui/src/styles/contrast.test.ts`: this change's pairs in every theme block, light and
  dark — the meter's filled and unfilled ticks, the target mark on the axis ground, the cycle-box
  stroke, the `Target passed` / `Past target` ink, the delta pill on its wash, and the state bar's
  three segments.
- `apps/web/e2e/projects.spec.ts`: selectors updated where the surface moved (`project-rail-item`
  is gone). No assertion weakened; the viewer and convergence tests keep their claims.
- No dependency, env var, container, table, migration, mutator or named query is added or changed.
  `ROADMAP.md` is deliberately **not** edited — two other destination rebuilds are in flight in
  parallel worktrees and that file is the guaranteed conflict; the maintainer adds the row at
  archive time.

Docs: `apps/docs/src/content/docs/features/projects.md` (the index's row anatomy and its grouping,
the project page's two vitals and what the created→target strip does and does not claim, the
roadmap's axis and cycle bands, the complete list of what neither surface will draw and why, and
the keyboard model for all three). `README.md`'s feature line for Projects/Roadmap if it describes
either surface's shape.
