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
This one is the exception, deliberately. `more▾`'s Decisions item is folded away *because no
entity backs it*, and no amount of redrawing produces one.

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

## D10 — `g d` comes back, and Delivery moves to `g s`

PR #33 wrote, in `go-to.ts`: *"Decisions is folded away, so `g d` is Delivery's."* The condition
has expired. `g d` → Decisions, as `ia.html` draws it.

Delivery keeps its bar seat and takes **`g s`** — "shipped", which is that page's entire
vocabulary. `s` is free (`h i t c d r p m` are taken and `⌘K` owns search). The alternative of
leaving Delivery with no shortcut was rejected: its menu row is the only route to it below the `lg`
breakpoint, and a destination reachable only by pointer at narrow widths fails keyboard-first.

Both the deck's `Kbd` hints, `go-to.ts`, the `app-frame` spec and the docs keyboard table move
together; the app-frame spec's scenario "A destination with no entity behind it does not render"
is MODIFIED rather than deleted — the rule survives, it just needs a destination that is still
unbuilt to point at, and `ia.html`'s Runway is one.

## D11 — Home's DECIDED THIS CYCLE band

Position: after SHIPPED THIS CYCLE, before the composed footline, which is where
`home-digest-2.html` draws it. Content: the active cycle's decisions, newest first, as chips —
sentence, then a mono line `<area> · <ISSUE-KEY> · from a thread of N · <date>` and the revisit
pill where set. Each chip is a doorway to its issue. The band folds entirely when the active cycle
holds no decision, and with no active cycle it does not render at all, like every other
cycle-dependent band.

`home-digest-2.html` also draws a **DECIDED card inside SINCE YESTERDAY**. Not built, deliberately:
the two would state the same fact twice on one page for most teams (a decision made yesterday is
also a decision made this cycle), and the band is the one the brief names. Recorded here so the
omission is visible rather than forgotten.

The footline's composition clause gains the band only when the band actually rendered — the
`team-home` rule that the footline never names a rule the render did not execute.

## D12 — Render the degenerate states and LOOK at them

Triage shipped a panel that reserved its full measure over an issue with no description: a large
empty box that passed every test. The lesson is that tests do not see reserved emptiness. Five
states get rendered at 1440×900 and screenshotted, and each screenshot is looked at:

1. **A team with no decisions at all** — the record page. Must be a quiet line, not a framed
   empty state, and must not draw a search box, a scope row or a group header over nothing.
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
  the record with `g d` and finding the sentence by search.

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
- **Shared code touched**: `packages/ui/src/components/drawn.tsx` (additive: one mark) and
  `packages/ui/src/styles/contrast.test.ts` (appended block at the END). `apps/web/src/frame/`
  is touched for the `g d` / `g s` swap, which is unavoidable and is the change's one edit to a
  file every other surface depends on.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->
