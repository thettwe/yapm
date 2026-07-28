## MODIFIED Requirements

### Requirement: Team-level cycle-facts query with no per-person dimension

The system SHALL provide a dedicated, narrowed `cycleFactsForTeam(teamId, cycleId)` read that emits **team-level aggregates only** for a completed cycle: counts (shipped / carried-over / added-mid-cycle), per-issue evidence bundles (the issue plus its linked PR titles/labels, check conclusions, and deploy state), CI conclusions, and review medians. This query SHALL NOT include any `assignee`, `author`, `reviewer`, or `user_id` dimension, so the identity data is never in the model's context. The consequential numbers SHALL be computed here by yapm, not by the model. It SHALL live in `packages/schema` and reuse yapm's existing team-level metric computations.

The facts SHALL additionally carry an **optional, identity-free area layer**, computed by yapm and
never supplied by the model: per-issue product-area labels, a per-issue change-size **band**
(derived from the provider's own per-file change counts, carried as a band rather than a raw line
count), a per-cycle grouping of areas with their issue and pull-request counts, the set of
**sensitive** areas the cycle touched, and a count of **internal improvements** (work whose files
fall only inside areas the admin marked internal). Every area-layer field SHALL be optional and
additive, so a caller that does not enrich the facts observes behavior byte-identical to a cycle
with no area data. Internal-improvement issues SHALL remain present in the per-issue bundles; the
collapse is a computed count the narration acts on, not a removal from the team's own facts.

Any read that supplies the area layer SHALL use an explicit column list — never `selectAll()` — so
that no identity-bearing column can be introduced by accident.

Work-graph placement: a read over the cycle's Done/carried issues and their linked PR/CI/deploy entities, narrowed to team-level aggregates. Permission story: team-scoped — it exposes only aggregates and evidence for entities the team can already see, and no per-individual row.

#### Scenario: The query carries no identity dimension

- **WHEN** `cycleFactsForTeam` is evaluated for a cycle
- **THEN** its result contains team-level counts and per-issue evidence bundles but no assignee/author/reviewer/user field

#### Scenario: Numbers are computed, not modeled

- **WHEN** the digest states "shipped 14 of 16, 3 carried"
- **THEN** those counts came from `cycleFactsForTeam`, and the model only narrated them

#### Scenario: The area layer is additive and identity-free

- **WHEN** a cycle's facts are enriched with area data
- **THEN** the result gains area labels, a change-size band, an area grouping, the touched
  sensitive areas and an internal-improvement count, all computed by yapm, and still contains no
  assignee/author/reviewer/user field

#### Scenario: Existing callers are unaffected

- **WHEN** a caller that supplies no area data builds cycle facts
- **THEN** every pre-existing field has its previous shape and value, and the new fields are
  absent

#### Scenario: Bands, not raw churn

- **WHEN** a pull request's files report a total change count
- **THEN** the facts carry a size band, and the model is given the band rather than an invented or
  recomputed number

## ADDED Requirements

### Requirement: Deterministic disclosure validator over generated digest content

The system SHALL apply a deterministic **disclosure validator** to every generated digest, as a
structural sibling of the existing name-validator and running after it. The validator SHALL drop
any item whose text contains a `/`-bearing file-path token, a source-file extension, a backtick, or
an `identifier.method()` code shape; it SHALL blank a headline that contains one; and it SHALL
remove any section left empty. It SHALL drop the offending **item**, never the whole digest, so one
bad line cannot suppress an otherwise clean digest.

The validator SHALL NOT flag common non-path slash forms: `CI/CD`, `I/O`, `A/B`, `and/or`, `24/7`,
numeric pairs such as `14/30`, and dates such as `2026/07/28`.

The validator SHALL be documented and treated as **defense in depth, not the boundary**. The
boundary is structural: raw file paths are converted to yapm-computed area labels before the model
is called, so a path-shaped string in model output can only originate from injected or echoed
provider text, or from a hallucination.

Work-graph placement: a pure function over the typed digest content, alongside the cite-or-omit and
name validators in `packages/schema`. Permission story: it narrows what is stored and shown; it
reads no row and grants no access.

#### Scenario: An item bearing a path token is dropped

- **WHEN** the model emits an item whose summary reads "hardened the session check in
  `src/auth/session.ts`"
- **THEN** that item is absent from the stored digest content, the rest of the digest is stored
  unchanged, and the section is removed only if it has no other items

#### Scenario: Common slash forms are not false positives

- **WHEN** an item's summary contains `CI/CD`, `I/O`, `and/or`, `24/7`, `14/30` or `2026/07/28`
- **THEN** the item is retained

#### Scenario: A path in the headline blanks only the headline

- **WHEN** the headline contains a file path
- **THEN** the headline is blanked and every clean item is still stored

### Requirement: Area altitude in the digest prompt and input

The digest's operator-authority system prompt SHALL instruct the model to describe work by its
yapm-computed **product-area labels**, to never emit a file path, filename, file extension, code
fence or code identifier, and to collapse internal-area work into a single "N internal
improvements" line using the count yapm computed. The untrusted-data block SHALL state the area
grouping, the size bands, the touched sensitive areas and the internal-improvement count as
**trusted computed values** the model narrates but does not recompute, kept separate from the
fenced untrusted work-graph text.

The prompt SHALL remain instructions the schema and validators then enforce regardless of what the
model does: no prompt rule in this requirement is the mechanism by which a path is kept out of the
context — the substitution before the call is.

Work-graph placement: the prompt and input builder for the existing digest run. Permission story:
unchanged; the run is still server-side under the system principal with no tools and no egress.

#### Scenario: The model is given labels and counts, never paths

- **WHEN** the digest input is assembled for a cycle whose pull requests touched real files
- **THEN** the input block names area labels, bands and counts, and contains no file path,
  filename or file extension

#### Scenario: Internal work is one line

- **WHEN** a cycle contains work whose files fall only inside admin-marked internal areas
- **THEN** the input carries a computed internal-improvement count and the prompt directs a single
  collapsed line rather than an item per issue

### Requirement: Area enrichment never blocks or fails the digest

The digest job SHALL treat area enrichment as best-effort. A provider error, a timeout, a
rate-limit floor, a missing installation, a truncated call budget, or an unconfigured area map
SHALL cause the digest to be produced from the un-enriched facts, never to be marked `failed` and
never to block the cycle. Enrichment SHALL run inside the existing pre-compute job on the existing
shared pg-boss scheduler — no second scheduler start, no new queue, no new container.

Work-graph placement: a step inside the existing `cycle_digest` producer. Permission story:
unchanged; system principal, server-side.

#### Scenario: A provider failure degrades to the shipped digest

- **WHEN** the provider call for changed files fails or times out
- **THEN** the digest is generated from facts with no area layer, its status is `ready` (not
  `failed`), and the failure is logged

#### Scenario: No new scheduler or queue

- **WHEN** the server boots with the digest pre-compute enabled
- **THEN** enrichment runs inside the existing cycle-digest worker on the single shared pg-boss
  instance, and no additional queue or scheduler is started
