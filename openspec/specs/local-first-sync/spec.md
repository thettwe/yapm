# local-first-sync Specification

## Purpose
TBD - created by archiving change foundation. Update Purpose after archive.
## Requirements
### Requirement: Server-controlled synced queries

All client reads SHALL flow through Zero synced queries: the client requests named queries defined in `packages/schema`, and the server endpoint validates and authorizes each query with the caller's auth context before zero-cache executes it. Clients MUST NOT be able to widen a query beyond what the server permits.

Row-level permissions SHALL be enforced inside these server-side query definitions using real joins against the membership graph, so a user syncs ONLY the rows they can see: the single `workspace`, member `user`-profiles and `workspace_member` rows for members, teams and team rosters for members, invites for admins only, and work-data rows scoped to the caller's teams via a `team_membership` `whereExists` subquery. The membership/role predicate MUST be driven by the verified `ctx` (`{userID, role}`), never by client-supplied args. Reads for an unauthorized or non-member caller SHALL be denied by returning an empty query (the `denyAll` empty-`or()` filter), never by throwing. Where a query would expose a private row, the authorization filter MUST be applied such that the row's existence is never revealed to callers who cannot see it.

The permission model has two scoping axes. **Membership-scoped** entities (workspace, member, team, team_membership, invite) are gated on workspace role via `isMember`/`canManage` as above. **User-scoped** entities are gated on the caller's identity alone: a query over a user-scoped entity SHALL filter `where('userId', ctx.userID)` off the verified `ctx`, and SHALL be permitted when the caller is authenticated (`ctx` present) regardless of workspace membership, so that a caller who is authenticated but not yet a member can still read their own user-scoped rows; an unauthenticated caller SHALL be denied by an empty query. A user-scoped query MUST NOT return, nor reveal the existence of, any other user's row.

Work-graph placement: this capability now syncs the real identity/access graph — `workspace` (instance root), `user` (identity), `workspace_member` (role edge), `team`, `team_membership`, and `invite` — plus `user_preference`, the first **user-scoped** leaf hanging off `user` (identity), orthogonal to the membership graph. Every work entity (issue, PR link, check, deploy) hangs off this graph and inherits the membership-scoped pattern; personal, per-user entities inherit the user-scoped pattern. Permission story: membership-scoped and role-scoped as detailed in the workspace-membership, teams, and invitations specs; `user_preference` is owner-only (see "Per-user preference persistence and sync"); the single-tenant "all rows visible to all clients" behavior from foundation remains replaced.

#### Scenario: Local read is instant

- **WHEN** the app renders data already present in the client replica
- **THEN** the read resolves from local storage without a network round-trip

#### Scenario: Remote change propagates

- **WHEN** a second client modifies the workspace name
- **THEN** the first client's UI reflects the change via sync without user action or page reload

#### Scenario: A user syncs only rows they can see

- **WHEN** an authenticated non-member requests any synced query
- **THEN** the server-side definition returns an empty result for every row they cannot see, with no leak of row existence

#### Scenario: Client cannot widen a permissioned query

- **WHEN** a client supplies args attempting to broaden a membership-scoped query beyond its context
- **THEN** the re-evaluated server-side query still restricts results to what the caller's `ctx` permits

#### Scenario: User-scoped read returns only the caller's own rows

- **WHEN** an authenticated caller requests a user-scoped query and another client attempts to widen it to another user's rows
- **THEN** the server-side definition returns only the caller's own `ctx.userID` rows and never reveals the existence of another user's row

### Requirement: Optimistic shared mutators

All writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic application) and server (authoritative execution with authz). On server rejection, the client state MUST roll back to the server-authoritative result.

Mutator authorization SHALL enforce the workspace role and, where relevant, team membership from the verified `ctx`, and SHALL check authorization BEFORE any existence check so that a rejection never reveals whether a private row exists. A `viewer` (or a non-member / absent context) SHALL be rejected for every write; role-restricted operations (workspace/member/team/invite management) SHALL be rejected for non-admins. Primary keys for created rows SHALL be client-minted UUIDv7 at the mutator call site, never inside a mutator body.

#### Scenario: Optimistic write with server authority

- **WHEN** a user renames the workspace
- **THEN** the UI updates immediately, and the change persists in Postgres via the server mutator

#### Scenario: Rejected write rolls back

- **WHEN** the server mutator rejects a write (e.g., empty workspace name)
- **THEN** the client state reverts to the authoritative value and the UI surfaces the rejection

#### Scenario: Unauthorized write is rejected before existence check

- **WHEN** a `viewer` or non-member attempts a write against any row
- **THEN** the mutator rejects it as not authorized without revealing whether the target row exists

#### Scenario: Keyboard-only rename

- **WHEN** a user reaches the workspace name via Tab/focus navigation, edits it, and confirms with Enter
- **THEN** the rename completes without any pointer interaction

### Requirement: Disconnection is visible and lossless

Reads SHALL continue to resolve from the local replica while disconnected. Writes are NOT supported offline (Zero rejects them), so the UI SHALL surface connection state and prevent write attempts that would silently lose user input. On reconnect, syncing resumes automatically.

Recovery SHALL NOT depend on a page reload. The client SHALL recover from every non-terminal broken-sync state, not only from an expired credential: when the sync client reports `needs-auth` or `error` — states from which the sync engine does not retry on its own — the client SHALL re-mint its sync credential and explicitly resume the connection; when it reports `disconnected` beyond a short grace period, the client SHALL re-mint the credential so the sync engine's own retry presents a fresh one. Re-minting a credential whose value is unchanged SHALL still resume a paused connection, so a stalled client can never be left waiting on a value that will never differ.

Recovery attempts SHALL be spaced by exponential backoff with jitter and a bounded maximum delay, and the schedule SHALL reset once the connection is established. A persistent server-side fault SHALL therefore degrade to a calm, bounded retry — never an unbounded retry loop that saturates the CPU or the sync endpoints.

The recovering state SHALL be visible on every authenticated surface, not silent: the connection indicator SHALL report that the client is reconnecting (distinguishing offline, expired sign-in, and sync error), SHALL announce the transition to assistive technology via a polite live region, SHALL offer a keyboard-operable control to retry immediately once the backoff delay has stretched, and SHALL take every color from theme tokens so it renders correctly in every shipped preset in both light and dark.

A failure to reach the server SHALL never be presented as a sign-out: the client SHALL treat only an explicit unauthorized response as "no session", SHALL treat a thrown request error, timeout, server error, or unparseable response as "temporarily unavailable" and retry it, and SHALL bound every credential request with a timeout so a hung request can never leave the app in an indefinite loading state.

#### Scenario: Reading while disconnected
- **WHEN** the network drops
- **THEN** already-synced data continues to render and navigate without errors

#### Scenario: Writes are blocked, not lost
- **WHEN** a user attempts an edit while disconnected
- **THEN** connection state is visible and the edit is prevented or held in the editing surface — never accepted and silently dropped

#### Scenario: Reconnect resumes sync
- **WHEN** connectivity returns
- **THEN** the client resumes syncing and converges with server state without a page reload

#### Scenario: Recovery from a terminal sync error

- **WHEN** the sync engine reports a fatal connection error from which it will not retry by itself
- **THEN** the client re-mints its sync credential, resumes the connection, and converges with server state without a page reload

#### Scenario: A persistent fault degrades to a calm retry

- **WHEN** the sync endpoint keeps failing across repeated recovery attempts
- **THEN** successive attempts are spaced by an increasing, jittered delay up to a bounded maximum, and the client neither saturates the CPU nor retries faster than that bound

#### Scenario: Backoff resets after recovery

- **WHEN** a recovery attempt succeeds and the connection reaches `connected`
- **THEN** the retry schedule resets, so the next unrelated interruption is retried promptly rather than at the previous backed-off delay

#### Scenario: Recovering is announced and keyboard-operable

- **WHEN** the client is reconnecting and the backoff delay has stretched
- **THEN** the connection indicator announces the reconnecting state to assistive technology and exposes a retry control that is reachable and activatable with the keyboard alone, using only theme tokens for color

#### Scenario: A failed credential request does not sign the user out

- **WHEN** the sync-credential request fails with a network error, a timeout, or a server error while the user has a valid session
- **THEN** the user stays signed in, the failure is surfaced as temporarily unavailable with a retry, and the client retries on backoff rather than navigating to the sign-in page

#### Scenario: A hung credential request cannot wedge the app

- **WHEN** the sync-credential request never settles
- **THEN** the request is aborted by its timeout and the app shows an actionable retry state instead of an indefinite loading state

### Requirement: Per-user preference persistence and sync

The system SHALL persist a per-user `{theme, accent}` preference in a `user_preference` entity in the existing Postgres (no new service), synced via Zero. Exactly one preference row SHALL exist per user (`user_id` unique). The row's primary key SHALL be a client-minted UUIDv7 at the mutator call site; the row SHALL carry `theme` (one of the shipped presets) and an optional `accent` (null = the preset default).

The preference SHALL be readable and writable ONLY by its owner. Reads SHALL flow through a user-scoped synced query filtered by the verified `ctx.userID`; writes SHALL flow through a shared mutator in `packages/schema` (imported by client and server) that sets `user_id` from `ctx.userID` (never from args), authorizes the caller as authenticated before any existence check, and validates the `accent` value, rejecting an unparseable color. The gate SHALL be authentication, not workspace membership, so an authenticated non-member may still read and write their own preference. Light/dark mode SHALL NOT be part of this synced entity (it is device-local).

Work-graph placement: `user_preference` is a user-scoped leaf off `user` (identity), orthogonal to the workspace/team membership graph. Sync/permission story: owner-only — a caller reads and writes only their own single row; another user's row is never returned nor its existence revealed; an unauthenticated caller is denied by an empty query and a rejected write.

#### Scenario: Preference syncs to the owner

- **WHEN** a user sets their theme or accent and later loads the app on another device signed in as the same user
- **THEN** the `{theme, accent}` preference syncs and is applied, having persisted in Postgres via the shared mutator

#### Scenario: Preference is owner-only

- **WHEN** an authenticated caller queries `user_preference` or attempts to write another user's preference row
- **THEN** the read returns only the caller's own row (never another user's, nor its existence) and the write is rejected as not authorized before any existence check

#### Scenario: Authenticated non-member can set their own preference

- **WHEN** an authenticated user who is not yet a workspace member sets their theme while on the access gate
- **THEN** the preference read and write succeed for their own row, gated on authentication rather than membership

#### Scenario: Client-minted id and validated accent

- **WHEN** a user creates their first preference row with an invalid accent value
- **THEN** the write is rejected on both client and server, and a valid write carries a client-minted UUIDv7 primary key generated at the call site

#### Scenario: Keyboard-only preference change persists

- **WHEN** a user changes their theme or accent using only the keyboard
- **THEN** the change applies optimistically to the live UI and persists via the shared mutator without any pointer interaction

### Requirement: Team-scoped work-data sync and mutation

The synced-query and shared-mutator model established for the membership graph SHALL extend to the product-work entities — `issue`, `label`, `issue_label`, `comment`, `saved_view`, the connector-fed delivery entities `pull_request`, `ci_check`, `review`, `deployment`, the `issue_link` edge, and now the retro entities `retro`, `retro_column`, `retro_card`, `retro_group`, `retro_vote_tally`, `retro_action`, and `retro_presence` — so that a user syncs work data ONLY for teams they belong to. Each work-data synced query SHALL scope rows by a `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), reusing the team-scoped visibility edge from workspace-auth; a caller who is not a member of a row's team SHALL read nothing, denied by the empty `or()` filter, with no leak of row existence, and authorization SHALL be applied before existence. A `viewer` SHALL read their teams' work data but SHALL be rejected for every work-data write; members and admins of a row's team may write. All work-data writes SHALL go through custom mutators defined once in `packages/schema` and imported by both client (optimistic) and server (authoritative), with created-row UUIDv7 primary keys minted at the call site and owner/creator/author fields set from `ctx`. The `issue` row's nullable `rank` field (the board's fractional-index ordering key) SHALL replicate to clients like any other issue column under this same team scope, and the `issue.move` mutator SHALL be gated by the same team-scoped `canWrite` rule as the other issue writes — a single-row update of `rank` and optionally `status`, with authorization checked before existence, rejected for viewers and non-members; the hand-written Kysely `DB` interface, the hand-written Zero schema, and the schema-drift test SHALL all include the `rank` column. The connector-fed delivery entities SHALL be written only through the connector's authoritative shared-mutator path (`WorkGraphMutation`), never by clients directly, and SHALL carry a `team_id` from the connector's repo→team mapping so they inherit exactly this team scope. The connector's own secrets and configuration SHALL be held in **server-only** tables excluded from the Zero schema, so no connector secret ever replicates to a client.

Two retro entities SHALL be narrower than team scope: a retro **draft** SHALL sync only to its author and a retro **vote** SHALL sync only to its voter, each filtered by the verified `ctx.userID` alone, with **no workspace-admin bypass** — a deliberate deviation from the shared team-scoped helper, because these rows carry the identity that the retro's anonymity and vote-privacy guarantees depend on. The **card→author binding SHALL live in a server-only table excluded from the Zero schema**, so no client can name it in any query. The schema-drift test SHALL cover every retro table and column and SHALL assert the server-only tables' absence from the Zero schema.

Work-graph placement: `issue` hangs off `team` (off the single `workspace`); `label` and `saved_view` hang off `team`; `issue_label` is an `issue`↔`label` edge; `comment` hangs off `issue`; `pull_request` and `deployment` hang off `team`; `ci_check` and `review` hang off `pull_request`; `issue_link` is an `issue`↔`pull_request` edge; the `rank` ordering field adds a synced column but no new visibility surface — it rides the existing issue scope; `retro` hangs off `team` and references `cycle` twice (reflected cycle, next cycle); `retro_column`, `retro_draft`, `retro_card`, `retro_group`, `retro_vote`, `retro_action` and `retro_presence` hang off `retro`; `retro_vote_tally` is keyed by its vote target; `retro_action` may reference an `issue`. Every team-scoped one inherits the team-scoped membership predicate; the connector secrets/config surface and the retro card→author table are off-graph and unsynced. Sync/permission story: membership-scoped via `team_membership`, deny-by-empty, auth-before-existence, viewers read-only; connector writes flow through the same mutator authz as human writes; secrets never sync; retro drafts and votes are self-scoped and the anonymous author is unsyncable.

#### Scenario: A user syncs only their teams' work data

- **WHEN** an authenticated user requests any work-data synced query
- **THEN** the server-side definition returns only rows whose team the user belongs to, and an empty result (with no leak of existence) for every other team's rows

#### Scenario: Client cannot widen a team-scoped work query

- **WHEN** a client supplies args attempting to broaden a work-data query to a team it does not belong to
- **THEN** the re-evaluated server-side query still restricts results to the caller's team memberships

#### Scenario: Rank syncs within team scope

- **WHEN** a member's client syncs their team's issues
- **THEN** each issue row includes its nullable `rank`, and issues from other teams are not synced

#### Scenario: Viewer move is rejected

- **WHEN** a `viewer` attempts `issue.move`
- **THEN** it is rejected as not authorized before any existence check and no row is written

#### Scenario: Drift test covers rank

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** the `issue.rank` column is present in the Kysely `DB` map and the Zero schema and matches the database as nullable `text`

#### Scenario: Delivery entities inherit the team scope

- **WHEN** a member reads a PR/check/deploy/link ingested for a repository mapped to one of their teams, and another for a team they do not belong to
- **THEN** only the mapped-team rows replicate to them, and the other team's delivery rows are never synced

#### Scenario: Connector secrets never sync to a client

- **WHEN** any client replica is inspected
- **THEN** it contains no connector secret or webhook secret, because the connector secrets/config tables are excluded from the Zero schema

#### Scenario: Retro drafts and votes are self-scoped with no admin bypass

- **WHEN** a team member — including a workspace admin — runs the retro draft and vote queries for rows they did not author or cast
- **THEN** both results are empty, and only the author's own drafts and the voter's own votes ever replicate

#### Scenario: An anonymous card's author never replicates

- **WHEN** any client replica is inspected after a retro with anonymity enabled has published its cards
- **THEN** it contains no author identity for those cards, because the card→author table is excluded from the Zero schema and the synced card row's author value is null

#### Scenario: Viewer reads but never writes work data

- **WHEN** a `viewer` on a team reads that team's issues, delivery entities and retros and then attempts any issue/label/comment/saved-view/retro write
- **THEN** the reads succeed and every direct client write is rejected as not authorized before any existence check

#### Scenario: The drift test covers the new schema

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts every new table and column (delivery entities, connector surface, and the retro entities) matches the hand-written Kysely and Zero schemas, and that the server-only tables are absent from the Zero schema

### Requirement: Server-authoritative per-team issue numbering in the mutator pass

The per-team issue number SHALL be assigned exclusively in the server-authoritative mutator pass and never in the shared client mutator body, so that optimistic client execution and rebase never fabricate or change a number. The shared `packages/schema` mutator set SHALL be extended on the server (via the base-plus-overrides mutator mechanism) so the authoritative pass claims the next per-team number atomically and writes it onto the issue; the client optimistic pass SHALL leave the number unset until the authoritative row replicates back.

Work-graph placement: the per-team counter is a server-only entity off `team`, excluded from the Zero schema so it never syncs. Permission story: the counter is written only by the server mutator pass and never exposed to clients.

#### Scenario: Client optimistic create carries no number

- **WHEN** the shared issue-create mutator runs on the client optimistically
- **THEN** the created issue has no number, and the number is populated only after the server-authoritative pass replicates back

#### Scenario: Number assignment is atomic per team

- **WHEN** the server-authoritative pass assigns numbers to concurrent creates in one team
- **THEN** each issue receives a distinct sequential number with no collision, and the counter never syncs to any client

### Requirement: Cycles replicate under the team scope

The `cycle` table SHALL replicate to a client under the same team scope as issues: a user syncs only their teams' cycles, and the sync is denied by an empty query otherwise. Cycle mutators (`cycle.create`, `cycle.update`, `cycle.activate`, `cycle.complete`, `issue.setCycle`) SHALL sync under that scope, with viewers unable to write. The server-only `cycle_sequence` counter SHALL NOT be part of the Zero schema and SHALL never replicate, and the schema-drift test SHALL cover the new `cycle` table, the `issue.cycle_id` column, and the `cycle_sequence` exclusion.

Work-graph placement: `cycle` replicates like any team-scoped work table; `cycle_sequence` is server-only. Permission story: read scoped to the caller's teams; writes gated by the shared mutators.

#### Scenario: A user syncs only their teams' cycles

- **WHEN** a user with membership in one team but not another queries cycles
- **THEN** only the cycles of teams they belong to replicate

#### Scenario: The cycle sequence never syncs and drift is guarded

- **WHEN** the schema-drift test runs against the migrated database
- **THEN** `cycle` and `issue.cycle_id` match the hand-written Kysely and Zero schemas, and `cycle_sequence` is present in the Kysely interface but absent from the Zero schema

### Requirement: Triage state replicates under the team scope

The `issue.needs_triage` column SHALL replicate under the same team-scoped predicate as the rest of the issue, and the triage mutators (`flagTriage`, `acceptTriage`, `declineTriage`, `routeIssue`) SHALL sync under that scope with viewers denied writes. The schema-drift test SHALL cover the new column in both the Kysely `DB` interface and the Zero schema.

Work-graph placement: one boolean column on an existing synced entity. Permission story: viewers read the flag, cannot write it.

#### Scenario: Drift test covers the triage column

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** `issue.needs_triage` is present in the Kysely DB interface and the Zero schema and matches the database (not null, has default)

#### Scenario: A viewer syncs but cannot mutate triage

- **WHEN** a viewer syncs a team's issues and attempts a triage mutation
- **THEN** the flag replicates read-only and the mutation is rejected before any write

### Requirement: The project entity replicates workspace-wide; the issue reference replicates under team scope

The system SHALL replicate the `project` table to every workspace member under the `isMember` gate, and SHALL replicate `issue.project_id` under the existing team scope. A workspace-level project query SHALL re-scope its related issues with the `teamScoped` predicate so that no issue outside the caller's teams is ever synced. Project mutators SHALL sync under `canWrite`; viewers SHALL NOT write. The schema-drift test SHALL cover the new `project` table and the new `issue.project_id` column.

Work-graph placement: a workspace-level table plus a nullable edge on the team-scoped `issue`. Permission story: `isMember` for projects, `teamScoped` for issues, composed so the team boundary holds.

#### Scenario: Projects sync to every member

- **WHEN** a workspace member connects
- **THEN** every project in the workspace replicates to their client

#### Scenario: A project's related issues never cross a team boundary

- **WHEN** a member reads a project spanning teams they are not all in
- **THEN** only the project's issues in the member's teams are replicated

#### Scenario: A viewer cannot write a project or an issue's project

- **WHEN** a viewer attempts any project mutator or `issue.setProject`
- **THEN** the mutation is rejected

#### Scenario: The drift test covers the new schema

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the `project` table and `issue.project_id` match the hand-written Kysely and Zero schemas

### Requirement: Team-scoped, client-read-only cycle-digest sync

The cycle-digest artifact SHALL extend the team-scoped synced-query model to a new `cycle_digest` entity: a user SHALL sync a cycle's digest ONLY for a team they belong to, scoped by the same `whereExists` over the owning team's roster driven by the verified `ctx.userID` (never client args), denied by the empty `or()` filter for other teams with no leak of row existence, and readable by viewers. Unlike the human-authored work-data entities, `cycle_digest` SHALL be **client-read-only**: no client Zero mutator SHALL create or edit it. It SHALL be written only by the server-side pre-compute job over the authoritative write path (the same server-only write mechanism connector work-graph mutations use), so a client can never forge or alter a digest. AI provider keys and AI config SHALL reuse the existing **server-only** connector secret/config surface (excluded from the Zero schema) and SHALL never sync to a client. The schema-drift test SHALL cover the new `cycle_digest` table.

Work-graph placement: `cycle_digest` is a team-scoped leaf off `cycle` (off `team`); its content references existing synced issue/PR/check/deploy entities as evidence and adds no per-person visibility surface. Sync/permission story: membership-scoped read via `team_membership`, deny-by-empty, auth-before-existence, viewers read; writes are server-only and never client-reachable; AI secrets/config stay server-only and unsynced.

#### Scenario: A user syncs only their teams' digests

- **WHEN** an authenticated user requests the cycle-digest synced query
- **THEN** the server-side definition returns only digests for teams the user belongs to, and an empty result (with no leak of existence) for every other team

#### Scenario: A client cannot write a digest

- **WHEN** a client attempts to create or edit a `cycle_digest` row
- **THEN** no client mutator applies the write; only the server-side pre-compute job writes the row

#### Scenario: AI keys never sync

- **WHEN** any client requests any synced query
- **THEN** no AI provider key or AI config secret is returned, because AI secrets reuse the server-only connector surface excluded from the Zero schema

#### Scenario: Drift test covers the new table

- **WHEN** the schema-drift test runs
- **THEN** it verifies the `cycle_digest` table matches the hand-written `DB` interface and Zero schema

### Requirement: Sync endpoints reject an invalid credential with an unauthorized status

The synced-query and mutate endpoints SHALL distinguish a credential that is **absent** from one that is **presented and invalid**, because the sync engine treats the two differently.

When a request carries no credential, the endpoints SHALL continue to respond successfully with a null user identity, so a legitimately signed-out client is denied by the empty-query and mutator-rejection paths without being pushed into an authentication loop. When a request carries a credential that fails verification (expired, malformed, or wrongly signed), the endpoints SHALL respond with HTTP **401** and SHALL NOT return a success response carrying a null user identity — a success response asserting an identity that contradicts the caller's connection causes the sync engine to invalidate that connection, which can leave the caller's client group with no validated connection and take down sync for every client on it.

A failure that is not an authentication failure (for example the role lookup failing because the database is unreachable) SHALL keep returning a server-error status rather than being reported as unauthorized, so the client's recovery path retries it instead of re-minting a credential that was never the problem.

#### Scenario: An expired credential is refused, not silently accepted

- **WHEN** the sync engine forwards a bearer credential that has expired
- **THEN** the endpoint responds 401 and does not return a success response carrying a null user identity

#### Scenario: An absent credential is still the signed-out path

- **WHEN** a request arrives at a sync endpoint with no credential at all
- **THEN** the endpoint responds successfully with a null user identity, every query is denied by the empty-query filter, and every mutator rejects

#### Scenario: A valid credential is unaffected

- **WHEN** a request carries a valid, unexpired credential
- **THEN** the endpoint resolves the verified subject and its workspace role exactly as before, and the response is unchanged

#### Scenario: A server fault is not reported as an auth fault

- **WHEN** resolving the auth context fails for a non-authentication reason
- **THEN** the endpoint responds with a server-error status, and the client retries on backoff rather than treating it as an expired credential

### Requirement: Self-scoped notification sync with no admin bypass

The `notification` entity SHALL replicate through Zero under a **self-scoped** synced query filtered
on the verified `ctx.userID`, never on an argument, gated on workspace membership and denied by an
empty query otherwise. It SHALL NOT use the team-scoped predicate, and SHALL NOT carry that
predicate's workspace-admin bypass: a workspace admin reads every issue in the workspace and
**zero** of another user's notifications.

Work-graph placement: `notification` is a per-recipient leaf addressed at a `user` and derived from
work-graph events on an issue in a `team`. Sync/permission story: exactly one person receives a
given row — its recipient. `team_id` is present for membership cleanup and indexing and is **not** a
sync scope; no relationship from `notification` to `issue` exists, so no query can widen a read past
the team boundary through it.

The synced set SHALL be bounded by a row limit on the query and by a scheduled retention sweep, so
that a monotonically growing per-user table cannot become an unbounded hydration cost on every
client.

#### Scenario: An admin syncs none of another user's notifications

- **WHEN** a workspace admin's client is fully synced
- **THEN** its local store contains none of any other user's notification rows

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the notification query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: The synced set stays bounded

- **WHEN** a user has accumulated far more notifications than the query limit
- **THEN** their client syncs at most the limit, and rows past the retention window no longer exist
  to sync

### Requirement: A synced entity keyed by a compound natural key, written only by the server

`notification` SHALL be the first synced entity whose primary key is a **compound natural key**
rather than a client-minted UUIDv7, and whose rows are created **only** by the server-authoritative
mutator pass. Because every key component is derived from the triggering mutation's own arguments,
no identifier is minted at a call site or inside a mutator body, and the client-minted-UUIDv7
constraint is not engaged by this entity at all.

A client-location transaction SHALL create no `notification` row, so a mutator re-run during rebase
can neither duplicate nor fabricate one. Read-state writes SHALL remain ordinary optimistic shared
mutators addressing a row by its natural key, with the recipient component taken from the verified
context.

The CI schema-drift test SHALL cover the new table — its columns, its compound primary key, and the
new `user_preference` column — asserting the migration, the hand-written Kysely `DB` interface and
the hand-written Zero schema all agree with the live Postgres schema.

#### Scenario: Rebase cannot duplicate a notification

- **WHEN** a mutator that triggers a fan-out is re-run on the client during rebase
- **THEN** no notification row is created or duplicated, because only the server-authoritative pass
  writes them and its writes are absorbed by the primary key

#### Scenario: Drift test covers the compound key

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the notification table's compound primary key matches the Zero schema and the
  hand-written `DB` interface, and fails if any of the three drifts

#### Scenario: Read state is still an optimistic shared mutator

- **WHEN** a recipient marks a notification read
- **THEN** the change applies optimistically through a shared `packages/schema` mutator imported by
  both client and server, within the sub-100ms budget

### Requirement: Self-scoped, issue-scoped subscription sync with no admin bypass

The `issue_subscription` entity SHALL replicate through Zero under a synced query that is **both**
self-scoped on the verified `ctx.userID` and scoped to a single issue supplied as an argument, gated
on workspace membership and denied by an empty query otherwise. It SHALL NOT use the team-scoped
predicate and SHALL NOT carry that predicate's workspace-admin bypass.

Because the query is scoped to one issue and one user, it SHALL return **at most one row**, so the
synced set is bounded without a row limit and without a retention sweep.

No synced query SHALL return another user's subscriptions. There SHALL be no watcher list, no
follower count and no "who follows this issue" read available to any client, including a workspace
admin's. The subscriber set exists only as a server-side read inside the notification fan-out.

Work-graph placement: an edge from a `user` to a team-scoped `issue` recording a standing intent.
Sync/permission story: exactly one person can read a given row — the person it belongs to — and only
while they have that issue open. `team_id` is present for cleanup and indexing and is not a sync
scope.

#### Scenario: An admin syncs none of another user's subscriptions

- **WHEN** a workspace admin's client is fully synced and viewing an issue
- **THEN** its local store contains no other user's subscription rows for that issue or any other

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the subscription query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: The synced set is one row

- **WHEN** a user with subscriptions to many issues opens one of them
- **THEN** their client syncs at most their own single subscription row for that issue

### Requirement: A second synced entity keyed by a compound natural key

`issue_subscription` SHALL be the second synced entity whose primary key is a **compound natural
key** rather than a client-minted UUIDv7. Because both key components are known at the call site —
the issue being viewed and the verified caller — no identifier is minted at a call site or inside a
mutator body, and the client-minted-UUIDv7 constraint is not engaged by this entity.

Follow and unfollow SHALL be ordinary optimistic shared mutators defined in `packages/schema` and
imported by both client and server, addressing a row by its natural key with the user component
taken from the verified context and never from arguments — so a caller is structurally unable to
address another person's subscription.

Auto-subscription SHALL be written **only** in the server-authoritative mutator pass, so a
client-location transaction creates none and a rebase cannot fabricate one.

The CI schema-drift test SHALL cover the new table — its columns, its compound primary key and its
constrained state column — asserting the migration, the hand-written Kysely `DB` interface and the
hand-written Zero schema all agree with the live Postgres schema.

#### Scenario: A caller cannot address another user's subscription

- **WHEN** a follow or unfollow mutation is invoked with arguments naming a different user
- **THEN** the user component is taken from the verified context regardless, so only the caller's
  own subscription can be affected

#### Scenario: Rebase cannot fabricate a subscription

- **WHEN** a mutator that triggers auto-subscription is re-run on the client during rebase
- **THEN** no subscription row is created, because only the server-authoritative pass writes them

#### Scenario: Drift test covers the compound key and the state constraint

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the subscription table's compound primary key and its state check constraint
  match the Zero schema and the hand-written `DB` interface, and fails if any of the three drifts

#### Scenario: Following applies within the interaction budget

- **WHEN** a member toggles the follow control
- **THEN** the change applies optimistically through the shared mutator and the surface updates
  without waiting on the network

### Requirement: A derived server-only table that the replica must not notice

The search index SHALL be a **server-only** table: present in Postgres and in the hand-written Kysely
`DB` interface, and **absent from the Zero schema**, joining the existing server-only set
(`issue_sequence`, `cycle_sequence`, the connector tables, and the retrospective card→author binding)
in the drift test's assertion. Because it is absent from the sync schema, no synced query can name it
and no relationship can reach it.

Its text columns SHALL be plain `text`. The full-text vector SHALL exist **only inside a GIN
expression index**, never as a stored column on this table or on any synced table, so no exotic column
type enters the logical-replication path toward the sync replica. Adding the table SHALL NOT require
changing the publication configuration, because a publication change forces a full replica resync on
every self-hosted upgrade.

Work-graph placement: a derived projection of issues and comments that owns no truth and can be
dropped and rebuilt. Sync/permission story: never synced; every read carries the team-scoped
predicate; its denormalised team reference is sound only because an issue can never change team.

#### Scenario: Drift test covers the new table on both sides

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it finds the search index table in Postgres and in the hand-written `DB` interface, finds
  its compound primary key and its constraints unchanged, and asserts it is **not** present in the
  Zero schema

#### Scenario: The replica is undisturbed by the new table and its index

- **WHEN** the three-container stack is brought up from empty volumes with the migration applied
- **THEN** the sync service starts, replicates, and serves synced queries normally, with no
  publication change and no replica resync

#### Scenario: No synced query can name the index

- **WHEN** the synced query registry is inspected
- **THEN** no query's abstract syntax tree names the search index table

### Requirement: The server pass degrades against the existing connection state

The search surfaces SHALL read the **existing** sync connection state to decide whether the server
pass is available, rather than introducing a second notion of "online". When the connection is not
established the server group SHALL be replaced by an explicit on-device-only state and the on-device
group SHALL be unaffected.

#### Scenario: Connection loss degrades search rather than breaking it

- **WHEN** the sync connection drops while a member is searching
- **THEN** the on-device group keeps answering on the keystroke and the server group states that only
  on-device results are shown

#### Scenario: Recovery restores the server group without a reload

- **WHEN** the connection recovers
- **THEN** the next query populates the server group again, with no page reload

### Requirement: A server-only system principal writes through the shared mutators

The system SHALL define exactly one system principal — an `AuthContext` whose user identifier is the
reserved value `system` and whose workspace role is `admin` — in `packages/schema`, and SHALL use it
for every write the instance performs on its own behalf with no human behind it: today the cycle
maintenance pass and the connector-driven status transition. The principal SHALL be used only by
passing it as the `ctx` of a **shared mutator**, so every such write runs the same authorization the
same mutator runs for a person. It SHALL NOT be constructible from, or selectable by, any client
input, SHALL never be minted from a request, and SHALL never appear in a client mutator map. Its
admin role exists so one instance-wide actor can write across every team without a `team_membership`
row; it SHALL NOT be used to bypass any check other than team membership.

Work-graph placement: an authorization context, not an entity; it names no row and appears in no
table. Permission story: writes under the principal are indistinguishable from an admin's writes at
the mutator boundary and are therefore subject to every check an admin's write is; what bounds it is
that it is reachable only from server-side call sites whose input the instance produced.

#### Scenario: One definition, shared by every non-human write

- **WHEN** the codebase is inspected for non-human write paths
- **THEN** each one imports the single exported system principal from `packages/schema` rather than
  defining its own

#### Scenario: A client cannot present the system principal

- **WHEN** a client attempts to invoke a mutator with the reserved system identity
- **THEN** the `AuthContext` used by the sync endpoints is derived from the verified session and can
  never be the system principal, so the attempt has no effect

#### Scenario: The principal still passes through the mutator's checks

- **WHEN** a mutator runs under the system principal
- **THEN** its role capability check and its team-access check execute exactly as they do for a human
  admin, rather than being skipped

### Requirement: Automation state replicates under the scopes its tables already have

The `team.auto_status_since` and `issue.last_human_status_at` columns SHALL replicate under the
scopes their existing rows already use — the team row workspace-wide to members, the issue row
team-scoped — introducing no new synced entity, no new named query, and no new permission predicate.
Both SHALL be present in Postgres, in the hand-written Kysely `DB` interface, and in the Zero schema,
and SHALL be covered by the schema-drift test. Neither SHALL be writable by a client except through
the shared mutators that already govern its row.

Work-graph placement: scalar columns on two existing synced entities. Sync/permission story: a
non-member reads neither, denied by the same empty queries as before; a viewer reads both and writes
neither.

#### Scenario: No new query or predicate is introduced

- **WHEN** the synced query set is inspected after this change
- **THEN** it contains the same queries with the same predicates, the two new columns arriving on
  rows those queries already return

#### Scenario: The drift test covers both columns

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** both columns are present in the database and in the Zero schema with matching shape

#### Scenario: A viewer reads but cannot write

- **WHEN** a viewer on a team syncs its teams and issues and then attempts to write either column
- **THEN** the reads succeed and every write is rejected by the mutator that owns the row

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

### Requirement: Team-scoped, client-read-only retro AI artifact sync

The AI retro draft and its proposals SHALL replicate to clients under the same team-scoped read
predicate as the rest of a team's work data, and SHALL be **client-read-only**: no client mutator
SHALL exist for either table, and every write SHALL go through a server-only helper over the shared
sync transaction that is never registered in the client mutator map. This is the same class as the
cycle-digest artifact and SHALL follow the same shape rather than inventing a second one.

Both tables SHALL carry the owning `team_id` as the permission anchor and SHALL cascade from the
retro they belong to. Scheduling state used only by the background completion pass SHALL NOT be part
of the Zero schema — it SHALL exist in Postgres only, and the schema-drift check SHALL account for
that deliberate asymmetry.

Because the artifact is created lazily at the phase advance rather than in advance, a client synced
to a retro that has not been advanced SHALL receive **no rows at all** for these tables — the rows do
not exist — rather than rows filtered out by a predicate.

Work-graph placement: leaf artifacts off `retro`, which hangs off `team`. Permission story: a member
of the owning team reads them; an authenticated non-member gets an empty result through the existing
team-scoped predicate; nobody writes them from a client.

#### Scenario: A member of the team reads the artifact

- **WHEN** a member of the owning team syncs a retro that has been advanced past `brainstorm`
- **THEN** the draft row and its proposal rows arrive in that member's local replica

#### Scenario: A non-member receives nothing

- **WHEN** an authenticated workspace member who is not on the owning team evaluates both queries for that team's retro
- **THEN** both return zero rows

#### Scenario: No client mutator exists

- **WHEN** the client mutator map is enumerated
- **THEN** it contains no mutator that writes either artifact table, so a client cannot create or alter one even optimistically

#### Scenario: Before the advance there is nothing to sync

- **WHEN** a member syncs a retro still in `brainstorm` on a team that has opted in
- **THEN** their replica holds zero rows for both tables because none have been created

#### Scenario: Scheduling state does not sync

- **WHEN** the Zero schema is compared against the live Postgres schema
- **THEN** the completion pass's claim column is present in Postgres, deliberately absent from the Zero schema, and the drift check passes on that basis

### Requirement: Self-scoped AI-reaction sync with no admin bypass, written by a client mutator

The `retro_ai_reaction` entity SHALL replicate through Zero under a **self-scoped** synced query
filtered on the verified `ctx.userID`, never on an argument, gated on workspace membership and
denied by an empty query otherwise. It SHALL NOT use the team-scoped predicate and SHALL NOT carry
that predicate's workspace-admin bypass: a workspace admin reads every issue in the workspace and
**zero** of another member's reactions. The query SHALL carry an explicit comment naming this
deviation, in the same words the equivalent retro-draft and retro-vote queries carry, because
written as team-scoped it would look entirely ordinary in review.

Its primary key SHALL be the **compound natural key** `(proposal_id, user_id)`, so nothing is minted
at a call site or inside a mutator body and the client-minted-UUIDv7 constraint is not engaged.
Unlike the notification entity, whose rows only the server writes, this entity's rows SHALL be
written by an **ordinary optimistic shared mutator** — the same function imported by client and
server — with the user component taken from the verified context, so that a rebase re-applies the
same upsert onto the same key and can neither duplicate nor fabricate a row.

The derived verdict and counts on the AI proposal SHALL be written **only** by the
server-authoritative phase-advance pass through the existing server-only artifact write path, and
SHALL NOT be reachable from any client mutator.

The synced set SHALL be bounded by construction: the query is scoped to one retro and to one user,
so it holds at most one row per proposal in that retro.

Work-graph placement: a per-member leaf off an AI proposal, off `retro`, off `team`.
Sync/permission story: exactly one person reads a given row — its author. `retro_id` and `team_id`
are present for the server's one-shot count and for membership cleanup and are **not** sync scopes;
no relationship exists that could widen a read past the author.

The CI schema-drift test SHALL cover the new table — its columns and its compound primary key — and
the new columns on the AI proposal and retro action tables, asserting the migration, the
hand-written Kysely `DB` interface and the hand-written Zero schema all agree with the live Postgres
schema.

#### Scenario: An admin syncs none of another member's reactions

- **WHEN** a workspace admin's client is fully synced for a team whose members have reacted to AI proposals
- **THEN** its local store contains zero reaction rows authored by anyone else

#### Scenario: A non-member is denied by empty query

- **WHEN** an authenticated non-member subscribes to the reaction query
- **THEN** the query resolves to an empty result rather than an error that reveals anything

#### Scenario: Rebase cannot duplicate a reaction

- **WHEN** the reaction mutator is re-run on the client during rebase
- **THEN** no second row is created, because the compound natural key absorbs the re-applied upsert and no identifier was minted anywhere

#### Scenario: A reaction is an optimistic shared mutator

- **WHEN** a member records a reaction
- **THEN** the change applies optimistically through a shared `packages/schema` mutator imported by both client and server, within the sub-100ms budget

#### Scenario: No client mutator writes a verdict

- **WHEN** the client mutator map is enumerated
- **THEN** it contains no mutator that writes a proposal's verdict or counts, so only the server-authoritative phase advance can set them

#### Scenario: Drift test covers the compound key and the new columns

- **WHEN** the schema-drift test runs against live Postgres
- **THEN** it asserts the reaction table's compound primary key and columns, and the new proposal and action columns, match the Zero schema and the hand-written `DB` interface, and fails if any of the three drifts

