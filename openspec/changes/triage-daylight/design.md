# Design — triage-daylight

The rulebook is `design-explorations/overhaul-2026-08/northstar/ia.html`; the drawing is
`destinations/triage.html` (renders `triage.png`, `triage-full.png`); the row to match is
`northstar/issues.html`, already shipped as `packages/ui/src/components/issue-row.tsx`. The
mock's closing comment records what it folded and why, and this file does not re-argue any of it.

## D1 — The Project row ships, and `issue.routeIssue` gains one field

The mock's route menu lists Status, Assignee, Cycle, **Project** and Labels. `issue.routeIssue`
today writes the first, second, third and fifth. The mock's own comment flags this as the one
place it drew beyond the shipped mutator, and the brief asks for a decision: add the field, or
drop the row.

**Decided: add the field.** Three reasons.

1. Both halves already exist. `issue.project_id` is a column, `project` is a table, and
   `issue.setProject` is a shipped mutator over exactly this write.
2. The permission story is already written and does not change. `setIssueProject` runs
   `canWrite` then `loadIssueForWrite` (auth before existence, team-scoped on the **issue**), and
   requires the project only to *exist* in the workspace — deliberately no cross-team rejection,
   because a project spans teams. `routeIssue`'s new branch is that branch, verbatim.
3. Dropping the row would make routing the one place in the product where a member can set every
   placement fact about an issue *except* the one that decides which body of work it belongs to,
   for no reason a reader could reconstruct.

Shape: `projectId: z.string().min(1).nullable().optional()` on `routeIssueArgs`; when present and
non-null, the same existence check `setIssueProject` runs, throwing `MutationErrorCode.crossTeam`
with `'Project not found'`; folded into the same single atomic `issue.update` as the rest, so
routing stays one write.

Two consequences worth stating rather than discovering:

- **The AI tool registry gains the field for free.** `ai-tools.ts` derives the agent tool schema
  from `routeIssueArgs`, and `issue.routeIssue` is already classified `write`. Adding an optional
  field that resolves to an existing, permission-gated write does not move the risk class. The
  registry test asserting the derived tool set must be updated to expect the new field, never
  loosened to ignore it.
- **This change now touches two big-feature axes** (mutator + signature UI), so PROCESS.md §3
  requires all three tiers. `apps/web/e2e/triage.spec.ts` already exists and is extended, not
  added to — see D9.

## D2 — The queue is a list with no fold, and only one row is unfolded at a time

The brief is explicit: all items visible, because a queue you want to empty should show its own
floor. So no `↓ n more` fold here, unlike the issue list — the list's fold is a promise about how
much work a *page* shows; the inbox's whole claim is that it shows everything waiting.

Exactly one row carries a decision panel at a time.

## D3 — The panel follows FOCUS, and focus starts at the head

The mock draws the head of the queue unfolded. The shipped page keeps `j`/`k` and the verdicts act
on the *focused* row. If the panel were pinned to the head while focus moved down, the rail's
`[A]`/`[R]`/`[D]` would name one issue and act on another — a control that lies, which is the
exact failure mode this whole overhaul is correcting.

**Decided: the unfolded row is the focused row; on arrival, focus is index 0, which is the head,
which is what the mock draws.** The mock's drawing is the arrival state, not a special case for
row one. This also softens the mock's own first self-critique ("the design only serves the head of
the queue"): every row can be brought under decision, one at a time, by moving focus.

## D4 — The route transient is a labelled panel, not a `Menu`

`ia.html` classifies transients (the ⌘K palette, peeks, menus) as never destinations. The mock
draws ROUTE as one open transient with a header (`ROUTE · ENG-125`), five value rows and a foot
(`⏎ route · esc stay`).

A `base-ui` `Menu` is the wrong primitive: its items are commands that fire on activation, and
these five rows are values being *edited* before **one** commit. The transient is therefore a
popover panel that keeps an explicit accessible role and an accessible name naming the issue, with:

- five rows — Status, Assignee, Cycle, Project, Labels — each showing the value routing will
  write, `none` where nothing is set;
- arrow keys moving between rows, each row's control operable from the keyboard;
- `⏎` committing the whole routing in one mutation, `esc` closing it with nothing written;
- focus returning to the row it was opened from on close.

Keeping a named role means the e2e assertions get *stronger* (they can name the transient) rather
than weaker. It replaces `RouteDialog` entirely; the four fields the dialog exposed all survive,
plus project.

The mock draws the open transient covering the label, age and reporter columns of the rows beneath
it, and its self-critique calls that a fault ("a queue whose whole purpose is comparison should
probably never occlude its own right-hand columns"). The build reproduces the mock rather than
inventing a different placement, and the fault is carried forward as drawn — see "Left standing".

## D5 — The trailing avatar on a triage row is the reporter

The mock's rows carry `PR`, `MB`, `DO`, `PR` — and the panel names ENG-125's reporter as Priya
Raman. On this surface the avatar is the **reporter**, not the assignee: an inbox issue's assignee
is not yet a meaningful fact (routing is what sets it), and "who reported this" is a fact the
decision actually turns on.

`IssueRow`'s trailing slot is typed `assignee` and draws initials from `assignee.name`. Rather than
overload that name silently, `IssueRow` gains **one optional prop** overriding only the avatar's
announced name (`title` / `aria-label`), defaulting to the person's name. Triage passes the issue's
`creator` and announces `Reported by <name>`. The drawing is byte-identical to the list's; the
announcement is honest; no other surface changes.

## D6 — The age column states `created_at`, and claims nothing

The mock's `when` column is age since creation (`2d`, `1d`, `6h`, `41m`). The issue list's
equivalent column states `updated_at`; on Triage it states `created_at`, because arrival time is
what an intake queue is ordered by and the only age fact the surface has.

It is a plain mono relative number in the same measure and the same ink as the list's — **no
colour ramp, no threshold, no overdue mark, no target**. The precise fact is stated once, in the
decision panel's mono line (`<reporter> · <created-at>`), which is where the surface makes a claim
at all.

## D7 — The empty state, and the loading state that is not it

The mock's second frame: the shipped done disc at 26px, `Nothing waiting.`, and an onward foot
(`Issues › · Cycles › · Projects ›` with `⌘K goes anywhere` at the trailing edge). No sentence.

The one thing the mock cannot draw and the build must get right: **an inbox that has not finished
syncing is not an empty inbox**. `Nothing waiting.` renders only when the synced query has
completed; before that the surface says `Loading…`. Both carry `role="status"`, so a screen reader
hears the transition rather than a premature all-clear. `oldest first` is not drawn over an empty
queue — an order label over no rows is noise, per the mock.

## D8 — One attention number, unchanged

The triage count is one of the four exception classes feeding the ONE attention number. The
masthead count is the length of the same `triage.inbox` result `team-home.ts`'s `buildAttention`
counts. No second derivation, no second cap, no new count anywhere on the page — the masthead
count, the deck badge, the statusline and Team Home's "N new issues sit in triage" all trace to
the same rows.

## D9 — Tests: the tiers this earns, and the two standing CI lessons

Two big-feature axes (D1) ⇒ unit + integration + e2e. `apps/web/e2e/triage.spec.ts` already drives
this page and is **updated**, not replaced: the `triage-accept` / `triage-route` /
`triage-decline` test ids are deliberately preserved so the viewer's four read-only assertions
hold verbatim, and the route flow gains a project assertion rather than losing the status one.

Carried forward from `issue-list-daylight`:

- No test hard-codes a budget that encodes e2e fixture size — bounds are derived from the page.
- No test's premise is what a given Node runtime provides. CI is Node 24; dev machines here run
  26; anything environmental is stubbed explicitly.

## What is deliberately NOT built

Each of these is folded by the mock, and the reason is a missing stored fact, not a missing idea:

| Folded | Why it cannot be drawn honestly |
|---|---|
| SLA, queue-age target, overdue mark, age colour ramp | No SLA and no target exist anywhere in the product |
| Triage owner / rota | No entity backs either |
| Suggested label or priority | There is no classifier |
| Per-person triage throughput | Metrics are team-level only (VISION, constraint 8) |
| Duplicate-detection hint | `issue_link` is issue→pull_request only; no issue-to-issue table exists |
| "Moved to triage at 14:02" | There is no issue status-history table |
| Bulk select bar | Out of scope; the palette already carries multi-target triage actions |

## Left standing, and named

Three faults the mock names in its own self-critique are reproduced rather than fixed here,
because fixing any of them is a design change to an approved drawing:

1. The open transient occludes the right-hand columns of the rows beneath it (D4).
2. The reserved-but-blank reality slot spends its measure on a fact triage rows structurally never
   have — correct for cross-surface alignment, and indistinguishable from a layout bug on this
   page alone.
3. The empty state cannot say the clearing was *yours* or *recent*, because no triage event is
   recorded anywhere. Emptying the queue leaves a page identical to a team that has never used
   Triage.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no migration, no new named query.** The single schema-side change permitted is
  `projectId` on `routeIssueArgs` (D1).
- **Every shipped capability survives**: the `a` / `r` / `d` / `j` / `k` / `⏎` keys, oldest-first
  ordering, the viewer's read-only inbox, the command palette's Accept / Route / Decline /
  Send-to-triage actions, and the triage count that feeds the ONE attention number.
- **Keyboard-first**: every verdict reachable and activatable without a pointer; the route
  transient focus-reachable and escapable, returning focus where it came from.
- **Sub-100ms, offline-capable**: everything renders from already-synced rows. The attachment
  chips read the existing `attachments.byIssue` synced query for the one issue under decision —
  no new named query, no ZQL outside `packages/schema`.
- **Accessibility**: verdicts are named buttons, never icon-only; the empty state is announced
  honestly and is distinguishable from the loading state; theme contrast holds in every theme
  block, light and dark, asserted in `packages/ui/src/styles/contrast.test.ts`.
- **The three `triage-*` test ids are preserved** so the e2e viewer assertions hold verbatim.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### B1 — The Project row shipped; `routeIssue` gained the field (D1 executed as written)

`routeIssueArgs` gained `projectId: z.string().min(1).nullable().optional()`. The branch runs the
existence check `setIssueProject` runs — workspace-level, **no** cross-team rejection, because a
project spans teams — and folds `projectId` into the same single `issue.update` that clears
`needsTriage`. `canWrite` / `loadIssueForWrite` ordering is untouched, so a viewer is still refused
before the project is looked up (asserted). No table, no migration, no new named query.

`ai-tools.ts` derives the tool from the args schema, so the field arrived for free; the registry
test previously asserted nothing about `issue.routeIssue`'s fields, so the expectation was **added**
(the field list plus its `write` class) rather than adjusted. Nothing was loosened.

### B2 — A verdict's accessible name is the word alone; the key is `aria-keyshortcuts`

Ambiguous: the rail draws a keycap *inside* the control, which would make the button's accessible
name "A Accept". Chosen: `aria-label` carries the word, `aria-keyshortcuts` carries the key the cap
draws, and Decline's landing status ("canceled", with the shared canceled mark) is wired through
`aria-describedby` so it is announced as a description rather than smuggled into the name. The
alternative — hiding the cap from assistive tech — would have thrown away the one thing a keyboard
user most wants to hear.

### B3 — The route transient is a hand-focused panel, not `Popover` or `Menu`

`Popover` portals its content to the document root, which would take the transient out of the
decision panel's drawn position and out of the queue's key handling; `Menu` fires items on
activation, which is the wrong grammar for five values committed once (D4). Chosen: a
`role="dialog"` panel positioned inside the decision panel, focused on open, escapable, returning
focus to the row it came from, stopping every key from reaching the queue (`a` inside a select is a
typeahead, not a verdict). It keeps an explicit accessible name — `Route ENG-125` — so the e2e
addresses it by role and name; `apps/web/e2e/triage.spec.ts` now names it that way instead of
`Route issue`, and the three `triage-*` test ids are untouched.

### B4 — One age measure, shared

`formatRelative` moved from `issue-list.tsx` to `issues/model.ts` and both surfaces import it. A
second copy would have let the list's `updated_at` column and Triage's `created_at` column drift
out of the same register, which is exactly what "the row anatomy is identical" forbids.

### B5 — A sync tick may not steal focus out of the open transient

The shipped focus effect re-focuses the row whenever the inbox result changes. With a transient
carrying form controls that becomes a mid-edit focus theft on any sync tick, so the effect now
stands down while the transient is open; the transient hands focus back itself on close.

### B6 — The decision panel renders for a viewer; only the verdicts are gated

A viewer's inbox is read-only, not factless: the description, the reporter/created-at line and the
attachment chips are facts they are entitled to. The rail renders only the movement hint for them,
so the four e2e assertions that no `triage-accept` / `triage-route` / `triage-decline` exists hold
verbatim.

### B7 — Loading and team-missing states became labels

`Loading inbox…` → `Loading…`, `This team no longer exists.` → `No such team.` — the word diet's
CHROME tier. `oldest first` is absent over an empty queue, per the mock.

### B8 — The panel's mono facts moved off `--text-3`; the token did not move

Ambiguous: the mock inks both mono lines on the decision panel — the `<reporter> · <created-at>`
line, Decline's landing status, the transient's `ROUTE · ENG-125` kicker and its `none` values — in
`--text-3`, and `DESTINATIONS.md` §4 already names that token as the destinations' weakest ink
while stating that *retuning it is a product change, not a mock change*.

Measured on the panel's own ground (`--bg-selected` over `--bg`) across all six theme blocks,
`--text-3` lands at **2.43–3.33**: under AA everywhere, and under the 3:1 non-text bar in four of
the six. Chosen: **the ink moves, the token does not.** Every fact the panel states is `--text-2`,
which is the same trade the reality rail's mono fact line already made (`contrast.test.ts`,
"the // break ink and the mono fact line"), and the precedent from `issue-list-daylight` DI-2 — if
a pair misses AA the ink changes and the mock loses, not the reader. `--text-3` survives on this
page only where the frame already uses it: `oldest first`, `Loading…`, `⌘K goes anywhere`, and the
two aria-hidden glyphs beside the transient's own word labels.

Four new assertions in `contrast.test.ts`, in every theme block: the panel's ink on its tint, the
ARMED keycap's `--accent-strong` ink and `--accent` border on the cap (4.55–6.65 and 4.55–5.83 —
the pair that could have failed and did not), the resting cap recorded as scaffolding *below* 3:1
so the claim can be falsified rather than assumed, and the empty queue's done disc on the page
ground.

### B9 — The e2e route test proves the project landed on the Projects view, not in the transient

Ambiguous: how to assert the new field "landed" without weakening anything. A read-back of the
transient's own select would only prove the transient remembers what was typed into it. Chosen:
the route test creates a project before the issue reaches the inbox, routes into it, and then
asserts the issue appears under that project on the Projects destination — the same
`project-issue-row` assertion `projects.spec.ts` uses for the palette path. The existing status
assertion is kept as it was, so the test gained a claim and lost none.

The masthead assertion moved from `/Triage/` to `{ name: 'Triage', exact: true }` in both the
member and the viewer flow: the loose regex passed against the shipped `Engineering · Triage`, so
leaving it would have left the word-diet fix untested at the e2e tier. The three `triage-*` test
ids are byte-identical, which is why the viewer's four read-only assertions are unchanged.

### B10 — No pg case: the field adds no unproven Postgres surface

Two pg suites reference `routeIssue`. `mutators.carryover.pg.test.ts` only names it in a comment;
`mutators.notification.pg.test.ts` genuinely drives it, but its subject is the notification fan-out
and a project-placement case there would sit in a file whose subject it is not — which is how a
suite stops being maintained.

Everything the new branch touches at the Postgres level is already driven against real Postgres by
`issue.setProject`: the `zql.project.where('id', …)` existence read and the `issue.project_id`
write, exercised in `queries.anonymity.pg.test.ts`. The field adds no permission path —
`canWrite` → `loadIssueForWrite` ordering is untouched and the project is existence-checked only —
so the pg tier gains nothing it does not already hold, and no new pg file was invented to satisfy a
tier count.
