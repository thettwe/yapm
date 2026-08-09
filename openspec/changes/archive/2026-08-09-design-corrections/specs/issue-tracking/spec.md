## MODIFIED Requirements

### Requirement: Reality-track and divergence computation seam

The system SHALL model the issue-row's delivery signal (the reality track) and its `//` divergence break as pure derived values computed in `packages/schema`, not as stored columns on `issue`. A `computeDeliverySignal(issue, linkedEntities)` function SHALL return a typed delivery signal or null, and a `computeDivergence(status, signal)` function SHALL return a typed divergence marker or null. With the `connectors` change, real linked git entities (pull requests, checks, reviews, deployments) now exist, so `linkedEntities` is populated from an issue's linked delivery entities and `computeDeliverySignal` returns a **non-null** signal (PR state, CI health, review age) for a linked issue, while an unlinked issue still yields null — and the dense-row surface then draws no track at all: the slot keeps its full reserved measure and lays down no ink, no station, no segment and no age text. The issue detail's vertical rail is the deliberate exception and keeps an explicit station saying the change is not linked. `computeDivergence` SHALL return a marker when the human-set status disagrees with git reality (e.g. In Progress but PR merged; Done but CI failing). No git-shaped columns (PR state, CI status) SHALL be added to `issue`; delivery reality SHALL remain modeled as linked entities so that the seam's exported signatures stay unchanged and only their inputs become non-empty.

The rendering rule is a property of the **facts** the seam produced, never of the shape a surface drew from them: a signal is fact-free only when every axis it carries is absent. A pull request that ended without merging, or a review age with no open pull request behind it, is a fact the seam produced, so its row is drawn and announced even though no station fills for it.

Divergence SHALL remain the system's response wherever opt-in status automation does not act — that is, for every team with automation off, and for every event a guard blocks. Where a transition does fire, the divergence marker SHALL become null **by construction**, because status and git then agree; the seam SHALL NOT be suppressed, weakened, or special-cased for automated writes, and no new `DivergenceKind` SHALL be introduced. Both exported functions SHALL keep the signatures and the returned union that issue-core defined.

Work-graph placement: the seam is a computation over `issue` and its linked work-graph entities (defined in the work-graph capability). Permission story: the computation runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

#### Scenario: The reality track renders a linked issue's real state

- **WHEN** an issue linked to a pull request and its checks is rendered in the list or detail
- **THEN** `computeDeliverySignal` returns a non-null signal and the reality-track slot shows PR state, CI health, and review age

#### Scenario: The reality track renders the unlinked state

- **WHEN** an issue with no linked git entities is rendered in a dense row
- **THEN** `computeDeliverySignal` returns null and the reality-track slot is reserved and inkless — no station, no segment, no age text, and no accessible label — while the issue detail's vertical rail keeps its explicit "no change linked yet" station

#### Scenario: A signal with a fact no station draws is still drawn

- **WHEN** an issue's linked pull request was closed without merging, and no check has run
- **THEN** the row draws its track and announces the facts it holds, because fact-freeness is decided from the signal's axes rather than from the stations the drawing happened to fill

#### Scenario: The divergence break fires when status disagrees with git

- **WHEN** an issue is marked In Progress while its linked PR is merged, or Done while its CI is failing
- **THEN** `computeDivergence` returns the corresponding marker and the `//` divergence break is drawn on the track

#### Scenario: The divergence break is dormant without delivery state

- **WHEN** an issue with no linked git entities is evaluated for divergence
- **THEN** `computeDivergence` returns null and the track carries no `//` break, regardless of the human-set status

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
