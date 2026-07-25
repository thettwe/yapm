## ADDED Requirements

### Requirement: Team-level cycle-facts query with no per-person dimension

The system SHALL provide a dedicated, narrowed `cycleFactsForTeam(teamId, cycleId)` read that emits **team-level aggregates only** for a completed cycle: counts (shipped / carried-over / added-mid-cycle), per-issue evidence bundles (the issue plus its linked PR titles/labels, check conclusions, and deploy state), CI conclusions, and review medians. This query SHALL NOT include any `assignee`, `author`, `reviewer`, or `user_id` dimension, so the identity data is never in the model's context. The consequential numbers SHALL be computed here by yapm, not by the model. It SHALL live in `packages/schema` and reuse yapm's existing team-level metric computations.

Work-graph placement: a read over the cycle's Done/carried issues and their linked PR/CI/deploy entities, narrowed to team-level aggregates. Permission story: team-scoped — it exposes only aggregates and evidence for entities the team can already see, and no per-individual row.

#### Scenario: The query carries no identity dimension

- **WHEN** `cycleFactsForTeam` is evaluated for a cycle
- **THEN** its result contains team-level counts and per-issue evidence bundles but no assignee/author/reviewer/user field

#### Scenario: Numbers are computed, not modeled

- **WHEN** the digest states "shipped 14 of 16, 3 carried"
- **THEN** those counts came from `cycleFactsForTeam`, and the model only narrated them

### Requirement: Team-scoped, client-read-only cycle-digest artifact

The system SHALL persist a cycle digest as a team-scoped, Zero-synced `cycle_digest` entity hanging off `cycle` (off `team`): `id`, `team_id`, `cycle_id`, a `status` of `pending | ready | failed | ai_off`, a typed `content` blob (sections + evidence-linked items), the `provider`/`model`, `generated_at`, token usage, and an estimated cost. The entity SHALL sync under the same team-scoped `whereExists` roster predicate as other work-data (a user reads it only for a team they belong to; deny-by-empty with no leak of existence; viewers read). It SHALL be **client-read-only**: no client Zero mutator creates or edits a digest — it is written only server-side by the pre-compute job over the authoritative write path — so a client can never forge a digest and the numbers-by-yapm guarantee holds.

Work-graph placement: a team-scoped leaf off `cycle`; its `content` references existing synced issue/PR/check/deploy entities as evidence, adding no per-person visibility surface. Permission story: membership-scoped read exactly like other work data; writes are server-only, never client-reachable.

#### Scenario: A team member reads their cycle's digest

- **WHEN** a member of the cycle's team opens the completed cycle
- **THEN** the synced `cycle_digest` for that cycle is available, and a non-member of that team sees nothing (no leak of existence)

#### Scenario: Clients cannot write a digest

- **WHEN** a client attempts to create or edit a `cycle_digest` row
- **THEN** there is no client mutator to do so and the write does not apply; only the server-side pre-compute job writes the row

#### Scenario: Viewer reads the digest

- **WHEN** a viewer on the cycle's team opens the cycle
- **THEN** the digest renders read-only, consistent with the viewer role

### Requirement: Pre-compute the digest at cycle close, off the hot path

The system SHALL pre-compute the cycle digest when a cycle closes, using the existing pg-boss cycle-maintenance path (which already completes ended cycles) to enqueue a digest job under the system principal — introducing no new container or service. The job SHALL run `cycleFactsForTeam` → the grounded structured-output substrate → the cite-evidence-or-omit and name-validator checks → write a `ready` `cycle_digest`; when AI is disabled, keyless, in outage, or spend-capped it SHALL instead write an `ai_off` status (or not run), and a run failure SHALL write a `failed` status. The job SHALL be bounded and rate-limited per workspace and SHALL never run on the interactive hot path, so opening a completed cycle is never blocked on a model call and the digest feels instant when present. The pre-compute SHALL be gated by an optional env toggle.

Work-graph placement: a batch producer of the `cycle_digest` artifact triggered by cycle completion. Permission story: runs under the system principal server-side; it reads team-scoped aggregates and writes the team-scoped artifact, never per-person data.

#### Scenario: Digest is ready when the cycle is opened

- **WHEN** a cycle completes with AI configured
- **THEN** the pre-compute job produces a `ready` digest off the hot path, so the completed cycle shows it immediately without an interactive model call

#### Scenario: AI-off writes the fallback status

- **WHEN** a cycle completes with AI disabled or unavailable
- **THEN** the digest is `ai_off` (or unscheduled) and the cycle view renders the raw-evidence fallback

#### Scenario: A failed run does not block the cycle

- **WHEN** a digest run fails
- **THEN** the row is marked `failed`, the cycle view falls back to raw evidence, and opening the cycle is never blocked

### Requirement: Cycle-view digest surface with evidence links and AI-off fallback

The cycle view SHALL render the digest for a completed cycle: the typed sections and items, each item's evidence link opening the referenced issue/PR/check/deploy entity, an "AI-generated" framing with the model and estimated cost, and — when the digest is `ai_off`, `failed`, or absent — the raw linked-evidence table (completed/carried issues with their linked PRs, CI/deploy status, and scope delta) instead. The surface SHALL be fully keyboard-operable (reach and open every evidence link without a pointer) and rendered strictly from theme tokens, correct in all three presets in light and dark, with no hardcoded colors or fonts, and SHALL NOT auto-load any remote image or link from the summarized content.

Work-graph placement: a read surface on the cycle view over the `cycle_digest` artifact and the linked work graph. Permission story: shown only to members of the cycle's team; every evidence link targets an entity the reader can already open.

#### Scenario: Evidence link opens the entity

- **WHEN** a reader activates an item's evidence link
- **THEN** the referenced issue/PR/check/deploy opens, letting the reader verify the claim

#### Scenario: AI-off fallback renders raw evidence

- **WHEN** the digest is absent or `ai_off`/`failed`
- **THEN** the cycle view shows the raw linked-evidence table (issues + linked PRs + CI/deploy + scope delta), strictly more than before and blocking nothing

#### Scenario: Keyboard and themes

- **WHEN** a reader navigates the digest using only the keyboard in each preset in light and dark
- **THEN** every item and evidence link is reachable and operable without a pointer and renders from tokens with no hardcoded values

#### Scenario: Render is exfil-safe

- **WHEN** the digest is displayed
- **THEN** no remote image or link from the summarized content is auto-loaded
