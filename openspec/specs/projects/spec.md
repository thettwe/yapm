# projects Specification

## Purpose
Work that outlives a cycle and crosses team lines: a workspace-level project any member can read,
an index grouped by status, a page of its own, and a roadmap that places projects on a real time
ruler drawn from stored cycle dates. Progress is a `done/total` reading over readable issues and
never a percent, because a percent over a project nobody has broken down yet reads as zero and
lies. A project that is late says so in text and never joins the team's attention count. Archived
from change projects-roadmap and extended by projects-roadmap-daylight (PR #46).

## Requirements

### Requirement: Projects are workspace-level, readable by any member

The system SHALL model a project as a workspace-level entity (a `workspace_id`, no `team_id`) with a name, an optional lead (a workspace user), a status (planned / active / completed / cancelled), and an optional target date. Every project SHALL be readable by any workspace member — including viewers — through the `isMember` gate; a non-member SHALL get an empty result (deny by empty query). An issue from any team SHALL be assignable to any project.

Work-graph placement: a workspace-level grouping node that issues (of any team) point at via a nullable `issue.project_id`. Permission story: reads gated by `isMember`; the roadmap is a genuine cross-team overview.

#### Scenario: A member reads every workspace project

- **WHEN** a workspace member queries projects
- **THEN** the query returns every project in the workspace

#### Scenario: A non-member is denied

- **WHEN** a user who is not a workspace member queries projects
- **THEN** the synced query returns nothing (deny by empty query)

#### Scenario: A viewer reads projects but cannot write

- **WHEN** a viewer opens the projects view
- **THEN** every project is visible and no create/edit/delete control is offered or accepted

### Requirement: A workspace-level project query never widens issue reads

The system SHALL surface a project's issues only through the team-scoped predicate: the issues
related in `projects.all` / `projects.get` SHALL be filtered so a caller sees only the project's
issues in teams they belong to. A workspace-level project query SHALL NOT sync issues from teams the
caller is not a member of.

Facts related **through** those issues — their cycle, their labels, their linked pull request and
that change's checks and reviews — SHALL be reached only from issues that predicate already
admitted, so extending what a project query relates SHALL NOT widen who can read what. Any
deployment facts a project surface draws SHALL be read through the existing team-scoped deployment
query, per team, so a cross-team surface cannot assemble a deploy fact from a team the caller is not
in.

Work-graph placement: project (workspace-level) → related issues (team-scoped) → that issue's cycle,
labels and linked change. Permission story: the `isMember` project read composes with the
`teamScoped` issue read; the team boundary on issues is never crossed.

#### Scenario: Related issues are team-scoped

- **WHEN** a member of team A (but not team B) reads a project that spans both teams
- **THEN** only the project's team-A issues are synced to them, and progress is computed over those

#### Scenario: Related cycles and changes cross no boundary

- **WHEN** a member reads a project whose issues span teams they are and are not in
- **THEN** the cycles, labels and linked changes that arrive are only those hanging off issues the team-scoped predicate already admitted

#### Scenario: A viewer's project page assembles no deploy fact from a team they are not in

- **WHEN** a member opens a project holding issues from a team they do not belong to
- **THEN** no deployment row from that team is read, and no deployment claim is made about it

### Requirement: Project writes are canWrite-gated; the lead is a workspace member

The system SHALL provide `project.create`, `project.update`, and `project.delete` shared mutators, each gated by `canWrite` (member, non-viewer), rejecting viewers and non-members before any existence check. A project SHALL default to `planned` when no status is given. When a lead is supplied it SHALL be validated to be a workspace member. Deleting a project SHALL unassign its issues (`project_id → null`) without deleting them.

Work-graph placement: lifecycle mutators on the workspace-level project. Permission story: any writer manages any project; a viewer cannot.

#### Scenario: A member creates a planned project

- **WHEN** a member creates a project with only a name
- **THEN** it is stored with status `planned`, no lead, and no target date

#### Scenario: A viewer cannot create a project

- **WHEN** a viewer attempts to create a project
- **THEN** the mutation is rejected before any write

#### Scenario: A non-member lead is rejected

- **WHEN** a project is created or updated with a lead who is not a workspace member
- **THEN** the mutation is rejected

#### Scenario: Deleting a project unassigns its issues

- **WHEN** a project with assigned issues is deleted
- **THEN** the project is removed and its issues survive with `project_id = null`

### Requirement: Assigning an issue to a project respects the issue's team-scoped permission

The system SHALL provide `issue.setProject`, which sets or clears an issue's `project_id` and SHALL run the issue's team-scoped write gate (auth-before-existence, `canWrite`, member of the issue's team or workspace admin). The referenced project SHALL be required only to exist in the workspace; no cross-team rejection SHALL apply because a project spans teams.

Work-graph placement: the issue↔project edge, written under the issue's permission. Permission story: identical to every other issue write.

#### Scenario: A writer assigns their team's issue to a project

- **WHEN** a writer on the issue's team moves the issue to a project
- **THEN** the issue's `project_id` is set

#### Scenario: An issue from any team may join any project

- **WHEN** a writer assigns an issue to a project that also holds another team's issues
- **THEN** the assignment succeeds (no cross-team rejection)

#### Scenario: A viewer cannot assign an issue to a project

- **WHEN** a viewer attempts to set an issue's project
- **THEN** the mutation is rejected before any write

### Requirement: Project progress is computed from Done issues

The system SHALL compute a project's progress as the share of its (readable) issues at status Done, never storing it. Canceled issues SHALL count toward the total but not toward Done. The derivation SHALL be total over an empty project — it SHALL never yield NaN — but no surface SHALL state that share as a **percent**: the reading a surface draws is `done/total` beside a meter filled to the share, and a project with no readable issues draws no reading at all.

Work-graph placement: a derived view over the project's related issues. Permission story: computed over exactly the team-scoped issues the caller can read.

#### Scenario: Progress reflects Done share

- **WHEN** a project has four readable issues, two of them Done
- **THEN** its progress derives as two of four, and a surface drawing it states `2/4` with a meter filled to that share and no percent

#### Scenario: An empty project yields no reading

- **WHEN** a project has no readable issues
- **THEN** the derivation returns a total of zero rather than NaN, and the surface draws nothing where the meter and count would be

### Requirement: A roadmap timeline places projects by target date

The system SHALL provide a Roadmap view that lays projects out on a time axis by target date without
a Gantt/chart dependency, built from the design system. Dated projects SHALL be positioned on the
axis in target-date order; projects without a target date SHALL be held aside under one group header
rather than carrying a repeated per-row ornament, and SHALL still draw where their work is
scheduled. The view SHALL be keyboard-navigable (move focus between projects, open the focused
project) and correct in all three presets in light and dark, using only theme tokens.

**No project SHALL be drawn as a bar, a span, or any mark carrying a left edge**, because a project
stores no start date and a drawn left edge would assert a commitment the product never captured.
The surface SHALL state that refusal in its own words. If a future change derives a left edge from
a stored fact, the surface SHALL name the fact it derived it from.

The axis SHALL carry a real time ruler: month boundaries, the cycle boundaries drawn from the
team's stored cycle start and end dates, and a mark for today. Where the team has created no cycles
covering part of the axis, the surface SHALL state that as a fact rather than drawing ruled columns
implying planning nobody has done.

Each row SHALL draw, from stored columns only: the project's status as the shared cycle-position
glyph, its lead, a meter of its readable issues filled for those at done with the same reading
stated as `done/total`, its target date as one mark on the axis, and each of its readable issues
that is assigned to a cycle as a mark positioned by that cycle's own stored dates. A project whose
target has passed and whose status is not `completed` SHALL say so beside its mark, in text. No row
SHALL state a percent, because a percent over a project with no issues reads as zero and is a lie
about a project nobody has broken down yet.

Each row SHALL announce **one** label stating the marks its axis actually drew. The drawing itself
SHALL NOT carry a second label: a row is one control, and a control's children are presentational,
so a label nested inside it is announced to nobody. A row that draws no mark SHALL claim no schedule
in that label rather than inventing one.

Work-graph placement: a temporal view over workspace projects, their team-scoped issues, and those
issues' cycles. Permission story: reads via the same `isMember` project query with the unchanged
`teamScoped` predicate on its related issues.

#### Scenario: Dated projects appear on the axis in date order

- **WHEN** the roadmap renders projects with target dates
- **THEN** each is positioned by its target date and an earlier target sits left of a later one

#### Scenario: Nothing draws a bar

- **WHEN** the roadmap renders any project, dated or undated, finished or not started
- **THEN** no mark spans two dates, and the surface states that only a target is stored so nothing draws a bar

#### Scenario: The axis carries real cycle boundaries

- **WHEN** the team has cycles with stored start and end dates overlapping the axis window
- **THEN** each is drawn as its own band at its real dates, and the stretch of axis beyond the last stored cycle states that no cycles exist there instead of drawing ruled columns

#### Scenario: An issue's mark sits in the cycle it was actually placed in

- **WHEN** a project's readable issue is assigned to a cycle
- **THEN** a mark is drawn at that cycle's own stored dates, and an issue with no cycle draws no mark

#### Scenario: Unscheduled work reads differently from no work

- **WHEN** one project has readable issues none of which are in a cycle, and another has no readable issues at all
- **THEN** the first states that nothing of its is scheduled and still shows its `done/total`, and the second states that it has no issues yet and draws no meter

#### Scenario: Undated projects are held aside

- **WHEN** a project has no target date
- **THEN** it is listed under one "no target date" group header, off the axis, with its issue marks still drawn where its work is scheduled

#### Scenario: A passed target is stated in words

- **WHEN** a project's target date is earlier than today and its status is not completed
- **THEN** the row states that beside its target mark as text, and a completed project past its target states nothing

#### Scenario: The roadmap is keyboard-navigable

- **WHEN** a user moves focus with the keyboard and presses Enter on a project
- **THEN** focus moves between project rows and Enter opens the focused project's page

#### Scenario: The row announces what its axis drew

- **WHEN** a screen reader reaches a project row whose axis drew a target mark and two issue marks
- **THEN** the row announces one label naming the target, how it stands against today, the done-over-total, and where the issue marks sit; the drawing inside it carries no second label; and a row with no issues claims no schedule at all

### Requirement: Projects group and filter the issue list; the palette assigns

The system SHALL let the issue list group by project and filter by project (including a "No project" bucket) as a web-only axis, and SHALL offer a writer-gated command-palette action to move the targeted issue(s) to a project or clear it.

Work-graph placement: a list axis over `issue.project_id` and a palette action invoking `issue.setProject`. Permission story: the action is hidden and rejected for viewers.

#### Scenario: Group the list by project

- **WHEN** a user groups the issue list by project
- **THEN** issues are bucketed by their project with a "No project" bucket for the unassigned

#### Scenario: Move an issue to a project from the palette

- **WHEN** a writer selects "Move to project" on a focused issue and picks a project
- **THEN** the issue's `project_id` is set optimistically and syncs

### Requirement: The projects index is a progress reading grouped by status

The system SHALL render the workspace's projects as one list grouped by project status, with a group
header per status carrying that status's own mark, its label and its count. Within a group, projects
SHALL sort by target date, and a project with no target date SHALL sort last inside its group. A
status group with no projects SHALL NOT be drawn — a group header is a container for rows, not a
legend for the enum.

Each row SHALL state, in one line: the project's status as the shared cycle-position glyph, its
name, its phrase slot, the teams its readable issues come from with a count each, a progress meter,
`done/total`, its lead, and its target date. The progress meter SHALL be inked from the done status
token and SHALL NOT be inked with the brand accent, because the accent is never a status. No row
SHALL state a percent.

The surface SHALL carry no explanatory sentence. Its loading and empty states SHALL be labels.

#### Scenario: Projects group by status with counted headers

- **WHEN** a workspace holds projects in more than one status
- **THEN** each status present is drawn as one group header carrying that status's mark, its label and the number of projects in it, and a status with no projects has no header

#### Scenario: A dated project sorts before an undated one in its own group

- **WHEN** two projects share a status and one has a target date and the other does not
- **THEN** the dated project is drawn above the undated one, and two dated projects order by their target dates

#### Scenario: Progress is a Done share, drawn in the done token

- **WHEN** a project's readable issues are eleven of thirteen done
- **THEN** the row draws a meter filled to that share in the done status token and states `11/13`, and no percent and no accent-inked bar is drawn

### Requirement: A quiet project row draws no ink in the slot it reserves

A project with **no readable issues** SHALL reserve the team, meter and count slots at their full
measure and draw nothing in any of them — no zero, no empty meter track, no team name. A project
with **no target date** SHALL reserve the target slot and draw nothing in it. A project with **no
lead** SHALL reserve the lead slot and draw nothing in it. Nothing on the surface SHALL shift when a
fact later arrives.

A project that has issues but none of them done SHALL be distinguishable from a project that has no
issues: the first states its count, the second states nothing.

#### Scenario: A project with no issues draws nothing where its counts would be

- **WHEN** a project has no readable issues
- **THEN** its team, meter and count slots reserve their measure and draw no ink, and no `0` or `0%` is rendered

#### Scenario: Two kinds of nothing read differently

- **WHEN** one project has six readable issues and none of them done, and another has no issues at all
- **THEN** the first states `0/6` with an unfilled meter and the second states nothing at all

#### Scenario: An undated project reserves its target slot

- **WHEN** a project has no target date
- **THEN** its target slot reserves the same measure a dated project's does and draws no ink, and no "no target date" ornament is repeated on the row

### Requirement: A project past its target says so, and does not join the attention count

The system SHALL state, on a project whose `target_date` is earlier than today **and** whose status
is not `completed`, that the target has passed, together with the number of its readable issues not
yet done. The statement SHALL be real text in the urgent register, never a colour alone. A project
whose status is `completed` SHALL NOT carry it, whatever its target date. A project with **no
readable issues** SHALL state the passed target alone and SHALL NOT draw the count as a zero: the
row draws no zero anywhere, and `0 open` would assert that nothing is open over work the reader may
not be able to see.

This fact SHALL NOT be added to the product's one attention number, which counts exactly its four
exception classes; no count of past-target projects SHALL appear anywhere.

The derivation SHALL be reachable through the surface's `how ·` affordance, which SHALL state that
the target is a single stored field and that nothing records whether it was re-agreed.

#### Scenario: An overdue active project states the fact and the remainder

- **WHEN** an active project's target date has passed and two of its readable issues are not done
- **THEN** the row states that the target has passed together with `2 open`, as text, in the urgent ink

#### Scenario: A project past its target with nothing to count states the target alone

- **WHEN** an active project's target date has passed and it has no readable issues
- **THEN** the row states that the target has passed and renders no `0` anywhere

#### Scenario: A completed project past its date says nothing

- **WHEN** a completed project's target date has passed
- **THEN** no past-target statement is drawn on it

#### Scenario: The attention number is unchanged

- **WHEN** a workspace holds a project past its target
- **THEN** the deck badge and the statusline state the same attention number they would have stated without it, and no second count appears

### Requirement: A project has a page of its own, opening on two vitals

The system SHALL render a single project as a full surface rather than a detail pane beside a rail
of every project. The surface SHALL be reachable by URL, SHALL carry a keyboard-operable route back
to the index, and SHALL open on exactly two vitals:

- an **issues reading**: the count done over the total of its readable issues, and a state bar
  segmented by the statuses those issues are actually in, labelled in text as well as drawn;
- a **target reading**: the target date, how far past it today is when it has passed, and a strip
  showing the project's creation moment, its target and today.

On that strip the creation moment SHALL be labelled as the project's creation, never as a start.
Neither vital SHALL draw a bar spanning a start and an end, because no start date is stored.

The project's issues SHALL be listed grouped by status and drawn in the product's shared row
anatomy, including the phrase slot and the reality track with its reserved-but-inkless state. A
project with no readable issues SHALL say so in a label. The page SHALL reserve no room for a
description, because the project entity has none.

#### Scenario: The project page opens on its two vitals

- **WHEN** a member opens one project
- **THEN** the page states the done-over-total reading with its segmented state bar and the target reading, and lists that project's issues grouped by status

#### Scenario: The creation moment is labelled as creation

- **WHEN** the target strip draws the project's creation moment
- **THEN** it is labelled as when the project was created, and nothing on the page describes it as when work started

#### Scenario: A project's issues speak the shared row vocabulary

- **WHEN** the page lists an issue with a linked change and an issue with none
- **THEN** the first draws the reality track and its phrase, and the second reserves the same measure and draws no ink

#### Scenario: A project with no issues says so once

- **WHEN** a project has no readable issues
- **THEN** the page states that in a label and draws no empty chart, no empty list frame and no reserved description panel

### Requirement: Both project surfaces state that a project is workspace-scoped

The system SHALL make the scope difference legible on the index and on a project's page: a project
is workspace-scoped while the deck above it is team-scoped, and one project may hold issues from
several teams. Each surface SHALL carry a workspace-marked scope indicator in its masthead and a
statement, once per surface, that its counts are taken over the issues in the reader's own teams.

A surface SHALL NOT name, count, or imply the existence of issues in teams the reader does not
belong to, because those rows never sync and the client cannot prove they exist.

#### Scenario: The masthead states the workspace scope

- **WHEN** a member opens the projects index or one project's page
- **THEN** the masthead carries a workspace-marked scope indicator distinct from the team named in the deck

#### Scenario: A cross-team project names only the teams whose issues arrived

- **WHEN** a member of team A but not team B opens a project holding issues from both
- **THEN** only team A is named, with its count, and no statement is made about team B's issues
