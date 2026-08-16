# Design — decision-record

The argument is `design-explorations/overhaul-2026-08/plays/PLAY-decisions.md`; the drawings are
`plays/decisions-thread.html` (a debate resolving) and `plays/decisions-record.html` (the record).
The rulebook is `northstar/ia.html`, and `northstar/home-digest-2.html` holds the DECIDED THIS
CYCLE band this change unfolds. The play's own comment records what it filed as sketch; this file
does not re-argue any of it. It records the decisions the play left to the build.

The governing sentence: **a decision is the team's call, not a person's** — and it is true because
there is no column that could say otherwise.

## D0 — This change adds a table, and that is the point

Every change in this design series so far has been a redraw: `retros-room`, `cycles-register` and
`projects-roadmap-daylight` each opened with "no new tables, no migration, no new named query".
This one is the exception, deliberately. `home-digest-2.html`'s DECIDED THIS CYCLE band is folded
away *because no entity backs it*, and no amount of redrawing produces one. (The `more▾` item PR #33
folded away is a separate matter and stays folded — D10.)

What lands on the schema side, and nothing beyond it:

- One forward-only migration, `0024_decision.ts`, applied at boot by the existing Kysely migrator.
- One table in the hand-written Kysely `DB` interface and one in the hand-written Zero schema,
  with the CI drift test covering every column of it.
- One named query, `decisions.byTeam`, carrying the same `teamScoped(...)` predicate as its
  fifteen siblings, byte-identical in shape.
- One `.related('decisions')` extension **inside** the issue-detail query's existing `teamScoped`
  call — the `projects-roadmap-daylight` B1 precedent, so the relation hangs off an issue the
  predicate has already admitted.
- Three mutators: `decision.record`, `decision.revise`, `decision.retract`.

No new container, service, job type, dependency or environment variable. The three-container
promise is untouched.

## D1 — The row, column by column, and the one that is missing

```
decision
  id                    uuid    pk            client-minted UUIDv7, at the CALL SITE
  team_id               uuid    not null      → team,  on delete cascade
  issue_id              uuid    not null      → issue, on delete cascade
  sentence              text    not null      CHECK 1 ≤ char_length ≤ 240
  decided_at            timestamptz not null
  source_comment_count  integer not null default 0
  first_comment_id      uuid    null          → comment, on delete SET NULL
  last_comment_id       uuid    null          → comment, on delete SET NULL
  revisit_cycle_id      uuid    null          → cycle,   on delete SET NULL
  created_at            timestamptz not null default now()
  updated_at            timestamptz not null default now()
```

**There is no author column.** No `decided_by`, no `created_by`, no `owner_id`, no nullable
identity of any kind. This is the `retro_card_author` move applied one step harder: the retro
keeps the binding in a server-only table so the client cannot name it; here there is no binding to
name, in Postgres or anywhere else. The consequence is that "who won the argument" is not a
question this product can be made to answer by a later feature request, a support script, or a
`SELECT`. The schema-drift test asserts it by name (D9).

**`team_id` is denormalised off the issue**, exactly as `comment.team_id` is, so the row inherits
the same one-hop team scope and the predicate stays identical in shape to its siblings.

**`sentence` is `text` with a length CHECK, not rich text.** One plain sentence is the whole
product claim. Rich text would invite a paragraph, and a paragraph is the comment thread again.
240 characters is the cap — long enough for a real settlement, short enough that the record page
stays a list of sentences. The cap is a shared constant (`DECISION_SENTENCE_MAX`) used by the Zod
arg schema, the CHECK constraint and the composer's counter, so the three cannot drift.

The play's self-critique worries the tool "can suggest but not enforce" an editing discipline. The
cap is the one honest half of that: it enforces *length*, and claims nothing about quality.

**`source_comment_count` is stamped, not computed at read time.** "From a thread of 5" must stay
true after someone deletes comment 3. The count is the size of the thread *at the moment of
deciding*, which is the fact the provenance line is actually asserting.

**`first_comment_id` / `last_comment_id` are `ON DELETE SET NULL`.** A decision whose thread was
later deleted is one of the degenerate states this change must render and look at (D12). The chip
still states its stamped count and drops the "open the thread" doorway rather than offering a dead
link.

**`revisit_cycle_id` references `cycle` with `ON DELETE SET NULL`** — a deleted cycle removes the
marker, never the decision.

Indexes: `decision_team_decided_at_idx` on `(team_id, decided_at desc)` — the record page's and
Home's only question — and `decision_issue_idx` on `(issue_id)` for the pinned chip.

## D2 — Many decisions per issue, not one

The play draws one chip over one thread. A real issue that runs three weeks settles more than one
thing, and a unique constraint on `issue_id` would force the second settlement to overwrite the
first — destroying exactly the memory this change exists to keep. No unique constraint. The detail
surface pins every decision on the issue, newest first; with one, it looks like the play.

## D3 — Deciding is a mutator, and the mutator does not trust the client for provenance

`decision.record` takes `{ id, issueId, sentence, decidedAt, revisitCycleId? }`. It does **not**
take `sourceCommentCount`, `firstCommentId` or `lastCommentId`.

Those three are derived **inside** the mutator body from the issue's comments, ordered by
`created_at`: the count, the earliest id and the latest id. Two reasons. First, provenance a
client can type is provenance a client can inflate, and "from a thread of 5" is a claim on the
surface. Second, it is deterministic over the transaction's own rows, so the optimistic client run
and the authoritative server run agree, and a rebase re-derives the same three values.

This does **not** conflict with the mint-at-the-call-site rule, which is about **identifiers**: an
id generated inside a mutator body changes between rebase runs and corrupts the optimistic result.
`id` is minted at the call site with `newId()`, like every other create in this codebase. Derived
counts are not identifiers and are stable under re-run.

`team_id` is copied off the loaded issue, never from args. Gate: `canWrite` + `loadIssueForWrite`,
so a viewer and a non-member are rejected before existence — the shipped `createComment` shape.

`decision.revise` (the sentence and the revisit marker) and `decision.retract` are gated by
team-scoped write access **and nothing else**. There is deliberately no author check, because
there is no author: `loadCommentForAuthor`'s equivalent cannot exist here. Any team member with
write access may correct the team's own sentence; that is what "the team's call" means. Recorded
as a decision rather than an oversight — the alternative (first-writer-owns) would require the
column this change refuses to add.

## D4 — Reading: one named query, no admin cross-team bypass

`decisions.byTeam({ teamId })` = `teamScoped(zql.decision.where('teamId', teamId)…)`, related to
`issue` (for its key, title and labels) and `revisitCycle`, ordered `decidedAt desc`.

`teamScoped` grants workspace admins workspace-wide reads, as it does for every other work entity.
The brief's "no admin bypass for reading another team's decisions" is satisfied by the *absence of
a second, wider path*: there is no `decisions.all`, no workspace-scoped variant, no REST route.
An admin reads another team's decisions exactly as they already read that team's issues and
comments — through the one team-scoped predicate, from a team they administer. Writing a *new*
predicate that excludes admins here (the `pmAudienceScoped` shape) would make decisions stricter
than the comment thread they were distilled from, which is a difference nobody could defend and
which would be silently defeated by reading the thread instead. **Recorded explicitly** because
the brief's sentence admits both readings and this is the one that is coherent.

The pinned chip does not add a query: the issue-detail query gains `.related('decisions')` inside
its existing predicate.

Home reads `decisions.byTeam` — which is why `team-home`'s "adds no new synced table and no new
named query" clause is a MODIFIED requirement in this change rather than something quietly
violated.

## D5 — A decision never expires, and the code must have no way to fade one

Stated as three implementation rules, each testable:

1. **No age-derived styling anywhere.** The chip's glyph, ink and border are constants. There is
   no opacity ramp, no `--text-3` fallback past N days, no "stale" class. A unit test renders a
   decision decided today and one decided 400 days ago and asserts the two nodes carry identical
   class strings.
2. **No age-derived ordering beyond recency.** Groups are cycles in reverse chronological order;
   within a group, `decided_at` descending. Nothing sorts by staleness or floats a revisit to the
   top of the whole page.
3. **The page's own footline says it**: `Decisions never expire — they get revisited.` plus the
   count of revisits due, and it is derived from rows, not hard-coded.

## D6 — The revisit marker, and saying plainly where it does not yet go

A revisit marker is `revisit_cycle_id` and it does exactly three things today:

- it stores;
- it displays, as a pill reading **`revisit · resurfaces at <cycle name> planning`** — the word
  "revisit" is in the pill, so it is never a colour-only signal, and the pill's accessible name is
  the same sentence;
- it filters: the record page's `Revisits due` scope shows the decisions carrying one.

It does **not** resurface anything at planning, because **yapm has no planning surface**. Cycles
exist; a planning ritual does not. The honest handling, and the one this change takes: the pill
names the cycle, the record page's foot states the count due, and the docs page says in one
sentence that resurfacing at planning arrives with the planning surface. Nothing on the screen
implies a notification the product will not send. The play filed the resurfacing mechanics as
sketch for exactly this reason.

## D7 — The settled thread truly collapses

The play's `decisions-thread.html` renders the resolved thread at reduced ink and its own
self-critique says so: *"the resolved thread is only typographically quiet; a real 40-comment
thread would need true collapse."* Opacity is not built.

What is built: when an issue has at least one decision, the comments **posted at or before the
newest decision's `decided_at`** collapse behind one control reading
`The thread · N comments · settled` (`aria-expanded`), and comments posted **after** the decision
stay open — a thread that kept moving after the settlement is not settled. The control is a real
button, in the tab order, `Enter`/`Space` toggles, and the state is local (no write, no query).
An issue with no decision renders the thread exactly as it does today.

Two consequences recorded up front: the existing e2e assertions that read a comment on an issue
detail are only affected on issues that *have* a decision (none of the current fixtures do), and
the "Comments · N" section heading keeps counting every comment, collapsed or not.

## D8 — The record page

`/teams/{teamId}/decisions`. Band 2 (masthead) per `ia.html`: `Decisions` + a mono count, the
standfirst *"Why did we do it this way? — answered here, six weeks from now."*, and a cycle filter.
Below it the search row: a real `<input type="search">` focused by `/`, plus the scope tabs
(`Everything` · `Revisits due`).

Search is a pure client-side substring match over the sentence and the issue key, case- and
diacritic-insensitively, computed by a function in `packages/schema` over already-synced rows —
no network, no new query, sub-100ms by construction, and correct offline. It does **not** go
through the FTS `search` capability: that surface searches issues, and a second index for eleven
sentences already on the device would be a service call to answer a question the client can answer
in a microsecond.

Grouping is by the cycle **containing `decided_at`** — not by an FK, because a decision is not a
cycle's property. Cycles are ordered newest first; decisions decided before the team's earliest
cycle fall into a final group. The play's group name for it, `Before cycles`, is itself filed as
sketch; this build uses **`Outside a cycle`**, which is also true of a decision decided in a gap
between cycles (the play's name silently assumes all such decisions predate cycle 1).

The chip-row: the decision mark, the sentence (one line, ellipsised), the area (the issue's first
label, or nothing — never an empty column), the revisit pill where set, the issue key, the date.
**No owner column, and no column that could hold one.** `Enter` unfolds the row in place to show
the full sentence, the provenance line and the doorway to the thread; `Enter` again folds it;
`Escape` folds it. Rows are focusable in document order with the roving model the roadmap and the
projects index already use.

The empty page — a team with no decisions at all — renders the masthead, the standfirst and one
quiet line naming what will appear (`A decision appears here when a thread ends in one sentence.`),
per `reality-vocabulary`'s empty-state rule. No search box over nothing, no group headers, no
reserved measure. This is the Triage lesson (D12).

## D9 — The drift test asserts an absence

`schema-drift.test.ts` gains the `decision` shape in `KYSELY_DB` like any other table, plus one
extra assertion with no precedent in the file: that **no column of the live `decision` table**
matches `/(author|owner|user|member|decided_by|created_by)/`, and that the Zero schema's
`decision` table has no such column either.

An absence that nothing checks is an absence that survives exactly until the first plausible pull
request. This makes "the team's call, no owner" a CI gate rather than a comment.

## D10 — The Record is a doorway, and this change reverses its own earlier plan

**Superseded: the first draft of this section argued "`g d` comes back, and Delivery moves to
`g s`".** It read PR #33's `go-to.ts` comment — *"Decisions is folded away, so `g d` is
Delivery's"* — as a condition that expires the moment the entity ships, and planned to take the
`more▾` item back, take `g d` back, and move Delivery to `g s` ("shipped", that page's whole
vocabulary, and the only free letter). That plan was written in good faith against a deck whose
written budget said "exactly six stops" while eight destinations shipped under it. It is now wrong
in every one of its three parts, and the reversal is recorded rather than quietly rewritten,
because the argument it lost to is the interesting part.

`destination-budget` removed the "Six destinations…" requirement by name and replaced it with a
ceiling of **eight destinations counted across both tiers**. Three of its clauses decide this
change:

1. **The deck is already at the ceiling.** `destination-budget/specs/app-frame/spec.md:30-32`:
   *"Today the deck stands exactly at its ceiling: Home, Issues, Cycles and Delivery on the bar, and
   Triage, Retros, Projects and Roadmap in the menu's permanent list."*
2. **The menu is not the cheap door.** `:168-170`: *"Growth by menu is growth. A change adding to
   the menu's permanent list spends exactly the same budget as one adding to the bar."* The original
   plan's whole shape — a menu item, not a bar stop — was an attempt to spend a budget that does not
   distinguish the two.
3. **At the ceiling, a new destination must name a casualty.** `:162-166` requires a change adding
   one to *name the destination it displaces and show it failing one of the three admission tests*,
   and says a change that can name none *"SHALL land its surface as a lens, an interior, a doorway or
   a section of a destination that already exists, and SHALL say so in its own spec"*.

This change can name no casualty it would be honest about. Each of the eight is a place a team
works; the Record is a place a team *reads*, a few times a cycle, when someone asks why. So the
third branch applies, and `destination-budget/proposal.md:107` had already written the *where*: a
doorway at `/teams/{teamId}/decisions`. The obligation to "say so in its own spec" is met in the
`decisions` capability rather than in a comment — the record-page requirement now states the
placement and carries two scenarios for it.

**`g d` stays Delivery's.** Not as a concession but as the only reading the binding rule allows:
`destination-budget/specs/app-frame/spec.md:262-264` — *"Only a destination SHALL hold a `g`
binding. A lens, a doorway, an artifact and a transient SHALL NOT."* With no Decisions destination
there is no key to reclaim, so there is no swap, and the *behaviour* of
`apps/web/src/frame/go-to.ts:35-71` and `deck.tsx` is untouched by this change. That is worth more
than the keystroke: the swap would have
made `openspec/specs/delivery-metrics/spec.md:226` ("or by its `g d` shortcut") stale in a
capability this proposal never listed as modified — the exact defect
`destination-budget/design.md:423-429` cites as the reason the rule exists. The plan that lost was
also the plan that would have broken a shipped requirement without noticing.

**What the reversal still owes: three comments.** Behaviour holding still is not the same as prose
holding still. `apps/web/src/frame/deck.tsx:23-24`, `apps/web/src/frame/go-to.ts:8` and
`apps/web/src/frame/app-frame.test.tsx:499-500` each explain the folded-away Decisions item with
*"no entity backs it"*. That was true when PR #33 wrote it and is false the moment this change
merges. Leaving it would ship three source comments asserting something the same commit disproves,
and the first reader to notice would reasonably conclude the fold is now a bug. So each is reworded
to the reason that actually holds after this change — the deck stands at its eight-destination
ceiling and the Record is a doorway (this section) — while the assertions, the `DeckStop` union, the
`g` cases and every `shortcut:` string stay exactly as they are. The budget's gate is therefore
written over **substance rather than file identity** (tasks 7.1 and 11.6): a gate phrased as "these
files do not appear in the diff" would forbid the correction and make honesty a budget violation.

One constraint on the rewording: `destination-budget/design.md:214` quotes `deck.tsx:22-24` as the
evidence for its first admission test — *"a disabled row is chrome promising what the product cannot
keep"*. That sentence is about disabled rows in general, not about Decisions, and it survives the
change intact; the reworded comment keeps it verbatim so the citation still lands on the sentence it
names.

**How the page is reached, and why the palette row is not optional.** Three doorways: the pinned
chip on the issue, the DECIDED THIS CYCLE band's header on Home, and a command-palette row on every
team surface. The first two are drawn from rows, so a team that has recorded nothing has neither —
and this change specs an empty Record page (D12.1) which would then be reachable only by typing a
URL. `openspec/specs/app-frame/spec.md:259-267` forbids exactly that: every authenticated route is
reachable from the frame without prior knowledge of its URL, and losing a route's reachability "SHALL
be treated as a regression". The palette row is what makes the placement legal.

Its shape is copied, not invented: `apps/web/src/frame/app-frame.tsx:93-117` registers `Go to inbox`,
`Search everything`, `Go to workspace overview` and `Appearance` **with no `shortcut:` field at all**
— the same registrations `destination-budget/design.md:431-435` cites as evidence that doorways hold
no keys.

There is no doorway *sub-group* to join: the frame builds exactly **one** group, `Go to`
(`:120-183`). It lists the eight destination rows, each with its `g` binding (`:124-179`), and then
splices `...commands` at the tail (`:180`) — those four shortcut-less rows. The Record's row joins
that tail, exactly as the inbox and search rows sit there, and carries no `shortcut:`. So this change
adds no keyed row and no destination row, and needs no `command-palette` delta.

That conclusion does not rest on
`destination-budget/specs/command-palette/spec.md:37-42`'s set-identity clause holding cleanly over
this single group — it already has the four pre-existing doorway rows inside it, and reconciling the
clause's wording against them is **`destination-budget`'s** obligation, not this change's. This
change's obligation is narrower and it meets it: it adds one row, at the tail, with no key.

**The frame prop.** The route renders inside the shared frame with **no** `current`, the shape
`apps/web/src/routes/teams.$teamId.members.tsx:16` already uses for a team-scoped page that owns no
destination. `DeckStop` gains no `'decisions'` member.

**The app-frame delta shrinks to one scenario.** The rule "A destination for which no entity exists
SHALL NOT be rendered at all" survives untouched, but `destination-budget` carries it with a
scenario whose WHEN is *"in a build where no decision entity exists"*
(`destination-budget/specs/app-frame/spec.md:106-109`). This change ships that entity, so the WHEN
can never be satisfied again and the rule loses its case. The first draft's answer was to re-point
it at `ia.html`'s Runway; that is wrong, because `ia.html:368` files Runway as a doorway too — *"the
Record and Runway are pages without bar seats"* — and a doorway cannot stand as the example of a
*destination* with no entity behind it. After this change no drawn-but-unbuilt destination remains
at all, so the scenario is generalised instead: a destination the interaction model draws with no
entity storing its rows. The requirement is restated in full around that one edit.

The generalised scenario's THEN carries the assertion and nothing else. An earlier draft appended
*"the decision entity this change ships is not the example, because the Decisions record is a
doorway and holds no place in either tier of the deck"* — true, and the right thing to say, but not
in a scenario: archived into `openspec/specs/app-frame/spec.md` the phrase "this change" has no
referent and the clause is not falsifiable by any test. It is a note about why the scenario was
re-pointed, so it belongs here, in the paragraph above, and it stays here.

## D11 — Home's DECIDED THIS CYCLE band

Position: after SHIPPED THIS CYCLE, before the page's composition record and its onward footer,
which is where `home-digest-2.html` draws it — the mock's "composed footline" is the mono line
`explanation-at-rest` replaced with a quiet `how ·`, so the band's neighbour changed while its seat
did not. Content: the active cycle's decisions, newest first, as chips — sentence, then a mono line
`<area> · <ISSUE-KEY> · from a thread of N · <date>` and the revisit pill where set. Each chip is a
doorway to its issue, and the band's own header is a doorway to the Record (D10). The band folds
entirely when the active cycle holds no decision, and with no active cycle it does not render at
all, like every other cycle-dependent band.

`home-digest-2.html` also draws a **DECIDED card inside SINCE YESTERDAY**. Not built, deliberately:
the two would state the same fact twice on one page for most teams (a decision made yesterday is
also a decision made this cycle), and the band is the one the brief names. Recorded here so the
omission is visible rather than forgotten.

The composition record behind the page's `how ·` gains the band's clause only when the band actually
rendered — the `team-home` rule that the record never names a rule the render did not execute. That
rule is unchanged by `explanation-at-rest` moving the record off the page and behind the affordance;
only where it is read changed.

## D12 — Render the degenerate states and LOOK at them

Triage shipped a panel that reserved its full measure over an issue with no description: a large
empty box that passed every test. The lesson is that tests do not see reserved emptiness. Five
states get rendered at 1440×900 and screenshotted, and each screenshot is looked at:

1. **A team with no decisions at all** — the record page, reached the only way it can be in that
   state: the palette row, since neither a chip nor the Home band exists to lead there (D10). Must
   be a quiet line, not a framed empty state, and must not draw a search box, a scope row or a group
   header over nothing.
2. **Exactly one decision** — the record page and the issue detail. One group, one row; the page
   must not look broken for want of a second.
3. **A decision whose thread was later deleted** — `first_comment_id`/`last_comment_id` null. The
   provenance keeps its stamped count and the thread doorway is absent, not dead.
4. **A very long sentence** — at the 240-character cap, in the chip-row (ellipsised), unfolded
   (wrapped), on the issue-detail chip and in the Home band. No overflow, no clipped descender, no
   row that grows to four lines in a list.
5. **A decision with a revisit marker** — the pill in all four places it can appear, including
   beside a long sentence where the row is tightest.

Plus the record page and the issue chip in **Editorial dark**, and a comparison against the two
play PNGs.

## D13 — Accessibility and tokens

- The chip is **not colour-only**: it carries the word `Decided` and the drawn mark as well as the
  accent left edge.
- The revisit pill **states its meaning in words** (`resurfaces at Cycle 3 planning`), and that
  string is its accessible name — not a tooltip, not a title attribute.
- The decision mark is a drawn primitive in `packages/ui/src/components/drawn.tsx` on the shared
  20-unit grid — a filled dot (a fact) inside a ring (a promise), per the play. `role="img"` with
  a truthful label where it stands alone; `aria-hidden` where the word `Decided` is beside it.
- Every colour and font is a token. Contrast is asserted in **every** theme block, light and dark,
  and where an accent-ink pair misses AA the ink changes and the mock loses — the standing
  precedent from `triage-daylight` B8 and `retros-room` B2.
- **`contrast.test.ts` is extended by appending a clearly delimited block at the END of the file.**
  Three painful cross-branch merges in this series make this a hard instruction, not a preference.

## D14 — Test tiers (PROCESS.md §3)

The big-feature rule: this change touches a synced entity/schema, a mutator, a permission surface
and signature UI — four of four. All three tiers, and e2e is not reflexive here, it is required.

- **Unit**: the sentence cap; cycle grouping including the outside-a-cycle group; the search match;
  the provenance phrasing; the never-fades assertion (D5.1); the Home band model; the settled-thread
  split at `decided_at`.
- **Integration (pg)**: the migration applies and rolls back; the drift test including the
  absent-author assertion; `decisions.byTeam` denies a non-member by empty query and returns
  nothing for another team; `decision.record` rejects a viewer before existence; the derived
  provenance matches the thread; `ON DELETE SET NULL` leaves the decision standing when its
  comments go.
- **E2E**: deciding a thread from the composer with the keyboard and seeing the chip pin; opening
  the record from the palette row with the keyboard and finding the sentence by search. There is no
  `g d` case to test, and the deck test that *would* have changed is the one this change must leave
  alone: `apps/web/src/frame/app-frame.test.tsx`'s destination list stays as
  `destination-budget` left it, and `routes.test.tsx`'s `ROUTE_HOMES` gains one `'doorway'` row.

## D15 — Archive order, and the one thing `openspec validate` cannot see

This change's two re-authored deltas each restate a requirement another in-flight change also
restates. A `## MODIFIED` block replaces a requirement wholesale, so the live text is whichever
change archived **last** — not a merge. The order is therefore part of this change's correctness:

> **`explanation-at-rest` → `destination-budget` → `decision-record`.**

What breaks in each wrong order:

- **`decision-record` before `destination-budget`.** Its `app-frame` delta modifies "A bounded deck:
  eight destinations…", which does not exist until `destination-budget` archives — the earlier
  requirement is "Six destinations, and everything else is a doorway, a lens or a transient", which
  `destination-budget` removes by name. The delta either fails to apply or invents a second
  requirement, and when `destination-budget` then archives, its own copy of that requirement
  overwrites this change's scenario repair — leaving a shipped `decision` entity described by a
  scenario that says no decision entity exists. On `team-home` the same order loses the DECIDED
  THIS CYCLE clause from the band-order sentence and both scenarios' decision clauses.
- **`destination-budget` before `explanation-at-rest`.** `destination-budget`'s `team-home` delta is
  authored as the union of B1's text and its own rationing; archiving B1 afterwards reverts the
  rationing (`destination-budget/tasks.md:99` already gates this pair).
- **`explanation-at-rest` last, in any arrangement.** It reverts both the footer rationing and this
  change's band at once.

`openspec validate --all` passes with every one of these changes on disk, in any order, because it
validates each change in isolation — it never compares two deltas against each other. PROCESS.md §1
"Delta hazards" (`PROCESS.md:11`) states it directly: *"All three are silent, and `openspec validate
--all` catches none of them — it validates each change in isolation, so a set of changes that destroy
each other passes."* `PROCESS.md:19` says what to do instead, and this change does both halves of
it: *"If another change claims it, write the **union** and record the required archive order as an
explicit pre-archive task."* The ordering gate is therefore a task (§12), not a tool.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **This change DOES add a table, a migration, sync-schema entries, one named query and three
  mutators** — the first in this series. Existing patterns are followed exactly: forward-only
  Kysely migration applied at boot, hand-written Zero schema entry, team-scoped read predicate
  identical in shape to its siblings, drift test green.
- **No author column, in Postgres or in the Zero schema**, asserted by the drift test (D9).
- **Decision content is client-writable by a team member with write access**; no admin bypass for
  reading another team's decisions beyond the one `teamScoped` predicate every work entity shares
  (D4).
- **Keyboard-first**: Decide is reachable from the composer without a pointer; the record page is
  navigable and searchable by keyboard.
- **Sub-100ms and offline**: the record renders from already-synced rows; search is a local pure
  function.
- **Accessibility**: the chip is not colour-only, the revisit pill states its meaning in words,
  and theme contrast holds in every theme block, light and dark.
- **A decision never expires** — no glyph fades, no row dims, nothing sorts by staleness (D5).
- **Not built, filed as SKETCH by the play**: the triangle rail's DESIGN section, and quiet-thread
  by opacity (replaced by a true collapse, D7).
- **`ROADMAP.md` is not edited** — parallel builds; the maintainer adds the row at archive time.
- **The Record is a doorway, not a destination** (D10) — the reversal of this change's own earlier
  plan, forced by `destination-budget`'s ceiling. No `more▾` item, no `g` binding, no `DeckStop`
  member; `g d` stays Delivery's, and the only edit `deck.tsx`, `go-to.ts` and
  `app-frame.test.tsx` take is the comment correction the shipped entity forces.
- **Archive order is part of correctness** (D15): `explanation-at-rest` → `destination-budget` →
  `decision-record`, enforced by §12 because no tool can enforce it.
- **Shared code touched**: `packages/ui/src/components/drawn.tsx` (additive: one mark) and
  `packages/ui/src/styles/contrast.test.ts` (appended block at the END). `apps/web/src/frame/` takes
  one behavioural edit — one shortcut-less palette row in `app-frame.tsx`'s frame source — plus the
  three-comment correction. The deck's own membership, tiers and bindings do not move, which is what
  the budget bought.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
