## MODIFIED Requirements

### Requirement: Linked delivery entities

The system SHALL model the work graph's delivery entities as first-class, team-scoped, synced tables: `pull_request` (external id, repository, number, a `state` of draft / open / approved / changes_requested / merged / closed, head SHA, **the merge commit SHA a merge produced**, url, timestamps), `ci_check` (belonging to a pull request, a `conclusion`, head SHA), `review` (belonging to a pull request, a `state`, submitted-at), and `deployment` (repository, ref, environment, a `state`, **the commit SHA the deployment carried, and the instant it first reached a terminal success**). Each row SHALL carry a `team_id` derived from the connector's repo→team mapping so it inherits the existing team-scoped visibility; a delivery for an unmapped repository SHALL NOT be written. These entities SHALL be written only through the connector's shared-mutator write path, never by clients directly.

The deployment commit and the merge commit SHALL both be preserved from the provider payload wherever the provider supplies them, because they are the only exact join between a merged change and the deployment that carried it. A payload that omits either SHALL leave the stored value unknown rather than substituting a related commit.

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

#### Scenario: The deployed commit is stored, not discarded

- **WHEN** a deployment delivery carrying a commit SHA is ingested
- **THEN** the stored `deployment` row carries that SHA, so a merged change can be joined to the deployment that shipped it

#### Scenario: A merged pull request stores its merge commit

- **WHEN** a `pull_request` delivery reports the PR merged and supplies the merge commit SHA
- **THEN** the stored `pull_request` row carries that merge commit SHA alongside its head SHA

### Requirement: Linked entities feed the delivery-signal and divergence seam

The system SHALL assemble a `LinkedEntities` value for an issue from its linked pull requests and their checks and reviews, **and from the team's deployments**, and pass it to the existing `computeDeliverySignal(issue, linkedEntities)` and `computeDivergence(status, signal)` functions — whose exported **function signatures** SHALL NOT change — so a linked issue now yields a **non-null** delivery signal (PR state, CI health, review age, **and whether the change reached production and when**) and, where the human status disagrees with git reality, a divergence marker. An issue with no links SHALL still yield a null signal and render the unlinked state. No git-shaped columns (PR state, CI status, deployment state) SHALL be added to `issue`; delivery reality SHALL remain modeled only as these linked entities behind the seam.

The delivery signal SHALL carry a deployment axis: the instant the issue's change first reached production, or null when it has not. That instant SHALL be determined by an **exact commit match** — a deployment whose stored commit equals the linked pull request's merge commit within the same repository, and which carries a recorded first-success instant. Where several such deployments exist the **earliest** first-success instant SHALL be used. The system SHALL NOT infer a deployment from timing, ordering or environment alone, so the signal can never assert that a change reached production when no deployment carrying that commit succeeded. A team with no connector, or a linked issue whose merge commit no deployment carries, SHALL yield a null deployment axis and every other axis exactly as before.

`computeDivergence` SHALL NOT gain a deployment-derived divergence kind in this change: "merged and not deployed for long enough to be wrong" carries a threshold that is a product decision, and the divergence flag SHALL keep the three kinds it has.

Work-graph placement: a computation over `issue`, its linked delivery entities and the team's deployments; it adds no new synced entity and no new synced query beyond those already defined. Permission story: the assembly runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

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

- **WHEN** the delivery seam is inspected
- **THEN** `computeDeliverySignal` and `computeDivergence` keep the signatures issue-core defined, the signal value gaining a deployment axis and the linked-entities input gaining an optional deployment list

#### Scenario: A merged change that reached production carries a deployment instant

- **WHEN** an issue's linked PR is merged and a deployment in the same repository carries that merge commit with a recorded first-success instant
- **THEN** the delivery signal's deployment axis is that instant

#### Scenario: A merged change no deployment carried is not called deployed

- **WHEN** an issue's linked PR is merged and every deployment in that repository carries some other commit
- **THEN** the delivery signal's deployment axis is null, and no timing or environment coincidence makes it non-null

## ADDED Requirements

### Requirement: A deployment's first success is a durable, write-once fact

The system SHALL record, on each deployment, the instant it **first reached a terminal success**, and that instant SHALL be immutable once written. No later status event, no redelivered webhook, and no reconciliation sweep SHALL clear it, overwrite it, or move it in either direction. The deployment's `state` SHALL continue to be current state under last-writer-wins — a superseded deployment still becomes `inactive` — but that supersession SHALL NOT touch the recorded success.

Only a terminal **success** SHALL stamp the instant. A superseded (`inactive`) status SHALL NOT stamp one, because its timestamp is the moment of supersession rather than of success. A status event too old to move the deployment's current state SHALL nonetheless stamp the success instant if it carries one and none is recorded, so that a redelivered older success arriving after a newer status is not lost.

Because the instant is per deployment rather than per environment, counting deployments with a recorded success over a window SHALL return the number of times the team actually shipped, not the number of environments.

The system SHALL NOT fabricate the instant for a deployment ingested before it was recorded: an unrecorded success SHALL remain unknown rather than being inferred from any other stored timestamp.

Work-graph placement: an immutable column on the existing team-scoped `deployment` entity; no new table, no new synced query, no new permission predicate. Permission story: unchanged — the column replicates inside the same team boundary as the row that carries it, and only the connector's mutator path writes it.

#### Scenario: A superseded deployment keeps the moment it succeeded

- **WHEN** a deployment reaches `success` and a later deployment supersedes it, marking it `inactive`
- **THEN** its state becomes `inactive` while its recorded success instant is unchanged and still carries the original moment

#### Scenario: Three successive deploys to one environment count as three

- **WHEN** three deployments to the same environment each reach `success` in turn, each superseding the last
- **THEN** counting deployments with a recorded success returns three, not one

#### Scenario: Redelivering the same status event moves nothing

- **WHEN** the same deployment-status delivery is processed twice
- **THEN** the recorded success instant is identical after the second as after the first

#### Scenario: A reconciliation sweep cannot regress the fact

- **WHEN** the reconciliation sweep re-polls a deployment and observes only its newest status, which is no longer a success
- **THEN** the previously recorded success instant is left exactly as it was

#### Scenario: A stale success still records the fact

- **WHEN** a status event carrying a success arrives after a newer status has already been applied, and no success is recorded yet
- **THEN** the success instant is recorded while the deployment's current state and its other current-state fields are left to the newer event

#### Scenario: A superseded status never stamps the fact

- **WHEN** the first status a deployment is ever seen with is `inactive`
- **THEN** no success instant is recorded, because the moment of supersession is not the moment of success
