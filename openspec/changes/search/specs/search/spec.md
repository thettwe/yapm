## ADDED Requirements

### Requirement: Search is instant on-device, then completed by the server

The system SHALL answer a search query in two passes. An **on-device pass** SHALL run synchronously
on the keystroke over rows the sync engine has already replicated, issuing **no network request**,
and SHALL therefore work with the connection down. A **server pass** SHALL run against Postgres
full-text search, debounced behind an abortable request, and SHALL **extend** the on-device answer
with text the client does not hold — comment bodies, and issues in the caller's other teams.

The two passes SHALL be presented as **two labelled groups**, never merged into one list, because
they have different match semantics (a literal ladder on-device — exact key, title prefix, title
substring, body substring, partial key, then a strict word-prefix abbreviation — against full-text
on the server) and because a
merged list would reorder when the second half arrives.

Work-graph placement: search is a read surface over existing team-scoped entities; it introduces no
new synced entity and no new edge. Sync/permission story: the on-device pass can only see rows the
existing permissioned synced queries already delivered; the server pass carries its own team-scoped
predicate (see "Search cannot reveal that a row exists").

#### Scenario: The first frame costs no network

- **WHEN** a member types a token that appears in the title or description of an issue already
  synced for the current team
- **THEN** the matching row is rendered in the on-device group in the same frame, with no request
  issued to the search route, within the sub-100ms interaction budget

#### Scenario: The server extends what the client cannot hold

- **WHEN** a member searches a token that appears only in a comment body, or only in an issue
  belonging to another of their teams
- **THEN** the hit appears in the "From the server" group after the debounced request resolves, and
  never in the on-device group

#### Scenario: Search still works offline

- **WHEN** the sync connection is not established and a member searches
- **THEN** the on-device group renders its matches normally and the server group is replaced by an
  explicit "on-device results only" state, driven by the existing connection state rather than a
  second one

#### Scenario: A superseded request never overwrites a newer one

- **WHEN** a member types further characters while a server request for an earlier query is still in
  flight
- **THEN** the earlier request is aborted and its response, if it arrives, is discarded — the group
  only ever shows results for the query currently in the input

### Requirement: Late server results never move a row under the keyboard cursor

The result list SHALL be **append-only** across the seam: when the server group arrives, no row above
it SHALL change position, and the keyboard cursor SHALL be anchored to a **result identity**, not to
a list index. Filtering and ordering SHALL be deterministic and owned by the application, not
delegated to a scorer that re-sorts groups when a new group appears.

When the actively-selected row leaves the list because the query narrowed, the cursor SHALL fall to
the first row of the first group — one stated rule, applied everywhere.

Work-graph placement: interaction-only. Permission story: unchanged.

#### Scenario: Arrowing is not disturbed by the server answering

- **WHEN** a member types a query, presses ArrowDown twice to select the third on-device row, and the
  server group then arrives
- **THEN** the same row is still selected, still in the same position, and pressing Enter opens that
  row

#### Scenario: Ordering is deterministic

- **WHEN** the same query is run twice against the same data
- **THEN** the results appear in exactly the same order both times, within and across groups

### Requirement: Search results are fully keyboard-operable and announced

Every search surface SHALL be operable with no pointer: a keyboard shortcut reaches it, typing
filters, Arrow keys move the active row **across group boundaries as one list**, Enter opens the
active result, and Escape dismisses and restores focus to the previously focused element. Group
headings SHALL be exposed structurally so the seam is conveyed to assistive technology, not only
visually. The result state SHALL be announced through a **single** polite live region, so a
late-arriving group cannot interrupt a user mid-navigation.

Every colour, font and radius SHALL come from theme tokens, and the active row and its snippet
highlight SHALL meet WCAG AA contrast in all three presets in both light and dark.

#### Scenario: Find and open a result with the keyboard alone

- **WHEN** a member opens the command palette by shortcut, types a query, arrows down into the "From
  the server" group, and presses Enter
- **THEN** the corresponding issue opens, with no pointer interaction at any step

#### Scenario: Escape leaves search without losing the caller's place

- **WHEN** a member presses Escape while results are showing
- **THEN** the surface dismisses and focus returns to the element that was focused before it opened

#### Scenario: The active row is legible in every theme

- **WHEN** a search result row is active in any of the three presets, in light and in dark
- **THEN** its text and its snippet highlight meet AA contrast against the active-row background

### Requirement: Search cannot reveal that a row exists

Search results SHALL respect row-level permissions such that a caller can never learn of the
**existence** of a row they may not read — not by receiving it, not by a count, not by a ranking
artefact, and not by a status difference.

The actor SHALL be derived from the verified session and never from a client-supplied identifier, and
authentication SHALL be checked **before** any table is read. The actor's team set SHALL be resolved
server-side, mirroring the existing team-scoped read predicate including its workspace-admin bypass;
an authenticated non-member's set is empty and yields zero rows. An optional team argument SHALL only
be able to **intersect** that set, never widen it.

A **miss**, an **out-of-scope match**, a blank or too-short query, and a **statement timeout** SHALL
all return the **same status and the same response shape**. The response SHALL carry no total, no
count of withheld rows, and no flag whose value depends on whether any row existed. Snippets SHALL be
generated in the same statement as, and after, the scoping filter — never over a pre-filter
intermediate result.

Work-graph placement: a read path over team-scoped entities. Permission story: deny by empty team
set, mirroring `denyAll`'s empty predicate; auth before existence.

#### Scenario: An out-of-scope hit is indistinguishable from a miss

- **WHEN** a member of team T1 only searches a token that exists solely in an issue in team T2, and
  separately searches a token that exists in no row anywhere
- **THEN** the two responses are byte-identical

#### Scenario: A timeout is indistinguishable from a miss

- **WHEN** the search statement exceeds its per-request timeout
- **THEN** the response carries the same status and the same shape as a query that matched nothing,
  and the timeout is recorded only in the server's own logs and operator-facing signal

#### Scenario: An unauthenticated request is refused before any table is read

- **WHEN** a request reaches the search route with no valid session
- **THEN** it is rejected as unauthorized without reading the index, and the rejection is identical
  whether or not the query would have matched anything

#### Scenario: A team argument cannot widen scope

- **WHEN** a member supplies a team identifier for a team they do not belong to
- **THEN** the effective scope is the empty intersection and the response is identical to a miss

#### Scenario: A workspace admin reads what the read predicate grants, and nothing more

- **WHEN** a workspace admin searches
- **THEN** results cover every team in the workspace, mirroring the existing admin read bypass
  exactly — and no result comes from a source the allowlist excludes

### Requirement: The retrospective anonymity boundary is outside search, structurally

No search path SHALL read, index, join to, or otherwise name any retrospective table — including the
server-only card→author binding, retrospective drafts, cards, votes and actions, and the retrospective
entity's own title. The set of indexable entity types SHALL be an **allowlist**, never a denylist, and
that allowlist SHALL be enforced by the database, not only by application code.

#### Scenario: A retro draft is invisible to everyone, admins included

- **WHEN** a distinctive token exists only in a retrospective draft body, or only in a retrospective
  card body, and any actor — member, facilitator, or workspace admin — searches for it
- **THEN** nothing is returned, in either group

#### Scenario: The allowlist is enforced in Postgres

- **WHEN** a row whose entity type is outside the allowlist is inserted into the index
- **THEN** the database rejects it

### Requirement: Queries are never recorded

The system SHALL NOT persist search queries anywhere: no query log table, no analytics, no "popular
searches", no server-stored recent searches, and no per-person search metrics of any kind. The
request logger SHALL NOT record the query string, and the search route SHALL NOT log it either.

Work-graph placement: an absence. Permission story: a search log would be the first per-person
behavioural record in the product, so it is refused rather than deferred.

#### Scenario: A distinctive query never reaches the logs

- **WHEN** a search request carries a distinctive token in its query string
- **THEN** no log entry produced by the request contains that token

### Requirement: The search index is never an AI data source

The searchable projection contains the text of every indexed description and comment, including
colleagues' names resolved from mention nodes. No AI path SHALL read it. The AI substrate's guarantee
is that a model is fed only team-level aggregates that structurally cannot name a person, and a
searchable projection of every document is exactly the shape that would break it.

#### Scenario: No AI module reaches the index

- **WHEN** the AI gateway, its tools, the digest builders and the cycle-facts readers are inspected
- **THEN** none of them imports the search data module or names the index table

#### Scenario: Search adds no agent tool

- **WHEN** the agent tool registry, which is derived from the shared mutator set, is inspected
- **THEN** it contains no search tool, because search introduces no mutator

### Requirement: What is searchable is decided and stated

The server index SHALL cover exactly two entity types: **issues** (title weighted above description
text) and **comments** (their own body only — the parent issue's title SHALL NOT be folded into a
comment's indexed text, so searching an issue title returns the issue once rather than the issue plus
each of its comments).

Projects, cycles, teams and labels SHALL be searchable **on-device only**, by the same shared ladder
over their names — substring, and the strict word-prefix abbreviation tier below it — over rows
already synced under existing permissioned queries, and SHALL NOT be indexed server-side.

Results SHALL include issues awaiting triage and canceled issues, each **visibly labelled**. Both are
readable, so neither is a permission question; search reports what exists, and lists curate.

#### Scenario: A comment hit is attributed to its issue

- **WHEN** a search matches a comment body
- **THEN** the result identifies the comment's issue by key and title, shows a snippet of the
  comment, and opens that issue when activated

#### Scenario: Searching an issue title does not return its comments

- **WHEN** a member searches a token that appears in an issue title and in none of its comments
- **THEN** exactly one result is returned for that issue

#### Scenario: A canceled issue is found and labelled

- **WHEN** a member searches a token that appears only in an issue whose status is canceled
- **THEN** the issue is returned and rendered with a visible canceled label

#### Scenario: A triage issue is found and labelled

- **WHEN** a member searches a token that appears only in an issue still awaiting triage, which every
  list holds out
- **THEN** the issue is returned and rendered with a visible triage label

### Requirement: A server-only search index maintained off the write path

The system SHALL maintain a **server-only** index table holding plaintext projections of the
allowlisted entities. It SHALL be present in Postgres and in the hand-written Kysely `DB` interface
and **absent from the sync schema**, so no synced query can name it. Its text columns SHALL be plain
text, with the full-text vector computed **inside the index expression**, so nothing exotic enters the
replication path.

Maintenance SHALL NOT run inside the entity write transaction. It SHALL run as a background job on the
**existing** job-scheduler instance — no additional scheduler and no additional container — accepting
a few seconds of index staleness in exchange for leaving the write path untouched. Deletion is the one
exception: removing a comment or an issue SHALL remove its documents immediately, through a database
cascade, so deleted text cannot remain findable.

The job SHALL be idempotent, bounded per pass, and self-healing: an incremental pass follows the
source rows' update watermark, and a slower full pass diffs the index against its sources, removes
orphans, and doubles as the first-boot backfill for an upgraded instance. Re-running any pass SHALL
leave the result set unchanged.

Work-graph placement: a derived projection of issues and comments; it owns no truth and can be dropped
and rebuilt. Sync/permission story: server-only, never synced; every read of it carries the team-scoped
predicate. Its denormalised team reference is sound only because an issue can never change team — the
invariant owned by the notifications change.

#### Scenario: Editing a title does not slow down

- **WHEN** a member edits an issue title
- **THEN** the write performs no index maintenance and completes within the same interaction budget as
  before this change

#### Scenario: A new comment becomes findable without anyone doing anything

- **WHEN** a member posts a comment and waits for the indexing interval
- **THEN** searching a token from that comment returns it from the server group

#### Scenario: A deleted comment stops being findable immediately

- **WHEN** a comment is deleted
- **THEN** its document is removed in the same transaction and it is never returned again, without
  waiting for a sweep

#### Scenario: A fresh upgrade backfills without blocking boot

- **WHEN** an existing instance is upgraded and boots
- **THEN** migrations complete without building the index contents, and the background pass fills it
  in bounded batches while the application serves traffic

#### Scenario: Re-running the indexer changes nothing

- **WHEN** the indexing pass is run repeatedly over unchanged data
- **THEN** the document set and every search result set are identical after each run

#### Scenario: A row missed by the watermark is healed

- **WHEN** a source row is written with an update timestamp behind the index watermark
- **THEN** the full reconcile pass detects the mismatch and re-indexes it

### Requirement: Language-neutral text search by default, changeable without a manual reindex

The text-search configuration SHALL default to the language-neutral `simple` configuration rather than
an English-specific one, and SHALL be settable by environment variable. Because an expression index is
built with a literal configuration, changing the variable SHALL cause the background job to **rebuild
that one index** so the setting cannot silently stop the index from being used.

The configured value SHALL be validated for shape at startup, failing fast by name, and verified to
exist in the database before any statement or DDL uses it. An unknown value SHALL fail loudly and
leave the existing index in place rather than taking search down.

#### Scenario: The default is language-neutral

- **WHEN** an instance boots with no search configuration set
- **THEN** the index and every query use the `simple` configuration, applying no English stemming or
  stopword list

#### Scenario: Changing the configuration rebuilds the index

- **WHEN** an operator sets a different valid text-search configuration and restarts
- **THEN** the background job detects that the live index does not match and rebuilds it once, after
  which queries use the new configuration

#### Scenario: An unknown configuration does not take search down

- **WHEN** the configured text-search configuration does not exist in the database
- **THEN** the rebuild step fails with a message naming the variable, the previous index remains, and
  search continues to answer

### Requirement: One entry point, two depths

The command palette SHALL remain the only global keyboard entry point to search — no second shortcut.
It SHALL show a capped number of results per group plus a persistent row that opens a full search
route, and that route SHALL be a real URL carrying the query, so a search is shareable and the browser
back button behaves.

The palette SHALL search the currently-open team in **both** of its groups, so the two groups mean the
same scope. The full route SHALL search **every team the caller may read**.

#### Scenario: Escalate from the palette to the full route by keyboard

- **WHEN** a member types a query in the palette and activates the "search everything" row with Enter
- **THEN** the full search route opens carrying the same query in its URL, with no pointer interaction

#### Scenario: A search URL is shareable and reversible

- **WHEN** a member opens a search URL directly, then navigates to a result and presses the browser
  back button
- **THEN** the same query and the same results are restored

#### Scenario: The palette's two groups agree about scope

- **WHEN** a member searches from the palette while a team's issue list is open
- **THEN** both groups are limited to that team, and results from other teams appear only on the full
  route

### Requirement: Search states are explicit, including the ones that are nobody's fault

Every non-result state SHALL say what is happening rather than rendering an empty box: a query too
short to search the server, a request in flight, an answered request with no further matches, no
matches at all, an offline server pass, and a capped result set. None of these states SHALL be
computed from a rule that depends on whether a row the caller cannot read existed.

#### Scenario: A one-character query does not hit the server

- **WHEN** a member has typed fewer than two non-whitespace characters
- **THEN** the on-device group renders and the server group says it is waiting for more input, with no
  request issued

#### Scenario: Nothing found says so once

- **WHEN** both passes complete with no matches
- **THEN** exactly one empty state is shown, naming the query, suggesting different words, and noting
  that recently edited items can take a few seconds to appear

#### Scenario: A capped result set invites refinement

- **WHEN** the server pass returns its maximum number of results
- **THEN** the surface says the list is capped and invites the member to refine the query, and offers
  no pagination

### Requirement: Snippets are rendered as text, never as markup

Result snippets SHALL be produced by the database with non-markup delimiters and rendered as
segmented text. No component SHALL interpolate database-produced snippet output as HTML.

#### Scenario: A comment containing markup is highlighted safely

- **WHEN** a comment body contains characters that look like markup and a snippet of it is rendered
- **THEN** the characters are shown as literal text, the matched term is visually emphasised, and no
  markup is interpreted
