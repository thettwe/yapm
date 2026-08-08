## MODIFIED Requirements

### Requirement: Linked entities feed the delivery-signal and divergence seam

The system SHALL assemble a `LinkedEntities` value for an issue from its linked pull requests and their checks and reviews, **and from the team's deployments**, and pass it to the existing `computeDeliverySignal(issue, linkedEntities)` and `computeDivergence(status, signal)` functions — whose exported **function signatures** SHALL NOT change — so a linked issue now yields a **non-null** delivery signal (PR state, CI health, review age, **and whether the change reached production and when**) and, where the human status disagrees with git reality, a divergence marker. An issue with no links SHALL still yield a null signal, and the surface SHALL then render the unlinked state defined by the reality-vocabulary capability: a dense row reserves its full measure and draws nothing, while the issue detail's vertical rail keeps its explicit station. No git-shaped columns (PR state, CI status, deployment state) SHALL be added to `issue`; delivery reality SHALL remain modeled only as these linked entities behind the seam.

The delivery signal SHALL carry a deployment axis: the instant the issue's change first reached production, or null when it has not. That instant SHALL be determined by an **exact commit match** — a deployment whose stored commit equals the linked pull request's merge commit within the same repository, and which carries a recorded first-success instant. Where several such deployments exist the **earliest** first-success instant SHALL be used. The system SHALL NOT infer a deployment from timing, ordering or environment alone, so the signal can never assert that a change reached production when no deployment carrying that commit succeeded. A team with no connector, or a linked issue whose merge commit no deployment carries, SHALL yield a null deployment axis and every other axis unchanged.

`computeDivergence` SHALL NOT gain a deployment-derived divergence kind in this change: "merged and not deployed for long enough to be wrong" carries a threshold that is a product decision, and the `//` divergence break SHALL keep the three kinds it has.

Work-graph placement: a computation over `issue`, its linked delivery entities and the team's deployments; it adds no new synced entity and no new synced query beyond those already defined. Permission story: the assembly runs over already-permitted, team-scoped synced rows and adds no new visibility surface.

#### Scenario: A linked issue shows real delivery state

- **WHEN** an issue is linked to an open, approved PR with passing checks
- **THEN** `computeDeliverySignal` returns a non-null signal and the reality track shows PR state, CI health, and review age

#### Scenario: Divergence fires when status disagrees with git

- **WHEN** an issue is marked In Progress but its linked PR is merged
- **THEN** `computeDivergence` returns a divergence marker and the row's track carries the `//` divergence break

#### Scenario: An unlinked issue yields no signal and draws nothing

- **WHEN** an issue has no linked PRs
- **THEN** `computeDeliverySignal` returns null and the row's reality slot is reserved and inkless, as the reality-vocabulary capability defines it

#### Scenario: The seam signatures are unchanged

- **WHEN** the delivery seam is inspected
- **THEN** `computeDeliverySignal` and `computeDivergence` keep the signatures issue-core defined, the signal value gaining a deployment axis and the linked-entities input gaining an optional deployment list

#### Scenario: A merged change that reached production carries a deployment instant

- **WHEN** an issue's linked PR is merged and a deployment in the same repository carries that merge commit with a recorded first-success instant
- **THEN** the delivery signal's deployment axis is that instant

#### Scenario: A merged change no deployment carried is not called deployed

- **WHEN** an issue's linked PR is merged and every deployment in that repository carries some other commit
- **THEN** the delivery signal's deployment axis is null, and no timing or environment coincidence makes it non-null
