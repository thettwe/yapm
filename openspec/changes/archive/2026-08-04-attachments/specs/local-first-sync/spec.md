## ADDED Requirements

### Requirement: A synced entity with no client mutator, written only over the authenticated REST path

The system SHALL replicate `attachment` rows under the existing team scope so an issue's file list
renders from the local replica with no network round trip, and SHALL define **no** mutator for that
table in the shared mutator map — neither client-callable nor server-only. Every insert, update and
delete SHALL occur on the authenticated REST path, where the row and its bytes are written together.
The replicated row SHALL carry no URL, no signature and no storage key, so no part of the synced set
is itself a capability.

#### Scenario: Attachment rows reach members of the owning team

- **WHEN** a member of the owning team is signed in and an attachment is created for one of that
  team's issues
- **THEN** the row appears in that member's local replica
- **AND** the issue's file list renders without issuing a request

#### Scenario: A non-member receives an empty result, not an error

- **WHEN** a signed-in user who is not a member of the owning team runs the attachments query
- **THEN** the query returns empty via an empty predicate
- **AND** authentication is checked before existence, so nothing distinguishes "no rows" from "not
  permitted"

#### Scenario: The shared mutator map contains no attachment mutator

- **WHEN** the shared mutator map and the mutator tool registry are enumerated
- **THEN** neither contains any entry that writes the `attachment` table
- **AND** the registry's exhaustiveness check still passes, because there is nothing to classify

#### Scenario: A client cannot forge an attachment row

- **WHEN** a client attempts to write the `attachment` table through the sync engine
- **THEN** there is no mutator to call and generic CRUD mutations are disabled, so the write cannot
  be expressed

#### Scenario: The synced row is not a capability

- **WHEN** a replicated attachment row is inspected on the client
- **THEN** it contains an opaque id, a filename, a sniffed content type, a size and its team, issue
  and comment references
- **AND** it contains nothing that grants access to bytes without the caller's own session
