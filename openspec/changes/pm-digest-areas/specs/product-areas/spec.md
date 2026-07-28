## ADDED Requirements

### Requirement: Admin-editable path→area map stored in the existing connector config

The system SHALL provide a workspace-level, **admin-editable** map from repository file-path
prefixes to product-area labels. Each rule SHALL carry a `prefix`, an `area` label, and two
optional booleans: `sensitive` (touching this area is a risk signal) and `internal` (work here is
collapsed into a single "N internal improvements" line rather than narrated individually).

The map SHALL be stored in the `config` jsonb of the existing `connector_config` row for provider
`ai` — a server-only, admin-gated surface that never syncs through Zero. It SHALL NOT introduce a
migration, a new table, a new synced entity, or new secret material, and it SHALL NOT be stored in
`connector_installation.repo_mapping`, whose `Record<string, string>` value shape is read by a
live `repo_mapping ->> $repo` SQL expression that a widened value would break.

The map SHALL be readable and writable only through the existing admin-gated AI settings surface:
a non-admin SHALL be rejected before any part of the map is read, and the rejection SHALL be
identical whether or not a map exists.

Work-graph placement: workspace-level configuration hanging off the existing `ai`
`connector_config` row; it references no work-graph entity and adds no synced row. Permission
story: workspace-admin only for both read and write, enforced by the same middleware and the same
accessor-level assertion as the rest of the AI settings surface; it is never synced to any client.

#### Scenario: An admin defines a product area

- **WHEN** a workspace admin adds the rule `apps/server/src/billing/` → `Billing` with
  `sensitive` set
- **THEN** the rule is persisted in the `ai` connector config's `config` jsonb, no migration runs,
  and no new table or synced row is created

#### Scenario: A non-admin cannot read or write the map

- **WHEN** a workspace member or viewer requests the AI settings surface
- **THEN** the request is rejected before the map is read, and the response is identical for a
  workspace that has a configured map and one that has none

#### Scenario: Toggling other AI settings never clobbers the map

- **WHEN** an admin changes the AI provider or spend cap without sending an area map
- **THEN** the stored area map is unchanged

### Requirement: Paths are converted to area labels before the model runs

The system SHALL convert every repository file path into a yapm-computed area label **before**
assembling the object handed to the model, so that no raw file path, filename, or file extension
is ever present in an AI request. This SHALL be a substitution performed during fact assembly, not
a filter applied to model output.

Matching SHALL be deterministic: paths are normalized (leading `./` and `/` removed, compared
case-insensitively), rules are evaluated in the admin's declared order, and the **first matching
prefix wins**. A path matching no rule SHALL map to the reserved label `unmapped`; the raw path
SHALL NOT be passed through under any circumstance, including when the map is empty.

Matching SHALL use literal prefixes only. The system SHALL NOT accept a glob or a regular
expression from the admin surface.

Work-graph placement: a pure function over transient file metadata; it reads and writes no row.
Permission story: it runs server-side inside the digest job under the system principal and
produces only labels the admin authored.

#### Scenario: A path becomes an area label and the path disappears

- **WHEN** the map contains `apps/server/src/billing/` → `Billing` and a pull request touched
  `apps/server/src/billing/refund.ts`
- **THEN** the assembled facts carry the area label `Billing`, and neither
  `apps/server/src/billing/refund.ts` nor `refund.ts` nor `.ts` appears anywhere in the object
  handed to the model

#### Scenario: An unmatched path never leaks

- **WHEN** a pull request touches `tools/scripts/release.sh` and no rule matches it
- **THEN** the facts carry the label `unmapped` and the raw path appears nowhere in the model's
  context

#### Scenario: The most specific rule wins by declared order

- **WHEN** the map declares `apps/server/src/billing/` → `Billing` before `apps/server/` →
  `Backend` and a path matches both
- **THEN** the path maps to `Billing`

#### Scenario: An empty map disables the feature rather than leaking

- **WHEN** no area rules are configured
- **THEN** no area labels are produced, no file metadata is requested from the provider at all,
  and the digest is byte-identical to one produced without this capability

### Requirement: Keyboard-operable, tokenized admin editor for the area map

The AI settings view SHALL let a workspace admin add, edit, remove and **reorder** area rules, and
toggle each rule's `sensitive` and `internal` flags. Because rule order is semantically load-
bearing (first match wins), reordering SHALL be fully operable from the keyboard and SHALL NOT
require a pointer or a drag gesture. The surface SHALL render strictly from theme tokens, correct
in all three presets in light and dark, meeting AA contrast, with no hardcoded color or font.

Work-graph placement: an admin settings surface over the server-only AI config; it renders no
work-graph entity. Permission story: rendered only for a workspace admin; a non-admin sees the
existing admin-only notice.

#### Scenario: Keyboard-only rule management

- **WHEN** an admin adds a rule, changes its area label, toggles `sensitive`, moves it above
  another rule and removes a third — using only the keyboard
- **THEN** every control is reachable and operable without a pointer, and the resulting order is
  what the matcher uses

#### Scenario: Tokens and themes

- **WHEN** the editor is rendered in each preset in light and dark
- **THEN** every color and font comes from a theme token, contrast meets AA, and no value is
  hardcoded

#### Scenario: A non-admin sees no editor

- **WHEN** a member or viewer opens AI settings
- **THEN** the area-map editor is not rendered and no request for the map is made
