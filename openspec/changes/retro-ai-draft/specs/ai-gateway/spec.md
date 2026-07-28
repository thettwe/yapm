## MODIFIED Requirements

### Requirement: Volatile model resolution and spend surfacing

The system SHALL treat model IDs and prices as runtime configuration, never hardcoded constants: the admin selects a model per provider (validated against the provider's live model list where available), and a small, updatable server-side model+price table SHALL drive spend estimation. Every run SHALL surface an estimated per-run cost (usage × price, labeled "estimated") and accumulate a per-workspace running total; an optional spend cap SHALL refuse to start a run that would exceed it. A new workspace SHALL default to a cheap/fast model.

**The running total SHALL span every AI artifact table in the workspace, not one consumer's.** A single accessor SHALL sum the estimated cost of every completed artifact across all AI consumers, so that adding a consumer cannot make the cap under-fire; there SHALL be exactly one such accessor, and a second spend query SHALL be treated as a defect.

Work-graph placement: off-graph cost accounting for AI runs. Permission story: cost totals are workspace-scoped; the price table is server-side and operator-updatable.

#### Scenario: Cost is estimated and labeled

- **WHEN** an AI run completes
- **THEN** its estimated cost is computed from normalized token usage × the server-side price table, displayed labeled "estimated," and added to the workspace running total

#### Scenario: Spend cap refuses a run

- **WHEN** a workspace has a spend cap and the running total is at or above it
- **THEN** a new run is refused before it starts and the consumer takes its AI-off path

#### Scenario: Model IDs are never hardcoded

- **WHEN** provider model offerings change
- **THEN** the configured model and its price are read from runtime config and the updatable table, with no code change required to name a model

#### Scenario: A second consumer's spend counts against the same cap

- **WHEN** a workspace produces a completed artifact from an AI consumer other than the cycle digest
- **THEN** the running total rises by that artifact's estimated cost, and a cap set below the combined total refuses the next run of either consumer
