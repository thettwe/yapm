# issue-detail Specification

## Purpose
One issue, read in two registers: a plain line a product reader can follow above a mono fact line an
engineer can act on, with the change's whole journey drawn once as a vertical delivery rail — idea,
change opened, reviewed, merged, live — and the board's disagreement with git surfaced as a callout
that offers the repair. Blocks with no entity behind them fold away rather than being staged. The
same body serves the full route and the list's side sheet. Archived from change issue-core and
rebuilt by issue-detail-bridge (PR #35).

## Requirements
### Requirement: Issue detail surface

The system SHALL provide an issue detail surface (a route and/or panel) that displays a single issue's key, title, status, priority, assignee, labels, description, and comment thread, rendered strictly against theme tokens and reading from a team-scoped synced query. The surface SHALL show the delivery seam for the issue drawn from the reality-vocabulary capability: for a linked issue it SHALL show the live PR state, CI health, review age and the deployment fact, with divergence drawn as the `//` break when the human-set status disagrees with git reality; for an unlinked issue it SHALL show the quiet unlinked state. On this surface the delivery seam SHALL be drawn as the **vertical rail**, at full measure, and SHALL NOT additionally be drawn as a horizontal track in a properties field — the same facts SHALL NOT be drawn twice on one page. The surface SHALL NOT draw delivery reality as a strip of provider icons, SHALL NOT render a separate warning symbol for divergence, and SHALL NOT declare a CI health drawing of its own. It SHALL distinguish a still-loading issue from a genuinely-missing one, only showing "not found" once the query result is complete.

The surface SHALL retain, in both its sheet and its full-page form, every capability it carries: the rich-text description with autosave, mentions and image attachments; the Files section; the comment thread with its composer; the properties block covering status, priority, assignee, cycle and labels; and the follow control, in the properties block in the sheet and in band 2 on the full page. The follow control SHALL be mounted exactly once per rendered surface.

Work-graph placement: a view over a single team-scoped `issue`, its related `comment`, `issue_label`, `assignee`, and `creator`, and its linked delivery entities (`pull_request` via `issue_link`, and through it `ci_check` and `review`; `deployment` carries no per-issue edge and is read team-scoped, matched to the issue by the linked pull requests' merge commits). Sync/permission story: the detail synced queries return the issue and its team-scoped linked entities only to members of its team, denied by empty query otherwise, so a non-member cannot distinguish a private issue from a nonexistent one.

#### Scenario: Member opens an issue

- **WHEN** a member opens an issue in their team
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, and comments, with the delivery rail rendered

#### Scenario: Member opens a linked issue

- **WHEN** a member opens an issue in their team that is linked to a pull request
- **THEN** the detail surface shows its key, title, status, priority, assignee, labels, description, comments, and the delivery rail drawing live PR state, CI health, review age and the deployment fact

#### Scenario: Member opens a diverged issue

- **WHEN** a member opens an issue whose human-set status disagrees with git reality
- **THEN** the detail surface draws the `//` break on the rail, states the divergence sentence, and renders no warning symbol

#### Scenario: Member opens an unlinked issue

- **WHEN** a member opens an issue with no linked git entities
- **THEN** the detail surface shows the delivery rail in its quiet unlinked state

#### Scenario: The delivery seam is readable without a pointer

- **WHEN** a member reaches the detail surface's delivery seam using the keyboard alone
- **THEN** every delivery fact it draws is present at rest, with nothing revealed only on hover

#### Scenario: Missing versus loading is distinguished

- **WHEN** an issue key or id resolves to no visible row
- **THEN** the surface shows "not found" only after the query result is complete, and shows a loading state before that, never flickering a false 404

#### Scenario: Non-member cannot open another team's issue

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the detail query returns empty and the surface shows "not found" without revealing the issue's existence

#### Scenario: No capability is lost in the rebuild

- **WHEN** a member uses the detail surface to edit the description, upload a file, mention a teammate, post a comment, change status, priority, assignee, cycle or labels, or toggle the follow control
- **THEN** each behaves exactly as it did before this change, in both the sheet and the full page

### Requirement: Rich description editing

The detail surface SHALL edit the issue description in a TipTap-v3 rich-text editor, persisting the document as JSON through the shared update mutator with optimistic application. Editing SHALL be last-write-wins; there is no real-time collaborative editing of a description. Description editing SHALL be reachable and operable by keyboard.

Work-graph placement: the description is an attribute of the team-scoped `issue`. Permission story: editing is gated by team-scoped `canWrite`; viewers may read the rendered description but cannot edit it.

#### Scenario: Edit and save the description

- **WHEN** a member edits the description and confirms
- **THEN** the change applies optimistically and persists as a TipTap JSON document via the shared mutator

#### Scenario: Viewer cannot edit the description

- **WHEN** a `viewer` opens an issue
- **THEN** the description renders read-only and no edit affordance accepts a write

### Requirement: Inline metadata editing

The detail surface SHALL allow editing status, priority, assignee, cycle, and labels inline, each through the shared mutators with optimistic application, and each fully keyboard-operable. Assignee selection SHALL be limited to members of the issue's team, and label selection to the team's labels.

Work-graph placement: edits to attributes and edges of the team-scoped `issue`. Permission story: each edit is gated by team-scoped `canWrite`; assignee and label choices are constrained to the issue's team.

#### Scenario: Change status, priority, assignee, and labels by keyboard

- **WHEN** a member changes status, priority, assignee, or labels via the inline controls using only the keyboard
- **THEN** each change applies optimistically through the shared mutator with no pointer interaction

#### Scenario: Assignee choices are team-scoped

- **WHEN** a member opens the assignee control
- **THEN** only members of the issue's team are offered as assignees

### Requirement: Comment thread

The detail surface SHALL present the issue's comments in chronological order and allow a member to post, edit (own or as admin), and delete (own or as admin) comments through the shared mutators with optimistic application, fully keyboard-operable. Comment bodies SHALL be edited in the TipTap rich-text editor and stored as JSON.

Work-graph placement: `comment` rows hanging off the open `issue`. Permission story: posting is gated by team-scoped `canWrite`; editing/deleting requires author-or-admin, checked before existence; viewers read but cannot post.

#### Scenario: Post a comment by keyboard

- **WHEN** a member types a comment and submits it with the keyboard
- **THEN** the comment appears optimistically in the thread and persists via the shared mutator with `author` from `ctx`

#### Scenario: Edit restricted to author or admin

- **WHEN** a user who is neither author nor admin attempts to edit or delete a comment
- **THEN** the action is rejected as not authorized without revealing the comment's existence

#### Scenario: Viewer cannot comment

- **WHEN** a `viewer` opens the issue
- **THEN** the comment composer is unavailable and any post attempt is rejected as not authorized

### Requirement: Mentioning teammates from the description and the comment thread

The detail surface SHALL support `@`-mentions in the description editor, the comment composer and
the comment editor, supplying candidates from the team member list the surface already builds for
the assignee control — no additional query and no network request on the keystroke.

Mentions SHALL be inserted, navigated and dismissed by keyboard alone. Dismissing the mention popup
SHALL NOT discard the draft being written or close the detail surface.

Rendered mentions in a saved description or comment SHALL display the mentioned person's current
name, resolved from synced data, and SHALL be non-interactive text rather than a link or a tab stop
— there is no person route in this version, and a link would inject focus stops into the middle of
prose.

Work-graph placement: mentions live inside the existing team-scoped `issue.description` and
`comment.body` documents; no new entity is introduced on this surface. Permission story: mention
candidates and mention notifications are constrained to people who can already read the issue, and
the constraint is enforced server-side rather than by the control.

#### Scenario: Mention a teammate in a comment by keyboard

- **WHEN** a member types `@`, types part of a teammate's name, and presses Enter
- **THEN** a mention is inserted into the draft with no pointer interaction, and posting the comment
  notifies that teammate once

#### Scenario: Dismissing the popup preserves the draft

- **WHEN** a member has typed a comment, opens the mention popup, and presses Escape
- **THEN** the popup closes while the drafted comment text and the detail surface both remain

#### Scenario: A mention chip is not a tab stop

- **WHEN** a member tabs through a rendered description containing mentions
- **THEN** focus does not stop on the mentions

#### Scenario: A viewer sees mentions but cannot write them

- **WHEN** a `viewer` opens an issue
- **THEN** rendered mentions display normally and no editor is available in which to create one —
  while the follow control remains available to them, because a viewer can be mentioned and must be
  able to stop following

### Requirement: Following an issue is visible and reversible from the issue itself

The detail surface SHALL show whether the viewer currently follows the issue and SHALL let them
toggle it, fully keyboard-operable, with its state exposed to assistive technology.

When the viewer follows the issue, the surface SHALL make clear that they will receive updates and
how to stop, so that a subscription created automatically by a mention is discoverable and
reversible from the thing it subscribes them to.

The control SHALL reflect only the viewer's own subscription. No follower count and no list of who
follows the issue SHALL be shown to anyone, including a workspace admin.

#### Scenario: A mentioned person finds and uses the unfollow control

- **WHEN** a person who was auto-subscribed by a mention opens the issue and reaches the control by
  keyboard
- **THEN** the control shows that they are following, and activating it stops further updates for
  them

#### Scenario: Following state updates within the interaction budget

- **WHEN** the control is activated
- **THEN** its state changes optimistically without waiting on the network

#### Scenario: No follower list is exposed

- **WHEN** any user, including a workspace admin, opens the issue
- **THEN** no follower count and no subscriber list is rendered

### Requirement: Issue Files section

The issue detail surface SHALL show a Files section listing the attachments belonging to that issue,
read from the existing team-scoped synced attachment query. Each row SHALL show the filename, its
size, who uploaded it and when, a download affordance, and — for a member with write access — a
remove affordance. Removal SHALL go over the existing authenticated file route; there is no
attachment mutator and this change adds none.

Files uploaded from inside the description or a comment SHALL appear in this list, because they are
rows in the same table anchored to the same issue.

Work-graph placement: `attachment` rows anchored to a team and to this issue. Sync/permission story:
unchanged — rows reach a client only through the team-scoped synced query, so a non-member's list is
empty rather than forbidden, and byte access is decided by the file route, not by the list.

#### Scenario: A member sees the issue's files

- **WHEN** a member opens an issue that has attachments
- **THEN** the Files section lists each one with its filename, size, uploader and upload time

#### Scenario: An image inserted in the description appears in Files

- **WHEN** a member pastes an image into the description and it uploads successfully
- **THEN** that file appears in the Files section for the same issue

#### Scenario: A viewer can download but not remove

- **WHEN** a `viewer` opens an issue with attachments
- **THEN** each file is downloadable and no remove affordance accepts a write

#### Scenario: The empty state is quiet and actionable

- **WHEN** an issue has no attachments
- **THEN** the Files section shows a single quiet line and an upload control, rather than an empty
  box or nothing at all

#### Scenario: The section is fully keyboard-operable

- **WHEN** a user with no pointer tabs into the Files section
- **THEN** every row's download and remove controls are reachable and activatable by keyboard, each
  with an accessible name identifying its file, and remove asks for confirmation before deleting

#### Scenario: A non-member's direct navigation reveals nothing

- **WHEN** a non-member navigates directly to an issue in a team they do not belong to
- **THEN** the attachment query returns empty and the Files section reveals no filename, count or
  existence

### Requirement: A description the local bundle cannot hold is read-only and says so

The detail surface's description editor SHALL refuse to autosave when the loaded description
contains content the running bundle cannot represent, and SHALL show a reload affordance in place of
the editor. Because the description autosaves on a debounce, this refusal is what stops a stale tab
from overwriting the stored description with a pruned copy.

#### Scenario: A stale tab cannot overwrite a newer description

- **WHEN** a tab running an older bundle has an issue open whose description has since gained content
  that bundle does not know, and the user types in that tab
- **THEN** no debounced autosave runs, no update mutator is called, and the stored description is
  unchanged

#### Scenario: The reason and the remedy are on screen

- **WHEN** the description is in that refused state
- **THEN** the surface explains that the description was edited in a newer version and offers a
  reload control, reachable and activatable by keyboard

#### Scenario: Every other field still saves

- **WHEN** the description is refused but the issue's status, priority, assignee or labels are edited
- **THEN** those edits apply and persist as normal — the refusal is scoped to the description
  document, not to the issue

### Requirement: The detail states its reality in two registers

The issue detail SHALL state the issue's delivery reality **twice, in two registers, from one
derivation**: a plain-language line naming the status, the cycle, the labels and the phrase at
rest, and directly beneath it a **mono fact line** naming the same facts as the change's own
identifiers — the merge commit, the change's number, and the age of the disagreement when one
exists.

Both lines SHALL be derived from a single delivery-signal computation for the issue, so the two
registers can never state different facts about the same moment. The plain line's phrase SHALL
come from the shared phrase dictionary defined in the reality-vocabulary capability; the detail
SHALL NOT declare a second vocabulary. Where the dictionary is silent for the issue's predicates,
the plain line SHALL end rather than render filler.

The mono register is permitted on this surface and SHALL NOT be introduced on the list, the board
or the team home. A provider's mark MAY suffix a fact the provider sourced, under the dictionary's
existing provenance rule, and SHALL NOT replace a status arc or take the urgent ink.

Work-graph placement: a view over the team-scoped `issue` and its linked `pull_request` /
`ci_check` / `review` / `deployment` rows. Permission story: unchanged — every fact derives from
rows the caller already syncs.

#### Scenario: A merged-but-not-done issue says so in both registers

- **WHEN** a member opens an issue whose linked change has merged while the issue is still in
  progress
- **THEN** the plain line states the status, the cycle and the phrase at rest, and the mono line
  directly beneath it names the merge commit and the change's number, and the two agree

#### Scenario: An unlinked issue states only what is true

- **WHEN** a member opens an issue with no linked change
- **THEN** the plain line states the status, cycle and labels and stops, and no mono fact line
  claims a commit, a change or a divergence

### Requirement: The delivery rail draws idea to live, and folds what nothing backs

The issue detail SHALL draw the issue's delivery chain as the **vertical rail** defined in the
reality-vocabulary capability, with a sentence and a mono fact line at each station.

A station SHALL be rendered **only** when a durable stored timestamp supports it. The stations
SHALL be, in order: the idea (the issue's creation, and its planning into a cycle when the issue
carries a cycle-assignment moment), the change being opened, the review, the merge, and the
deployment — the last stated as **live** when a successful deployment carried the merge commit and
as **not live yet** when none did.

The rail's header SHALL state only the chain the rail can draw. A station with no entity behind it
— in particular a design stage, which no entity in this product backs — SHALL NOT appear, and the
header SHALL NOT name it.

The rail SHALL carry an accessible description naming the stations actually drawn, in order, and
SHALL NOT summarise a station that folded away. The rail SHALL declare the surface it is drawn on,
so its nodes and its `//` break do not paint page colour into the panel beneath them.

The rail SHALL NOT declare a node kind, segment kind or break drawing of its own; every one SHALL
come from the shared vocabulary.

#### Scenario: A merged, undeployed change draws its whole chain

- **WHEN** a member opens an issue planned into a cycle whose change was opened, reviewed, merged
  with every check passing, and never deployed
- **THEN** the rail draws the idea, change-opened, reviewed and merged stations with their facts,
  ends at a **not live yet** station, and the `//` break falls where the board and git disagree

#### Scenario: The design station never appears

- **WHEN** a member opens any issue
- **THEN** no design station is drawn and the rail's header does not name one

#### Scenario: An issue with no linked change draws only what it has

- **WHEN** a member opens an issue with no linked change
- **THEN** the rail draws the idea station and no change, review, merge or deploy station, and its
  accessible description names only the station drawn

### Requirement: The divergence callout carries evidence and two working actions

When the issue's human-set status disagrees with git reality, the detail SHALL render a callout
that states the disagreement in words, shows the **evidence** as a mono line contrasting the
moment a human last set the status with the moment the change merged, and offers **two actions**,
both operable by keyboard alone.

The first action SHALL set the issue's status through the same shared mutator every other status
edit uses, applying optimistically. The second SHALL dismiss the callout **for this reader's
current visit only**, and SHALL NOT change any stored fact, SHALL NOT suppress the divergence
elsewhere on the page, and SHALL NOT claim the disagreement has been resolved.

The callout's keyboard shortcuts SHALL be bound within the callout's own focus scope and SHALL NOT
be registered as document-level listeners.

The divergence SHALL also be announced in the masthead as a labelled pill carrying the
dictionary's text; it SHALL NOT be conveyed by colour alone.

#### Scenario: Marking done from the callout

- **WHEN** a member focuses the callout and activates its confirm action with the keyboard
- **THEN** the issue's status changes optimistically through the shared mutator, and the callout,
  the pill and the `//` break all resolve because the fact they reported is no longer true

#### Scenario: Keeping the status as it is

- **WHEN** a member dismisses the callout
- **THEN** the callout closes, no write is issued, and the divergence pill, the `//` break and the
  phrase at rest all remain, because the disagreement is still true

#### Scenario: A viewer sees the divergence but cannot act on it

- **WHEN** a `viewer` opens a diverged issue
- **THEN** the divergence is stated and no action offered to them accepts a write

### Requirement: The activity feed reports only durable work-graph moments

The detail SHALL present an activity feed built **only** from stored timestamps on the work graph:
the issue's creation, its assignment into a cycle, its linking to a change (with the source of that
link), the change being opened, each review being submitted, the merge, and the deployment.

The feed SHALL NOT report a board status transition. This product stores only the moment a human
last set a status, not which status nor what preceded it, so a status-history entry would be an
invention. The feed and the delivery rail SHALL read the **same** derivation, so no moment is dated
two ways on one page.

The feed SHALL NOT state a duration a stored fact cannot support: check runs carry no start or
finish time, and there is no review-requested event, so no entry SHALL claim how long a check took
or how long a reviewer has been waiting.

Work-graph placement: a derivation over the team-scoped `issue` and its linked `issue_link`,
`pull_request`, `review`, `ci_check` and `deployment` rows. Permission story: unchanged — every
moment derives from rows the caller already syncs.

#### Scenario: The feed reports the linking of a change and how it was found

- **WHEN** a member opens an issue whose change was linked by a branch name
- **THEN** the feed reports the moment it was linked and names the branch as the source

#### Scenario: No status history is fabricated

- **WHEN** a member opens an issue whose status has been changed several times
- **THEN** the feed reports no status transition of any kind

#### Scenario: The rail and the feed agree

- **WHEN** a member opens an issue whose change has merged
- **THEN** the merge is dated identically in the rail and in the feed

### Requirement: Blocks with no entity behind them fold away

The detail SHALL render a references block **only** when there is something real to reference —
the issue's linked changes with the source of each link, and the artefacts already anchored to the
issue. With nothing to show, the block SHALL fold away entirely rather than render a header over an
empty region or an invented backlink.

The detail SHALL NOT show a design artefact, a cross-issue backlink, a mention backlink, a retro
action or a count of comments made outside this product, because no entity, edge or query in this
product supports any of them.

#### Scenario: An issue with no linked change shows no references block

- **WHEN** a member opens an issue with no linked change and no attachments
- **THEN** no references block, header or empty state is rendered

#### Scenario: A linked issue names how the link was made

- **WHEN** a member opens an issue linked to a change
- **THEN** the references block names the change and the source of the link

### Requirement: An issue is addressed by its key, resolved rather than scanned

The detail route SHALL resolve its `issueKey` segment through a **team-scoped synced query keyed
on the team and the issue's number**, carrying the identical read predicate as the team's other
issue queries, so it can neither widen a read beyond the caller's teams nor surface an issue the
list holds back.

The segment SHALL be accepted as the team's own key followed by the issue's number, or as the bare
number. A segment whose prefix is not this team's key SHALL resolve to not-found. The route SHALL
NOT resolve a key by scanning the team's issues, and SHALL NOT require the team's whole issue set
to be synced in order to render one issue.

Loading SHALL remain distinguishable from missing: not-found SHALL be shown only once the query
result is complete.

#### Scenario: A deep link resolves one issue

- **WHEN** a member opens a URL carrying an issue's key on a client that has not synced the team's
  issue list
- **THEN** the issue renders, and the team's whole issue list is not required to resolve it

#### Scenario: Another team's key does not resolve

- **WHEN** a member opens a URL whose key prefix belongs to a different team than the route's
- **THEN** the surface shows not-found and reveals nothing about the other team's issue

#### Scenario: The bare-number form still resolves

- **WHEN** a member follows the detail sheet's "open full view" affordance
- **THEN** the full page resolves the same issue

### Requirement: The sheet and the full page share one body

The issue detail SHALL be implemented as **one** body rendered at two measures: the `?open=`
sheet over the issue list, and the full page. Every capability SHALL be present in both, and a
change to a section SHALL affect both without being written twice.

#### Scenario: Opening an issue from the list

- **WHEN** a member opens an issue from the list without leaving the list
- **THEN** the sheet renders the same sections the full page renders, at the sheet's measure

