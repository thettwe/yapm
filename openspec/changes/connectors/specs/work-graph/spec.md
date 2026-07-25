## ADDED Requirements

### Requirement: Linked delivery entities

The system SHALL model the work graph's delivery entities as first-class, team-scoped, synced tables: `pull_request` (external id, repository, number, a `state` of draft / open / approved / changes_requested / merged / closed, head SHA, url, timestamps), `ci_check` (belonging to a pull request, a `conclusion`, head SHA), `review` (belonging to a pull request, a `state`, submitted-at), and `deployment` (repository, ref, environment, a `state`). Each row SHALL carry a `team_id` derived from the connector's repo→team mapping so it inherits the existing team-scoped visibility; a delivery for an unmapped repository SHALL NOT be written. These entities SHALL be written only through the connector's shared-mutator write path, never by clients directly.

Work-graph placement: `pull_request` / `deployment` hang off `team`; `ci_check` and `review` hang off `pull_request`; together they realize the `issue ↔ PR ↔ CI run ↔ deploy` graph the vision names. Sync/permission story: each replicates only to members of its `team_id` under the `teamScoped` predicate, denied by empty query otherwise; viewers read them but never write; only the connector's authoritative mutator pass writes them.

#### Scenario: A PR and its checks are ingested for a mapped repo

- **WHEN** a `pull_request` and `check_suite` delivery for a repository mapped to a team is ingested
- **THEN** a `pull_request` row and its `ci_check` are created carrying that team's `team_id` and sync to that team's members

#### Scenario: An unmapped repository is ignored

- **WHEN** a delivery arrives for a repository with no repo→team mapping
- **THEN** no work-graph row is written, so no un-scoped row can ever exist

#### Scenario: A viewer reads but cannot write delivery entities

- **WHEN** a viewer on a team reads its PRs/checks/deploys and then attempts any direct write
- **THEN** the reads succeed and every direct client write is rejected

#### Scenario: Merged is distinguished from closed

- **WHEN** a `pull_request` `closed` delivery arrives with the PR merged versus not merged
- **THEN** the `pull_request` state is recorded as `merged` in the first case and `closed` in the second

### Requirement: Issue ↔ PR magic-word linking

The system SHALL link an issue to a pull request via an `issue_link` edge when a branch name or the PR body contains the issue's human key `<TEAM_KEY>-<NUMBER>` (e.g. `ENG-142`), matched case-insensitively on a word boundary and resolved against the mapped team's key and the issue number. A reference that resolves to no issue in the mapped team SHALL be ignored (no fabricated links). One pull request MAY link several issues and one issue MAY be linked by several pull requests. The link SHALL record which rule matched (branch or body). Reference parsing SHALL be a pure function testable independently of GitHub.

Work-graph placement: `issue_link` is the `issue ↔ pull_request` edge that lets a PR drive its issue's reality strip. Sync/permission story: the edge is team-scoped to the issue's/PR's team; it is written only by the connector mutator path; it never links across a team boundary.

#### Scenario: A branch name links the issue

- **WHEN** a PR's head branch is `feature/ENG-142-thing` and `ENG-142` exists in the mapped team
- **THEN** an `issue_link` is created between that issue and the PR, recording the branch source

#### Scenario: A PR body reference links the issue

- **WHEN** a PR body contains `Closes ENG-142` and that issue exists in the mapped team
- **THEN** an `issue_link` is created recording the body source

#### Scenario: An unknown key is ignored

- **WHEN** a branch or body names a key that resolves to no issue in the mapped team
- **THEN** no link is created and no placeholder issue is fabricated

### Requirement: Linked entities feed the delivery-signal and divergence seam

The system SHALL assemble a `LinkedEntities` value for an issue from its linked pull requests and their checks and reviews, and pass it to the existing `computeDeliverySignal(issue, linkedEntities)` and `computeDivergence(status, signal)` functions — whose exported signatures SHALL NOT change — so a linked issue now yields a **non-null** delivery signal (PR state, CI health, review age) and, where the human status disagrees with git reality, a divergence marker. An issue with no links SHALL still yield a null signal and render the unlinked state. No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality SHALL remain modeled only as these linked entities behind the seam.

Work-graph placement: a computation over `issue` and its linked delivery entities; it adds no new synced entity beyond those defined above. Permission story: the assembly runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

#### Scenario: A linked issue shows real delivery state

- **WHEN** an issue is linked to an open, approved PR with passing checks
- **THEN** `computeDeliverySignal` returns a non-null signal and the reality strip shows PR state, CI health, and review age

#### Scenario: Divergence fires when status disagrees with git

- **WHEN** an issue is marked In Progress but its linked PR is merged
- **THEN** `computeDivergence` returns a divergence marker and the row shows the divergence flag

#### Scenario: An unlinked issue is unchanged

- **WHEN** an issue has no linked PRs
- **THEN** `computeDeliverySignal` returns null and the row renders the quiet unlinked state exactly as before

#### Scenario: The seam signatures are unchanged

- **WHEN** the delivery seam is inspected after this change
- **THEN** `computeDeliverySignal` and `computeDivergence` keep the signatures issue-core defined, only their inputs (the linked entities) becoming non-empty
