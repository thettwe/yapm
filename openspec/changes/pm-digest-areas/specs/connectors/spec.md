## ADDED Requirements

### Requirement: Transient changed-file metadata under the already-granted permissions

The narrow, hand-written REST client interface SHALL be extended with a `pulls.listFiles`
operation, used **only** to read the set of files a pull request touched. It SHALL run under the
GitHub App permissions the connector already documents and installers have already granted
(**Pull requests: Read-only** and **Contents: Read-only**), so the change SHALL NOT require a new
App permission and SHALL NOT force installers to re-approve the installation.

The result SHALL be used transiently inside the digest job and then discarded. The system SHALL
NOT persist any part of a `listFiles` response — no new column, no cache table, no jsonb blob, and
no derived value keyed to it.

Work-graph placement: a read-only provider call that produces no `WorkGraphMutation` and writes no
row. Permission story: performed by the server under the installation token, exactly like
reconciliation; it exposes nothing to any client.

#### Scenario: No new App permission is required

- **WHEN** an existing installation whose granted permissions are the documented read-only set is
  used to list a pull request's files
- **THEN** the call succeeds without any permission change and installers are not asked to
  re-approve

#### Scenario: Nothing from the response is persisted

- **WHEN** the digest job lists the files of every pull request in a cycle
- **THEN** no row is inserted or updated in any table as a result, and a subsequent read of the
  database finds no filename, path, or file-metadata value anywhere

### Requirement: The changed-file projection drops content and content pointers at the boundary

`GET /pulls/{n}/files` returns a `patch` field per file whether or not it is requested, alongside
`blob_url`, `raw_url` and `contents_url`. The system SHALL project each response entry down to
exactly `{ path, status, changes }` **at the client seam** — in the function that performs the
call, before any value is returned to a caller — and SHALL discard `patch`, `blob_url`, `raw_url`,
`contents_url`, `sha` and every other field.

The projected type SHALL have no field capable of carrying patch content, so a later change that
attempted to carry it would fail to compile rather than fail quietly.

Test doubles for this call SHALL return a response **containing** a `patch` field, so the
guarantee is proven by assertion rather than asserted by omission.

Work-graph placement: the single boundary function between the provider's response and everything
downstream. Permission story: unchanged — the projection narrows what the server itself holds in
memory.

#### Scenario: A patch field in the response never survives the seam

- **WHEN** the provider returns a file entry carrying `patch`, `blob_url`, `raw_url` and
  `contents_url`
- **THEN** the value returned by the client seam contains only `path`, `status` and `changes`, and
  none of the dropped fields appears in it or anywhere downstream of it

#### Scenario: The mock proves the guard

- **WHEN** the test double for `pulls.listFiles` is inspected
- **THEN** it returns a `patch` field, and a test asserts that no patch content reaches the object
  handed to the model

### Requirement: The changed-file draw on the rate limit is bounded and stated

Listing files for every pull request in a cycle is a new draw on the same installation rate limit
that reconciliation depends on. The system SHALL bound it three ways: it SHALL make **zero**
provider calls when the workspace has configured no area rules; it SHALL cap the number of
per-cycle `listFiles` calls at a fixed constant, enriching pull requests in a deterministic order
so a truncated run is reproducible; and it SHALL stop enriching for the remainder of a run when
the installation's reported remaining rate-limit quota falls below a floor, recording that it did
so. Calls SHALL be made serially, not concurrently, consistent with the provider's stated guidance
and with how reconciliation already serializes per installation. A truncated or skipped enrichment
SHALL degrade the digest to its pre-area content, never fail it.

Work-graph placement: a bound on a read-only provider call inside an existing background job.
Permission story: unchanged.

#### Scenario: An unconfigured workspace spends nothing

- **WHEN** a cycle closes in a workspace with no area rules configured
- **THEN** no `listFiles` call is made and the rate-limit consumption is unchanged from before this
  capability existed

#### Scenario: A large cycle is capped, not unbounded

- **WHEN** a cycle contains more pull requests than the per-cycle call cap
- **THEN** exactly the cap's worth of calls are made in a deterministic order, the remaining pull
  requests carry no area data, and the digest is still produced

#### Scenario: A low remaining quota stops the enrichment, not the reconciliation

- **WHEN** the provider reports remaining quota below the floor partway through a run
- **THEN** enrichment stops for that run, the event is recorded, the digest is produced from what
  was gathered, and reconciliation's own budget is left intact
