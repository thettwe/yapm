# team-home Specification

## Purpose
The team page is the morning digest: an adaptive, offline-rendering composition of
work-graph facts already on the device. Archived from change team-home-digest (PR #31).
## Requirements

### Requirement: The team page is an adaptive digest composed from synced work-graph facts

`/teams/{teamId}` SHALL render the team Home digest: an ordered composition of bands —
hero, NEEDS ATTENTION, SINCE YESTERDAY, YOURS, READY FOR YOU, SHIP CADENCE, SHIPPED THIS
CYCLE, then a composed mono footline and an onward footer (Issues · Delivery · Retro ·
Roadmap, with a ⌘K hint). Every fact on the page SHALL be derived from rows the client has
already synced through existing team-scoped or self-scoped queries; the page SHALL add no
new synced table and no new named query, and SHALL make no network request to render. All
derivations SHALL be pure functions in `packages/schema`, computed client-side.

Every band SHALL render only when it has content: an empty band folds away entirely — no
header, no empty-state apology. The digest SHALL remain a complete, honest page when *every*
optional band folds.

#### Scenario: A working morning composes the full page

- **WHEN** a member opens their team's Home while the team has an active cycle, exception
  issues, recent deployments, work assigned to the viewer, and unassigned ready work
- **THEN** the bands render in the fixed order above, each drawn from synced rows, with no
  loading waterfall and no server round trip beyond the already-established sync

#### Scenario: A quiet day folds without apology

- **WHEN** a member opens the team Home while no exception class matches, nothing happened
  in the last 24 hours, the viewer has no in-flight issues, and no unassigned ready work
  exists
- **THEN** the attention, since-yesterday, and ready bands are absent entirely (not rendered
  empty), YOURS renders its single warmth line standing alone — the Runway doorway renders
  only while the READY FOR YOU band renders, and here it has folded — and the hero degrades
  to its quiet form

#### Scenario: Composition is local-first

- **WHEN** the digest renders for a team whose rows are already synced
- **THEN** every number and phrase on the page is computed from local Zero query results by
  pure functions exported from `packages/schema`

### Requirement: Hero spread with cycle vitals and a never-filler narrative

When the team has an active cycle, the hero SHALL show: the cycle's human key as the title;
a day band with one segment per cycle day (past filled, today emphasized); the line
"Day N of M · ends \<weekday\>"; status words for shipped, in review, and — only when
non-zero — need attention; a short team narrative; artifact chips; and a vitals column with
the scope facts (committed / landed / added, with a drawn scope band), a NEXT list, and
"N days left".

The narrative SHALL be the stored cycle-digest narrative when a `cycle_digest` with ready
content exists for the active cycle, and otherwise a computed, deterministic fallback of at
most two sentences assembled only from verified counts. The narrative SHALL never be filler
and SHALL never come from a model call made by this page. Scope facts SHALL follow the
delivery-metrics semantics: committed = assigned to the cycle no later than its start
(carry-ins included), landed = done, added = assigned after the cycle start. Artifact chips
SHALL render only when their artifact exists (a digest with content; a closed retro linked
to the cycle). The NEXT list SHALL show only derivable rituals — an open retro renders with
its state and never with an invented time — and SHALL fold when nothing is derivable.

When the team has no active cycle, the hero SHALL degrade to the team name with a quiet
line and a Cycles doorway, and every cycle-dependent band (scope vitals, day band, SHIPPED
THIS CYCLE, READY FOR YOU) SHALL fold.

#### Scenario: Active cycle with a stored digest narrative

- **WHEN** the active cycle has a `cycle_digest` row with ready content
- **THEN** the hero narrative renders that stored narrative and the "Cycle report" chip
  appears

#### Scenario: Active cycle without a digest

- **WHEN** the active cycle has no digest content
- **THEN** the hero renders the computed fallback narrative built only from real counts
  (shipped, live, days left, the most severe attention fact), at most two sentences, and no
  "Cycle report" chip renders

#### Scenario: Scope band tells the plan against reality

- **WHEN** the active cycle has 12 issues committed at planning or carried in, 8 of them
  done, and 3 assigned after the cycle started
- **THEN** the vitals show 12 committed / 8 landed / 3 added and the scope band draws 8
  landed blocks, 4 open blocks, and 3 added blocks

#### Scenario: No active cycle

- **WHEN** the team has no active cycle
- **THEN** the hero shows the team name with a quiet line and a Cycles doorway, and no day
  band, scope vitals, SHIPPED, or READY band renders

### Requirement: One attention number over four disjoint exception classes

The NEEDS ATTENTION band SHALL present exactly four exception classes, each issue assigned
to at most one class by precedence: (1) done in git but not on the board — the work-graph
divergence `status_behind_merge`; (2) checks failing — rolled-up CI health failing; (3)
waiting on review over a day — an open, unapproved linked pull request whose review age
exceeds 24 hours; (4) new in triage — the team's triage inbox rows. Each class row SHALL be
a doorway to the surface where the exception is fixed and SHALL carry drawn evidence
derived from the same rows (broken reality track with the `//` mark; tick-bar with failing
ticks and the failure age; the waiting ages; triage dots).

The attention count SHALL be the sum of the four class counts (a distinct-issue count by
construction) and SHALL be the single value rendered everywhere the number appears on the
page. When the count is zero the band SHALL fold and the hero's "need attention" status
word SHALL be absent.

#### Scenario: The number agrees with itself

- **WHEN** one issue diverges (`status_behind_merge`), one issue's checks are failing, two
  open pull requests have waited over a day, and three issues sit in triage
- **THEN** the band header, the hero status word, and every other occurrence of the
  attention number all render 7

#### Scenario: An issue in two classes counts once

- **WHEN** an issue both diverges as `status_behind_merge` and has failing checks
- **THEN** it appears only in the divergence class and contributes exactly one to the
  attention count

#### Scenario: Zero folds the band

- **WHEN** no issue matches any exception class and triage is empty
- **THEN** the NEEDS ATTENTION band does not render and no attention number appears
  anywhere on the page

#### Scenario: Exception rows are doorways

- **WHEN** a member activates the triage exception row with Enter
- **THEN** the triage view for the team opens

### Requirement: SINCE YESTERDAY covers a literal trailing 24-hour window

The SINCE YESTERDAY band SHALL derive from a literal trailing 24-hour window ending now:
an OVERNIGHT card listing deployments that went live in the window (each line naming the
done issues whose linked merged pull request's merge commit the deployment carried, falling
back to the deployment's own repo/environment fact when no issue matches); a YOUR REVIEW
card listing review outcomes submitted in the window on pull requests linked to issues
assigned to the signed-in user; and an inbox card summarizing the viewer's unread
notifications for this team in the window. Every card SHALL carry a provenance line naming
its source rows and SHALL be a doorway (the Inbox or the subject). Cards fold
independently; the band SHALL fold when all are empty. The band SHALL NOT claim a last-seen
anchor it does not have.

#### Scenario: Overnight deployments name what shipped

- **WHEN** two deployments succeeded within the last 24 hours and their shas match the
  merge commits of pull requests linked to done issues
- **THEN** the OVERNIGHT card lists those issues' titles with deploy provenance

#### Scenario: A review on the viewer's work surfaces

- **WHEN** a review was submitted 9 hours ago on a pull request linked to an issue assigned
  to the viewer
- **THEN** the YOUR REVIEW card renders that outcome with the issue key and age in its
  provenance line

#### Scenario: Nothing happened

- **WHEN** the last 24 hours contain no matching deployment, review, or notification
- **THEN** the SINCE YESTERDAY band is absent

### Requirement: YOURS shows only the signed-in user's own work and says so

The YOURS band SHALL list the signed-in user's in-flight issues in this team (assignee =
viewer, status unfinished, not in triage), ordered by last movement, each row carrying the
issue-list anatomy: status glyph, key, title, reality track, and a two-line bifact whose
phrases derive from a fixed dictionary keyed on real status/signal predicates. Rows whose
signal shows an open pull request awaiting review SHALL collapse into a single "N of yours
are waiting on others" row carrying the waiting ages. A "No reviews owed" reciprocal line
SHALL render only when no open pull request linked to the team's issues awaits review at
all, and SHALL fold otherwise — it never renders a claim the data cannot verify. The band
SHALL close with a mono derivation footnote ending "your work only — never compared", and
every clause of the footnote SHALL be true of the rendered derivation.

When the viewer has no in-flight issues, the band SHALL render a single warmth line instead
of an empty list, with a doorway to the ready work only while the READY FOR YOU band
renders; on a fully quiet day the READY band has folded, so the warmth line stands alone —
a doorway SHALL NOT point at a band that cannot render. The band SHALL never render another
person's work, name, or count.

#### Scenario: In-flight rows with delivery reality

- **WHEN** the viewer holds three unfinished issues in the team, one approved-and-unmerged,
  one in progress, one with failing checks
- **THEN** YOURS renders three rows whose say/git bifacts derive from each issue's own
  delivery signal, ordered by most recent movement

#### Scenario: Waiting work collapses

- **WHEN** two of the viewer's issues have open pull requests awaiting review
- **THEN** those two collapse into the "2 of yours are waiting on others" row with their
  waiting ages

#### Scenario: Empty YOURS is warmth, not apology

- **WHEN** the viewer has no unfinished issue in the team
- **THEN** the band renders one warmth line and no table — with a Runway doorway when the
  READY FOR YOU band renders, and without one when that band has folded

#### Scenario: The lens is personal, never comparative

- **WHEN** any state of the team is rendered
- **THEN** the YOURS band contains no other user's identity or per-person count, and the
  footnote ends "your work only — never compared"

### Requirement: READY FOR YOU is the Runway lane of derivable starts

The READY FOR YOU band SHALL list the active cycle's unassigned, triaged issues in a
ready-to-start status (todo/backlog), urgent first, each row carrying its priority glyph
and a why-it's-clear phrase produced by a real predicate (urgent priority; carried in;
added mid-cycle; committed at planning). No phrase SHALL exist without a predicate. Crit
and Verify lanes SHALL NOT render in any state (their entities do not exist). The band
SHALL fold when there is no active cycle or no matching issue. Each row SHALL be a doorway
to the issue.

#### Scenario: Ready rows carry predicate phrases

- **WHEN** the active cycle holds an unassigned urgent todo issue and an unassigned todo
  issue carried from the previous cycle
- **THEN** the band lists the urgent issue first with an urgency phrase and the carried
  issue with a carried-in phrase

#### Scenario: Nothing is ready

- **WHEN** every issue in the active cycle is assigned, finished, or beyond todo
- **THEN** the READY FOR YOU band is absent

### Requirement: SHIP CADENCE draws the deployment record weekly

The SHIP CADENCE band SHALL draw a weekly dot chart over the team's deployments: one dot
per deployment that reached production (`deployedAt` set), bucketed by UTC week over a
trailing window of weeks, with month labels, a today caret, and a tick at each closed
retro inside the window labeled only "retro". The chart SHALL reuse the deployment facts
the delivery view reads (no new query) and SHALL link onward to the Delivery view. The
band SHALL fold when the team has no deployment with a production timestamp.

#### Scenario: Weeks bucket the deploy record

- **WHEN** the team's deployments include three that went live this week and two last week
- **THEN** the newest two week columns draw three and two dots and the today caret sits in
  the newest column

#### Scenario: No deploy history

- **WHEN** the team has no deployment that ever reached production
- **THEN** the SHIP CADENCE band is absent

### Requirement: SHIPPED THIS CYCLE badges Live from the deploy fact

The SHIPPED THIS CYCLE band SHALL list the active cycle's done issues in a two-column
grid, each badged **Live** when a deployment carried its linked merged pull request's
merge commit to production, else **Built — not live**. The badge SHALL derive from the
exact merge-commit join the reality strip already uses — never inferred from status alone.
The band SHALL fold when the cycle has no done issues.

#### Scenario: Live requires a deployment

- **WHEN** two done issues have merged pull requests and only one's merge commit appears in
  a succeeded deployment
- **THEN** that issue is badged Live and the other Built — not live

### Requirement: The composed footline states only rules the code executed

The digest SHALL end with a mono footline naming the composition rules actually applied in
the current render (folding, the attention-first ordering, the personal lens), followed by
the onward footer. The footline SHALL never name a rule the implementation does not
execute, and clauses for folded/absent behaviors SHALL be omitted rather than aspirational.

#### Scenario: The footline is honest on a quiet day

- **WHEN** the attention band and other optional bands have folded
- **THEN** the footline names the folding that happened and contains no claim about
  behaviors (e.g. crit scheduling) that do not exist

### Requirement: The digest is keyboard-operable and members management stays reachable

Every doorway on the digest — exception rows, cards, issue rows, ready rows, onward links —
SHALL be focusable in document order and activate with Enter, with a visible focus state.
The team's members-management surface (roster, join/leave, admin controls) SHALL remain
reachable from the team Home via a Members doorway at its own route, preserving every
existing control.

#### Scenario: Keyboard traversal reaches every doorway

- **WHEN** a member tabs through the digest without a pointer
- **THEN** every doorway receives visible focus in document order and Enter opens its
  destination

#### Scenario: Members management survives the swap

- **WHEN** a member opens the Members doorway from the team Home
- **THEN** the previous management surface (roster, self-serve join/leave, admin
  rename/archive and roster controls) is fully available

### Requirement: The digest is themed by tokens in every theme

Every color and font on the digest SHALL resolve through theme tokens, including four
daylight extensions (`--row-hairline`, `--statusline-bg`, `--urgent-soft`, and the urgent
text ink `--status-urgent-ink`) defined in every theme variant (all themes, light and
dark), and the page SHALL meet AA contrast in each: urgent-colored text carries the ink
(AA 4.5:1 over the base surface and the urgent-soft wash), while urgent non-text glyphs
keep `--status-urgent` at the 3:1 non-text bar. Drawn elements SHALL be static inline SVG
with no motion.

#### Scenario: Dark theme has no stray daylight

- **WHEN** the digest renders under any dark theme variant
- **THEN** hairlines, urgent washes, and every drawn element resolve to that theme's token
  values with AA contrast, with no hardcoded light-theme hex
