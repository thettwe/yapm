---
title: Projects & roadmap
description: Workspace-level projects read as a progress reading rather than a plan, and a roadmap over a real time axis that refuses to draw a bar no stored date supports.
---

A **project** groups issues toward a shared outcome — a launch, a theme of work, a migration. It
stores exactly five things: a **name**, an optional **lead**, a **status** (**Planned**,
**Active**, **Completed** or **Cancelled**), an optional **target date**, and the workspace it
belongs to. Everything else you read about a project on these pages is **computed from its
issues**. Nothing is entered.

That is why the Projects index is a **progress reading**, not a plan: a project's honest summary
is the state of its issues plus its one date.

Open **Projects** at `/teams/<teamId>/projects` and **Roadmap** at `/teams/<teamId>/roadmap`, or
take them from the **more▾** menu in [the deck](/features/app-frame/) — `g p` and `g m`.

## Projects belong to the workspace; the deck above them belongs to a team

Issues, cycles and labels belong to a **team**. A project belongs to the **workspace**, so one
project can hold issues from several teams, and every workspace member — including a free viewer
— can see every project. Both surfaces draw that seam rather than hide it:

- a dashed, workspace-marked **scope chip** beside the page title;
- a **team split** on each index row (`ENG 11 · DES 2`), from the issues' own teams;
- one `how ·` per surface at the foot, which states the counting rule when it is opened: every
  project in the workspace is listed, and its teams, meter and count are taken over the project's
  issues in teams you belong to. The rule is a query definition, so it is read on request rather
  than printed every visit.

Issues from teams you are not in **never sync to your client**, so they cannot be counted and the
page never claims otherwise. Two people in different teams legitimately read the same project with
different totals. Nothing says "and 2 teams you can't see", because the client cannot prove that
number.

## The Projects index

Projects are **grouped by status** — Active, Planned, Completed, Cancelled — and sorted inside a
group by **target date, undated last**, then by name. A status with no projects draws **no group
header**: a header is a container for rows, not a legend for the enum. The filter line states the
two rules it applies, `Group Status · Sort Target`.

Each row, left to right:

| Part | What it states |
| --- | --- |
| status glyph | the project's status, as a shape as well as a hue |
| name | quiet ink when the project is completed or cancelled |
| `Past target — N open` | only when the date has gone by (see below) |
| team split | which teams the readable issues came from, and how many from each |
| done meter | the share of readable issues at **Done**, inked with the done token |
| `done/total` | the same fact as a number — **no percent anywhere** |
| lead avatar | blank and reserved when the project has no lead |
| target date | mono; urgent ink when it has passed |

**A quiet row draws no ink.** A project nobody has broken down into issues yet reserves its team,
meter and count slots and draws **nothing** in them — not a zero, not an empty track. Six real
issues with none done is a different fact from no issues at all, and the page shows the difference:
the first reads `0/6`, the second reads nothing. Nothing on the row shifts the day its first issue,
lead or date arrives.

### `Past target — N open`

A project reads as past its target when `target_date` is **earlier than today** and its status is
**not Completed**. A project whose target is exactly today has not passed it, and a completed
project never reads as past its target however old the date is. `N` is its readable issues **not**
at Done. Over a project with **no readable issues** the row reads `Past target` alone: `0 open`
would assert "nothing open" over work you may simply not be able to see, and no other slot on the
row draws a zero either.

This reading deliberately **does not** join the attention count in the deck. That badge carries
exactly four exception classes — done in git but not on the board, waiting on review over a day,
checks failing, new in triage — and a date somebody typed once is not one of them.

The `how ·` beside the phrase says the rest out loud: `target_date` is a **single stored field**,
and nothing in the schema records whether it was ever re-agreed. An abandoned project cries wolf
forever; a re-planned one goes quiet the moment somebody edits the date. The page cannot tell those
two apart, so it says so rather than implying a judgement it cannot make.

## One project's page

Opening a project (click, or `Enter` on the focused row) draws its own page at
`?open=<projectId>`, with a breadcrumb back and `Escape` to leave. Its head carries the status
glyph, the name, a status pill, the same scope chip, and **Edit** for anyone who can write. Under
it, a facts line: **LEAD** and **TEAMS**. There is no description — the entity has none, and no
room is reserved for one.

Then two vitals, and only two.

**ISSUES** — `<done>` over `/<total> done`, and a segmented **state bar** of what the issues *are*
now, in status order. Every segment is named beneath the bar as `<glyph> <count> <label>`, and the
bar itself carries a label reading e.g. *"11 done, 1 in progress, 1 todo"*. A project with no
issues draws the label `No issues yet` and **no bar at all** — never a zero-width segment, never an
empty frame.

**TARGET** — the date, a `N days past` pill when it has gone by, and a strip.

The strip runs from the project's **creation** to its target, with today marked and any overrun
drawn in the urgent ink. Its left end is labelled **`created`**, and that label is the whole point:
**it is not a start date.** A project stores no start. `created` is when somebody made the record,
which is a real timestamp and a poor proxy for when work began — so the page names it exactly and
claims nothing more. An undated project draws no strip: the second date does not exist.

Beneath the vitals, the project's issues are drawn in the **same row anatomy the issue list
uses** — priority mark, status glyph, mono key, title, the [rest phrase](/features/issue-list/),
the [reality track](/features/reality-vocabulary/), age, labels, assignee. A row with no linked
change carries a **reserved but inkless** track, exactly as it does everywhere else. Done issues
sit behind a fold stating the true remaining count. Clicking a row (or `Enter`) opens the issue in
**its own team's** list, not the deck team's.

## The roadmap

The roadmap lays every project over a **real time axis**. The axis window is stated as a mono label
beside the title — it is a reading of the data, not a control, so it carries no chevron.

The window **covers every target it draws**. It is anchored on the current cycle (or the start of
this month) and runs at least three months forward **from that anchor**, but a target that has
already gone by pulls the left edge back to the start of its own month — otherwise every overdue
project's mark would pile onto the same pixel at the left edge and stop being a reading at all.
Pulling the left edge back never shortens the runway, so a workspace whose targets have all passed
still draws today, the cycle you are in, and the marks scheduled in it. Once the window spans a year
change, the month ticks and the window label carry the year.

The axis header carries:

- **month ticks and labels**;
- a **named band per cycle** the deck's team has actually created, drawn at that cycle's stored
  start and end dates;
- the **today** caret;
- and, where the stored cycles run out, `no cycles past <date>` instead of ruled columns over
  months nobody has planned.

The filter line states `Cycle bands <team>`, because the bands are **that team's** cycles while the
projects are the **workspace's**. A project's issue that sits in another team's cycle is still
marked at that cycle's own stored dates — the mark is truthful even though no band is drawn around
it. An issue in no cycle draws no mark.

Each row draws its status glyph, name, lead, a **Done meter** of one tick per readable issue (filled
for done) and `done/total` — then, on the axis: the cycle gridlines, the now line, a **target mark**
at the target's date shaped and inked by status, and a mark per cycled issue. In words, over the
drawing: `Target passed` where the date has gone by, `Nothing scheduled` where a project has issues
but none in any cycle, `Scheduled outside this window` where its work sits in a cycle the axis does
not reach, and `No issues yet` where there are none. Undated projects sit under one **No target
date** header and keep their meter and their marks.

Each row is one control with **one** spoken name, and that name carries everything the drawing beside
it draws: the project, its status, the target and how it stands against today, the done-over-total,
and which cycles its marks sit in. The drawing itself is hidden from screen readers rather than
labelled separately — a row is a button, and a button's children are presentational, so a second
label inside it would never be announced at all.

### What this page won't guess

> **a project's start — only a target is stored, so nothing here draws a bar.**

That sentence is on the page, not just in this document. Every bar has a left edge; a project has no
start date; so every bar here would be an invention, and the whole grammar that follows a bar —
spans, overlaps, slips, critical paths — would be invented with it. The earliest issue's creation
date was available as a derivation and was **refused**: it records when somebody typed a title.

## What neither surface will draw, and why

| Not drawn | Why |
| --- | --- |
| a bar, a span, a start or a left edge per project | no start date is stored (the strip's `created` end is labelled as exactly what it is) |
| milestones | not an entity; a project has one date |
| dependencies, blocking arrows, "blocked by" | not an entity; drawing one would be a claim nothing records |
| resource levelling, per-person allocation, capacity | metrics here are team-level only, never per person |
| confidence, health or risk scores | a number nothing measures |
| budget | not an entity |
| a project description or brief | not an entity, and no room is reserved for one |
| a percent per row | over a project nobody has broken down yet, a percent reads 0% — which is a lie |
| burn-up, burndown or any curve over a project's life | there is no per-day history to draw it from |
| a slip history or a "will it land" projection | `target_date` is one field with no record of re-agreement |
| a second attention number | the deck's badge carries four classes and this is not one of them |

## Keyboard

All three surfaces use the same roving-focus model:

- **Projects index** — `j`/`k` or ↑/↓ move between rows, `Enter` opens the focused project.
- **A project's page** — issue rows are focusable and `Enter` opens one; `Escape` returns to the
  index.
- **Roadmap** — `j`/`k` or ↑/↓ move between rows, `Enter` opens the focused project.

The roving tab stop always survives on a **mounted** row when the set of rows shrinks under it, so
`Tab` returns you to the list rather than to the top of the page. Every `how ·` is a real control
you can open with `Enter` and close with `Escape` — including the ones that sit inside a row, which
never steal the row's own click.

## Creating and editing projects

Anyone who can write (admins and members — viewers are read-only) can create a project with **+ New
project** on either surface: a name, and optionally a lead, a status and a target date. **Edit**
changes any of those or **deletes** the project. Deleting a project never deletes its issues — they
are simply unassigned from it.

## Assigning issues to a project

From the issue list, open the command palette (⌘K / Ctrl-K) on a focused or selected issue — or
press **P** — and choose **Move to project**, then pick a project (or **No project** to clear it).
Any team's issue can join any project; the action respects your write permission and is hidden for
viewers.

**Routing an incoming issue is the second path.** The [triage](/features/triage/) inbox's **Route**
panel lists a **Project** row alongside status, assignee, cycle and labels, and writes all five —
plus clearing the triage flag — in one atomic action. It applies the same rule as **Move to
project**: the project need only exist in the workspace, because a project spans teams, while the
assignee, cycle and labels must belong to the issue's own team.

## Grouping and filtering by project in the list

The issue list can **filter by project** — pick one or more projects (or **No project**) to narrow
the list — and **group by project**, which buckets issues under each project with a **No project**
group last. Like the cycle axis, project grouping is a view-only convenience; saved views persist
the other groupings.

## Viewers

Viewers are free and unlimited and read every project, its progress and the roadmap like anyone
else. They cannot create, edit or delete a project, and they cannot move issues into one — those
controls are absent, not merely disabled, and the write is never attempted.

## A note on two spellings

An issue's terminal status is spelled `canceled` and a project's is spelled `cancelled`. They are
two different enums in two different migrations, and each is correct for its own entity. yapm keeps
them apart rather than "fixing" one to match the other, which would mean a migration that rewrites
stored rows to settle a spelling argument.
