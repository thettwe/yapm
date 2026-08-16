## MODIFIED Requirements

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

A row SHALL draw a note beside its mark only where the note is **news about the project** rather
than a reading of the drawing. A project with no readable issues, and a project whose issues sit in
no cycle at all, SHALL each say so in text: both are facts about work nobody has planned, and the
two SHALL read differently from one another. A project whose issues **are** scheduled, in cycles the
drawn window does not cover, SHALL draw no note — the empty stretch of axis beside a populated meter
already says it, and a note that fires for every project whose cycles fall outside the window states
nothing that distinguishes one row from the next. That fact SHALL instead be carried by the row's
own accessible name.

Each row SHALL announce **one** label stating the marks its axis actually drew. The drawing itself
SHALL NOT carry a second label: a row is one control, and a control's children are presentational,
so a label nested inside it is announced to nobody. A row that draws no mark SHALL claim no schedule
in that label rather than inventing one, and SHALL NOT claim the **absence** of one either: a row
whose issues are scheduled outside the drawn window SHALL say so in that label, and SHALL NOT be
announced as having no issues in any cycle.

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

#### Scenario: Work scheduled off the axis draws no note

- **WHEN** a project's readable issues are all assigned to cycles that fall outside the drawn window
- **THEN** the row draws its meter and its target mark and no note beside them, and the presence of a note on any row therefore means work nobody has scheduled

#### Scenario: The label does not deny a schedule the project has

- **WHEN** a screen reader reaches a row whose issues are scheduled in cycles outside the drawn window
- **THEN** the row's one label says its work is scheduled beyond the window, and does not announce that none of its issues is in a cycle

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
anatomy, including the phrase slot and the reality track with its reserved-but-inkless state. Those
rows SHALL speak the **same register the issue list speaks**, so one issue cannot say more here than
it says there: an exception draws its phrase, a classification the track already draws goes quiet
with its words carried by the track's accessible name, and the phrase slot keeps its reserved
measure either way. A project with no readable issues SHALL say so in a label. The page SHALL
reserve no room for a description, because the project entity has none.

#### Scenario: The project page opens on its two vitals

- **WHEN** a member opens one project
- **THEN** the page states the done-over-total reading with its segmented state bar and the target reading, and lists that project's issues grouped by status

#### Scenario: The creation moment is labelled as creation

- **WHEN** the target strip draws the project's creation moment
- **THEN** it is labelled as when the project was created, and nothing on the page describes it as when work started

#### Scenario: A project's issues speak the shared row vocabulary

- **WHEN** the page lists an issue whose checks are failing and an issue with no linked change
- **THEN** the first draws the reality track and its phrase, and the second reserves the same measure and draws no ink

#### Scenario: One issue says the same thing here as on the list

- **WHEN** an issue whose pull request is approved and unmerged is drawn on this page and on the team's issue list
- **THEN** neither surface draws a phrase for it, both draw the same track, and both carry the register's words for that key in the track's accessible name

#### Scenario: A project with no issues says so once

- **WHEN** a project has no readable issues
- **THEN** the page states that in a label and draws no empty chart, no empty list frame and no reserved description panel
