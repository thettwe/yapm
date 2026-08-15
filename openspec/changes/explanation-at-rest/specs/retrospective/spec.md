## MODIFIED Requirements

### Requirement: The retros index is a destination drawn to the list register

The system SHALL provide a retros index at `/teams/$teamId/retros`, reached from the application frame's `more▾` menu and its `g r` shortcut, listing the team's retros. It SHALL state the page's name and a mono count and SHALL NOT repeat the team name.

Each row SHALL carry the drawn retro mark, the retro's title, its current phase, its format, and the date range of the cycle it reflects on, and SHALL be a single keyboard-reachable link into that retro. The row SHALL claim nothing that no stored row supports: no participant count, no card count, no per-person figure of any kind.

The index SHALL also list a team's completed cycles that have no retrospective, offering to open one, and SHALL render that group only when it has rows — never as an empty heading.

A team with no retros SHALL be met by a short honest statement that a retro opens when a cycle closes, together with the mono fact of when the next cycle closes where a cycle exists to state it, and nothing where none does. That statement is the surface's **empty state** and SHALL NOT render on an index that is already listing retros: a page with rows explains nothing about what a retro is, and the mono next-close fact belongs to the line it qualifies. Nor SHALL it render before the team's retros are known: until then the same place SHALL state that the page is loading, so that no-retros-seen-yet is never announced as no-retros. The index SHALL NOT offer to create a retro detached from a cycle.

Work-graph placement: a destination over the team's existing retros and cycles; no new entity and no new query. Permission story: unchanged — the retro rows are the team-scoped rows a member already syncs, and the open-a-retro control renders only for a writer.

#### Scenario: The index lists a team's retros

- **WHEN** a member opens the retros destination for a team with retros
- **THEN** each retro is one row stating its title, phase, format and its cycle's date range, and activating the row opens that retro

#### Scenario: A team that has never run a retro

- **WHEN** a member opens the retros destination for a team with no retro and no completed cycle
- **THEN** the page states that a retro opens when a cycle closes, offers no create control, and shows no empty group heading

#### Scenario: A populated index explains nothing

- **WHEN** a member opens the retros destination for a team that already has at least one retro
- **THEN** no statement of what a retro is and no next-close fact is drawn on the page, and the rows stand alone

#### Scenario: An index whose retros have not arrived says so

- **WHEN** a member opens the retros destination and the team's retros have not finished syncing
- **THEN** no statement of what a retro is and no next-close fact is drawn, and the page states that it is loading instead

#### Scenario: A completed cycle owed a retro is offered one

- **WHEN** a team has a completed cycle with no retrospective
- **THEN** that cycle is listed with a control to open a retrospective for it, and the control is absent for a viewer

#### Scenario: The index names no person

- **WHEN** any row of the index is rendered
- **THEN** it contains no participant, author, facilitator or per-person figure

#### Scenario: The index is keyboard-operable and correct in every theme

- **WHEN** a member moves through the index with the keyboard in Warm, Focused and Editorial, in light and dark
- **THEN** every row is focus-reachable with visible focus, and every colour resolves from a semantic token and meets AA contrast
