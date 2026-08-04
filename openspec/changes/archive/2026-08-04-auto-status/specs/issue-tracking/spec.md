## ADDED Requirements

### Requirement: Issue records when a human last set its status

The `issue` entity SHALL carry a nullable `last_human_status_at` timestamp recording when a **person**
last wrote its status. Every shared mutator that writes `issue.status` — creating an issue, setting
its status, moving it on the board, and routing it out of triage — SHALL stamp this column from the
mutator's own `updatedAt` argument, **except** when the invoking `AuthContext` is the system
principal, in which case the column SHALL be left untouched. The stamp SHALL be a pure function of
the arguments and the context so that it is identical on the optimistic client pass and the
authoritative server pass and survives rebase. The column SHALL record a timestamp only — never a
user id, a name, or a count — so it constitutes no per-person record. Existing issues SHALL be
backfilled from `updated_at` when the column is introduced, so no pre-existing issue is treated as
never having been touched by a human.

Work-graph placement: a scalar attribute of `issue`, the tracking root; no new entity and no new
edge. Sync/permission story: it replicates under the issue's existing team scope and is written only
by the same shared mutators that write the status itself, so it inherits their authorization exactly.

#### Scenario: A human status change stamps the column

- **WHEN** a member changes an issue's status, moves it between board columns, or routes it out of
  triage with a status
- **THEN** `last_human_status_at` is set to that mutation's timestamp

#### Scenario: A system-principal status change does not stamp the column

- **WHEN** the status is written under the system principal
- **THEN** `last_human_status_at` is unchanged, which is the record that the last status change was
  not a person's

#### Scenario: Every status-writing mutator is covered

- **WHEN** the shared mutator set is inspected for mutators that write `issue.status`
- **THEN** each one stamps `last_human_status_at` for a human context and leaves it untouched for the
  system principal, with no status-writing mutator omitted

#### Scenario: The column carries no identity

- **WHEN** the issue schema is inspected
- **THEN** the column holds a timestamp only, with no user reference, so no per-person record exists

## MODIFIED Requirements

### Requirement: Reality-strip and divergence computation seam

The system SHALL model the issue-row's delivery signal (reality strip) and divergence flag as pure derived values computed in `packages/schema`, not as stored columns on `issue`. A `computeDeliverySignal(issue, linkedEntities)` function SHALL return a typed delivery signal or null, and a `computeDivergence(status, signal)` function SHALL return a typed divergence marker or null. With the `connectors` change, real linked git entities (pull requests, checks, reviews, deployments) now exist, so `linkedEntities` is populated from an issue's linked delivery entities and `computeDeliverySignal` returns a **non-null** signal (PR state, CI health, review age) for a linked issue, while an unlinked issue still yields null and the quiet "not linked" state. `computeDivergence` SHALL return a marker when the human-set status disagrees with git reality (e.g. In Progress but PR merged; Done but CI failing). No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality SHALL remain modeled as linked entities so that the seam's exported signatures stay unchanged and only their inputs become non-empty.

Divergence SHALL remain the system's response wherever opt-in status automation does not act — that is, for every team with automation off, and for every event a guard blocks. Where a transition does fire, the divergence marker SHALL become null **by construction**, because status and git then agree; the seam SHALL NOT be suppressed, weakened, or special-cased for automated writes, and no new `DivergenceKind` SHALL be introduced. Both exported functions SHALL keep the signatures and the returned union that issue-core defined.

Work-graph placement: the seam is a computation over `issue` and its linked work-graph entities (defined in the work-graph capability). Permission story: the computation runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

#### Scenario: Reality strip renders a linked issue's real state

- **WHEN** an issue linked to a pull request and its checks is rendered in the list or detail
- **THEN** `computeDeliverySignal` returns a non-null signal and the reality-strip slot shows PR state, CI health, and review age

#### Scenario: Reality strip renders the unlinked state

- **WHEN** an issue with no linked git entities is rendered in the list or detail
- **THEN** `computeDeliverySignal` returns null and the reality-strip slot shows the quiet "not linked" placeholder

#### Scenario: Divergence flag fires when status disagrees with git

- **WHEN** an issue is marked In Progress while its linked PR is merged, or Done while its CI is failing
- **THEN** `computeDivergence` returns the corresponding marker and the divergence flag is shown

#### Scenario: Divergence flag is dormant without delivery state

- **WHEN** an issue with no linked git entities is evaluated for divergence
- **THEN** `computeDivergence` returns null and no divergence flag is shown, regardless of the human-set status

#### Scenario: No git columns on the issue

- **WHEN** the issue schema is inspected
- **THEN** it carries no PR/CI/deploy columns, and the delivery signal is available only through the computation seam over linked entities

#### Scenario: Divergence is unchanged for a team with automation off

- **WHEN** a team has status automation off and one of its issues is In Progress with a merged linked pull request
- **THEN** `computeDivergence` returns the same marker it returned before status automation existed

#### Scenario: A fired transition leaves no divergence to report

- **WHEN** status automation moves an issue to Done on a merge
- **THEN** `computeDivergence` returns null because the status and the pull request agree, with no suppression logic involved

#### Scenario: The divergence union does not grow

- **WHEN** the seam is inspected
- **THEN** `computeDeliverySignal` and `computeDivergence` keep their signatures and `DivergenceKind` holds exactly the markers it held before

### Requirement: Issue mutations via shared mutators

All issue, label, comment, and saved-view writes SHALL flow through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative). The mutator set SHALL cover creating and updating issues, changing status, setting priority, assigning/unassigning, adding/removing labels, creating/editing/deleting comments, and managing labels and saved views. Every mutator SHALL enforce team-scoped role authorization from the verified `ctx` before any existence check, set owner/creator/author fields from `ctx` (never args), and mint any created row's UUIDv7 at the call site. Assignee changes SHALL validate that the assignee is a member of the issue's team.

Any feature that creates an issue on a user's behalf — including converting a retrospective action item — SHALL do so by calling the **same shared issue-creation mutator**, inheriting its authorization, its `ctx`-derived creator, its triage and status defaults, and its server-authoritative per-team numbering. A parallel insert into the issue table SHALL NOT exist.

Any feature that changes an issue's status on the system's own behalf — including a connector-driven status transition — SHALL likewise do so by calling the **same shared status mutator**, under an explicit `AuthContext`, so the team-scoped authorization runs unchanged. A parallel update path into `issue.status` SHALL NOT exist, and a non-human write SHALL be distinguished from a human one by the `AuthContext` it carries, never by a separate mutator.

Work-graph placement: these mutators are the sole write path into the team-scoped work-graph entities. Permission story: viewers and non-members are rejected for every write; author/creator-scoped operations additionally require ownership-or-admin; a system principal is an `AuthContext` like any other and is subject to the same checks.

#### Scenario: Status change applies optimistically then persists

- **WHEN** a member changes an issue's status
- **THEN** the UI updates immediately and the change persists in Postgres via the server mutator, rolling back to the authoritative value if the server rejects it

#### Scenario: Assigning to a non-team-member is rejected

- **WHEN** a caller attempts to assign an issue to a user who is not a member of the issue's team
- **THEN** the mutator rejects it as invalid

#### Scenario: Unauthorized write reveals nothing

- **WHEN** a viewer or non-member attempts any issue, label, comment, or saved-view write
- **THEN** the mutator rejects it as not authorized without revealing whether the target row exists

#### Scenario: A derived creation path reuses the shared create mutator

- **WHEN** a retrospective action item is converted into an issue
- **THEN** the issue is created through the shared issue-creation mutator and is indistinguishable from a hand-created issue — same authorization, same defaults, and a server-assigned per-team number

#### Scenario: A derived status path reuses the shared status mutator

- **WHEN** a connector-driven transition changes an issue's status
- **THEN** it invokes the shared status mutator with a system `AuthContext`, that mutator's authorization runs, and no direct table or SQL write to `issue.status` exists anywhere
