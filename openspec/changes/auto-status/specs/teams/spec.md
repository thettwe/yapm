## ADDED Requirements

### Requirement: Team carries its status-automation setting

The `team` entity SHALL carry a nullable `auto_status_since` timestamp expressing whether that team
has opted in to connector-driven issue-status automation and, if so, from when. `NULL` SHALL mean
off, which is the default for every team including newly created ones. A shared
`team.setAutoStatus` mutator SHALL be the only write path: it SHALL require the `admin` workspace
role (`canManage`), checked before the team row is loaded, and SHALL write the caller-supplied
instant when enabling and `NULL` when disabling. The instant SHALL be supplied by the mutator's
caller rather than generated inside the mutator body, so the value is identical on the optimistic and
authoritative passes. Setting the value SHALL NOT alter any issue.

Work-graph placement: a scalar configuration attribute of `team`, which hangs off the single
`workspace`; no new entity, no new edge, no per-team role. Sync/permission story: the column
replicates with the `team` row under the existing rule that any member reads all non-archived teams,
so every member can see whether their team's board moves on its own; an authenticated non-member
reads nothing, as before. Only an `admin` MAY write it; a `member` or `viewer` attempting to write is
rejected before any existence check.

#### Scenario: A new team defaults to automation off

- **WHEN** an admin creates a team
- **THEN** its `auto_status_since` is `NULL` and no connector event drives any of its issues' status

#### Scenario: Admin enables and disables automation

- **WHEN** an admin enables automation for a team and later disables it
- **THEN** the column holds the enabling instant and is then `NULL` again, and re-enabling records a
  fresh instant rather than the original one

#### Scenario: Non-admin cannot write the setting

- **WHEN** a `member` or `viewer` invokes `team.setAutoStatus`
- **THEN** the mutator rejects it as not authorized before any existence check

#### Scenario: Members can read the setting

- **WHEN** a member of the workspace syncs the team list
- **THEN** each team's automation state is present on the synced row, so the member can tell whether
  that team's issues move on their own

#### Scenario: Keyboard-only toggle

- **WHEN** an admin reaches a team's automation control with Tab and activates it with Enter or Space
- **THEN** the setting toggles with no pointer interaction
