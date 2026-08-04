# mentions Specification

## Purpose
TBD - created by archiving change mentions. Update Purpose after archive.
## Requirements
### Requirement: Mentions are stored as an id reference inside the existing rich-text document

A mention SHALL be persisted as a TipTap node inside the existing `issue.description` and
`comment.body` JSON columns, of the shape `{type:'mention', attrs:{id, label,
mentionSuggestionChar}}`. The `id` SHALL be the mentioned user's identifier and SHALL be
authoritative; `label` SHALL be a fallback hint only. No mention SHALL be stored as a display-name
string.

Rendering SHALL always resolve the displayed name from the live synced `user` row identified by
`id`, never from the stored `label`, so that a rename propagates to every existing document and a
hand-crafted `label` cannot make a mention appear to name someone it does not.

Work-graph placement: a mention is an attribute *inside* an existing team-scoped `issue` or
`comment` document; it introduces no new synced entity and no new edge in the work graph.
Sync/permission story: a mention is readable by exactly the people who can already read the
document containing it, under the unchanged `teamScoped` predicate — mentions add no read surface.

#### Scenario: A renamed user's existing mentions update

- **WHEN** a user who is mentioned in an existing description or comment changes their display name
- **THEN** every rendering of every document mentioning them shows the new name, because the name is
  resolved from the live user row by id

#### Scenario: A crafted label cannot spoof a colleague

- **WHEN** a stored document contains a mention node whose `id` is one user and whose `label` is a
  different user's name
- **THEN** the rendered mention shows the name belonging to the `id`, and the stored `label` is
  ignored

#### Scenario: An unresolvable or ineligible mention renders inert

- **WHEN** a document contains a mention whose `id` resolves to no known user, or to a user who
  cannot read the containing issue
- **THEN** it renders as plain, unlinked `@Name` text with no chip styling and no interaction, and
  produces no notification

### Requirement: A shared sanitizer normalises mention nodes on every write path

The four write paths that accept a rich-text document — issue create, issue update, comment create
and comment edit — SHALL pass the document through a single shared sanitizer defined in
`packages/schema` and executed in the **shared** mutator body, so that the optimistic client
document and the authoritative server document are identical.

The sanitizer SHALL normalise every mention node to exactly `{id, label, mentionSuggestionChar}`,
dropping unknown attributes, trimming and length-capping `label`, and degrading a node whose `id` is
absent or not a non-empty string into plain text. It SHALL retain `mentionSuggestionChar` so that
documents written today round-trip if a second trigger character is ever added. The sanitizer SHALL
be a pure, deterministic function of its input and SHALL mint no identifier.

#### Scenario: Unknown attributes are dropped

- **WHEN** a document containing a mention node with additional unexpected attributes is saved
- **THEN** the persisted node carries only `id`, `label` and `mentionSuggestionChar`

#### Scenario: A mention with no id degrades to text

- **WHEN** a document containing a mention node whose `id` is empty or missing is saved
- **THEN** the persisted document contains plain text in its place and no mention node

#### Scenario: Client and server agree on the stored document

- **WHEN** a mention is inserted and the mutation is applied optimistically and then authoritatively
- **THEN** both passes produce the same document, and no visible rewrite of the user's text occurs
  on rebase

### Requirement: Pure document walkers with no rich-text-editor dependency

`packages/schema` SHALL provide `richTextToPlainText(doc, options?)` and `extractMentionIds(doc)`
as pure recursion over the document JSON, with **no import of any TipTap or ProseMirror package**,
so that the "packages/schema has no UI dependencies" boundary continues to hold under
`scripts/check-boundaries.mjs`.

`extractMentionIds` SHALL return the mention ids in document order, deduplicated.
`richTextToPlainText` SHALL render a mention as `@` followed by its resolved display name when a
name map is supplied, falling back to the stored label and then to nothing.

`richTextToPlainText` SHALL additionally support a mode that **omits mention nodes entirely**, and
this mode SHALL be the required form for any caller that feeds document text to a language model.

#### Scenario: The walkers hold the package boundary

- **WHEN** the boundary check runs over `packages/schema`
- **THEN** it reports no violation, because the walkers import no editor package

#### Scenario: Mention ids are extracted in order without duplicates

- **WHEN** a document mentions the same user twice and another user once
- **THEN** `extractMentionIds` returns each id exactly once, in first-appearance order

#### Scenario: An empty or mention-free document yields no ids

- **WHEN** a document written before mentions existed is walked
- **THEN** `extractMentionIds` returns an empty array, so no historical document retroactively
  notifies anyone

### Requirement: Model-facing reads must strip mention nodes

No data path that supplies text to a language model SHALL read `issue.description` or
`comment.body` without first removing mention nodes. Any such caller SHALL use the
mention-omitting mode of `richTextToPlainText`.

This preserves the existing guarantee that the model's context contains no per-person data by
construction: mention nodes are the first mechanism that places colleagues' names inside those two
columns, so the rule ships with the mechanism rather than after it.

#### Scenario: The current AI paths read neither column

- **WHEN** the AI substrate's fact-gathering and tool-definition modules are inspected
- **THEN** none of them reads `issue.description` or `comment.body`, and the team-scoped narrowed
  read that feeds the model still carries no person-identifying field

#### Scenario: An agent-authored mention is subject to the same rules

- **WHEN** an agent acting as a user creates or edits a comment whose body contains mention nodes
- **THEN** the document passes through the same shared sanitizer and the same server-side
  eligibility check, so the agent cannot mention a person who cannot read the issue

### Requirement: Server-side eligibility mirrors the team-scoped read predicate

Whether a person may be mentioned on an issue SHALL be decided **server-side**, in the authoritative
mutator pass, and SHALL be exactly the predicate that governs reading the issue: a **workspace
admin**, **or** a member of the **issue's team**. It SHALL be evaluated with authorization before
existence, denying by omitting the candidate from the eligible set, never by an error that
distinguishes an unknown user from a disallowed one.

A mention of a person who fails this check SHALL produce **no notification, no email, and no
subscription** — the mention node remains in the document and renders inert.

The check SHALL be batched over the whole candidate set rather than evaluated per candidate, and the
candidate set SHALL be bounded, because it is evaluated inside the triggering mutation's own
database transaction.

#### Scenario: A workspace member who is not on the team is not notified

- **WHEN** a comment mentions a workspace member who is not a member of the issue's team and is not
  an admin
- **THEN** no notification row, no email and no subscription is created for them

#### Scenario: A workspace admin who is not on the team is notified

- **WHEN** a comment mentions a workspace admin who is not a member of the issue's team
- **THEN** they are notified, because they can read the issue

#### Scenario: A client-side bypass is ineffective

- **WHEN** a document containing a mention of an ineligible person is written by a modified client
  or through the API directly
- **THEN** the server still produces no event for them, because eligibility is decided in the
  authoritative pass and not in the UI

### Requirement: An edit notifies only newly added mentions, exactly once

Mention notifications SHALL be produced only in the server-authoritative mutator pass, guarded so
that a client-location transaction produces none, and written through the same transaction as the
document change so the two commit or roll back together.

The recipient set SHALL be the **difference between the mention ids in the previous stored document
and the mention ids in the new one**, minus the actor, filtered by eligibility, and truncated to the
shared recipient cap.

The notification's identity SHALL be stable across edits of the same document: the event key SHALL
be the comment's own identifier for a comment mention, and a fixed sentinel for an issue
description. Consequently a person is notified **at most once per comment** and **at most once per
issue description**, whatever sequence of edits occurs.

At the recipient cap, the excess recipients SHALL simply not be notified: the write SHALL NOT fail,
SHALL NOT partially roll back, and the document SHALL still save with every mention node intact.

#### Scenario: Adding a mention in an edit notifies only the new person

- **WHEN** a comment mentioning one person is edited to mention a second person as well
- **THEN** exactly one new notification is created, for the newly mentioned person

#### Scenario: Re-saving an unchanged document notifies nobody

- **WHEN** a document containing mentions is saved again with no change to its mentions
- **THEN** no notification is created

#### Scenario: Removing and re-adding a mention does not notify twice

- **WHEN** a mention is removed from a saved document and later added back
- **THEN** the person is not notified a second time, because the event identity is unchanged

#### Scenario: Self-mentions are silent

- **WHEN** an author mentions themselves
- **THEN** no notification is created for them

#### Scenario: A rebased client pass creates nothing

- **WHEN** a mutation that would fan out mentions is re-run on the client during rebase
- **THEN** no notification and no subscription is created, because both are written only in the
  server-authoritative pass

### Requirement: The typeahead offers team members first and admins only on an explicit match

The mention typeahead SHALL be a synchronous filter over rows the sync engine has **already
replicated**, returning an array rather than a promise, so that no keystroke waits on the network.

Candidacy SHALL be narrower than eligibility: the list SHALL offer **members of the issue's team**
by default, and a workspace admin who is not a team member SHALL appear **only** when the typed
query prefix-matches their display name or email local part, ranked after every team member.

Matching SHALL be deterministic and unit-tested: case-insensitive and diacritic-insensitive,
prefix matches ranked above substring matches, over display name and email local part, with a stable
alphabetical tiebreak.

The trigger SHALL NOT fire mid-word — so an email address typed in prose does not open the popup —
and SHALL NOT fire inside a code block or inline code.

#### Scenario: Typing @ offers the team, instantly and offline

- **WHEN** a member types `@` in a description or comment while offline
- **THEN** the list of the issue's team members appears immediately, filtered from already-synced
  data with no network request

#### Scenario: An admin outside the team surfaces only on a name match

- **WHEN** a member opens the mention list without typing a query
- **THEN** only members of the issue's team are offered; typing the prefix of a non-member admin's
  name or email additionally offers that admin, ranked last

#### Scenario: An email address in prose does not open the popup

- **WHEN** a member types `someone@example.com` in a comment
- **THEN** no mention popup opens

#### Scenario: Code spans do not trigger mentions

- **WHEN** a member types `@` inside inline code or a code block
- **THEN** no mention popup opens

### Requirement: The interface states why a name cannot be mentioned

When the typed query matches a workspace user who is **not eligible** to be mentioned on this issue,
the list SHALL show that person as a reachable but non-selectable option with a stated reason,
rather than omitting them silently. Pressing the accept key on such an option SHALL insert nothing
and SHALL announce the reason.

When the query matches nobody at all, the list SHALL show an explicit empty state naming the query.

This exposes no information that is not already synced to every workspace member: the full user
table and every team's membership already replicate to every member's client.

#### Scenario: An ineligible match explains itself

- **WHEN** a member types the name of a workspace colleague who is not on the issue's team
- **THEN** that person appears as a disabled option stating that they are not on this team and
  cannot be mentioned here

#### Scenario: A disabled option cannot be inserted

- **WHEN** the active option is a disabled, ineligible person and the member presses the accept key
- **THEN** no mention is inserted, the popup stays open, and the reason is announced to assistive
  technology

#### Scenario: No match at all is stated, not blank

- **WHEN** the typed query matches nobody
- **THEN** the list shows an explicit empty state naming the query rather than closing silently

### Requirement: Exactly one trigger character ships, over an array-shaped path

Exactly one trigger character, `@`, addressing exactly one recipient type, SHALL ship. No group
target (`@team`, `@here`), no issue reference (`#123`), and no label or project trigger SHALL be
implemented.

The extension configuration and the recipient path SHALL nonetheless be **array-shaped end to end**
— a list of triggers, and a list of recipients per resolved mention — so that a later change may add
a trigger, or fan one mention out to many recipients, without restructuring this one.

#### Scenario: Only the one trigger exists

- **WHEN** a member types any trigger character other than `@`
- **THEN** no mention popup opens

#### Scenario: The path is shaped for more than one recipient

- **WHEN** the mention recipient computation is inspected
- **THEN** it produces and consumes a list of recipients per resolved mention, so a group target
  would be an added producer rather than a signature change

