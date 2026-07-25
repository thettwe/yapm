## MODIFIED Requirements

### Requirement: Reality-strip and divergence computation seam

The system SHALL model the issue-row's delivery signal (reality strip) and divergence flag as pure derived values computed in `packages/schema`, not as stored columns on `issue`. A `computeDeliverySignal(issue, linkedEntities)` function SHALL return a typed delivery signal or null, and a `computeDivergence(status, signal)` function SHALL return a typed divergence marker or null. With the `connectors` change, real linked git entities (pull requests, checks, reviews, deployments) now exist, so `linkedEntities` is populated from an issue's linked delivery entities and `computeDeliverySignal` returns a **non-null** signal (PR state, CI health, review age) for a linked issue, while an unlinked issue still yields null and the quiet "not linked" state. `computeDivergence` SHALL return a marker when the human-set status disagrees with git reality (e.g. In Progress but PR merged; Done but CI failing). No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality SHALL remain modeled as linked entities so that the seam's exported signatures stay unchanged and only their inputs become non-empty.

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

#### Scenario: No git columns on the issue

- **WHEN** the issue schema is inspected
- **THEN** it carries no PR/CI/deploy columns, and the delivery signal is available only through the computation seam over linked entities
