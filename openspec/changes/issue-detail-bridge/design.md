## Context

Three changes shipped the parts this page assembles, and each left something explicitly waiting
for it:

- **PR #32 (`one-reality-vocabulary`)** generalized the track into three shapes and shipped the
  **vertical rail** — `orientation="vertical"`, a `label` and a `fact` per `TrackStation`, a `//`
  break as a segment kind, and a `--rail-surface` knockout contract so a rail on a panel does not
  paint page colour into it. It has **no product consumer**: component tests and the showcase are
  the only things that mount it.
- **PR #33 (`app-frame`)** shipped bands 1 and 3 and the page-owned band 2 (`Masthead`, with
  title / count / lens / meta / actions).
- **PR #34 (`issue-list-daylight`)** extracted the phrase dictionary into
  `packages/schema/src/zero/phrases.ts` — one classifier over `computeDeliverySignal` +
  `computeDivergence`, two total registers, provenance carried by the **entry** rather than the
  caller, and a source-level test that fails if the strings appear in a second module.

What exists on the issue side of the work graph, and nothing else:

| Fact | Where it lives |
| --- | --- |
| Issue created | `issue.createdAt`, `issue.creatorId` |
| Planned into a cycle | `issue.cycleAssignedAt` + `cycle.name/number/startDate/endDate` |
| Carryover | `issue.carryoverCount` |
| Last human status set | `issue.lastHumanStatusAt` — **one scalar, not a history** |
| Linked to a change | `issue_link.createdAt`, `issue_link.source` (`branch` / `body` / …) |
| Change opened | `pull_request.openedAt`, `repo`, `number`, `url`, `state` |
| Reviewed | `review.submittedAt`, `review.state`, `review.author` |
| Merged | `pull_request.mergedAt`, `mergeCommitSha` |
| Checks | `ci_check.conclusion`, `ci_check.updatedAt` — **no start/finish times** |
| Deployed | `deployment.deployedAt` + `sha`, joined to `mergeCommitSha` in the same repo |

There is **no** issue status-history table, **no** design-artifact entity, **no** issue↔issue
link table, **no** mention edge table, **no** path from an issue to a retro action, and
`notification` is self-scoped with no issue relationship. Half the mock's ink sits on facts in
that list.

## Goals / Non-Goals

**Goals**

1. The page reads as `issue.html` reads: masthead → bifact subline → document column (description,
   files, activity, comments) with the delivery rail, callout, refs and properties in the right
   column.
2. Both registers state the *same* facts. A fact in the mono line that the sentence does not
   support (or vice versa) is a bug.
3. The rail and the activity feed read **one** derivation, so the same moment cannot be dated two
   ways on one page.
4. Every capability the shipped page has survives — description autosave, mentions, image
   attachments, files, comments, properties, follow.
5. The `$issueKey` route resolves a key correctly and cheaply.
6. Everything renders from already-synced rows; no interaction newly waits on the network.

**Non-Goals**

- No new table, no new mutator, no migration, no second phrase dictionary.
- No design artifacts, no backlinks, no status history, no PR comment counts — the four blocks
  the mock draws that nothing backs.
- No changes to the list, board, Home or Delivery surfaces.

## Decisions

### D1 — One derivation for the rail and the feed, in `packages/schema`

`packages/schema/src/zero/issue-timeline.ts` exports a pure
`buildIssueTimeline({ issue, links, deployments, cycle }, now)` returning a typed, ordered list
of **moments**, each with a `kind`, an `at` timestamp, and the typed facts that moment carries
(cycle name, PR repo/number/branch/base, review state + round count, merge sha, check counts,
deploy environment). It computes no strings beyond enum kinds.

Why in `packages/schema`: it is a derivation over synced work-graph rows, it must be unit-testable
without React, and the same rule that put the phrase dictionary beside the delivery seam applies —
two derivations of "when did this merge" is exactly the duplication that ends in two dates on one
page. `packages/ui` and `apps/web` both consume it; neither re-derives.

Alternatives rejected: deriving the feed in `issue-detail.tsx` (untestable without a DOM, and the
rail would inevitably grow its own copy); extending `delivery.ts` in `apps/web` (it is a
per-surface adapter over the schema seam, not a home for a second derivation).

### D2 — A moment exists only if a stored timestamp exists

`buildIssueTimeline` emits a moment **iff** a durable timestamp supports it. Consequences, each
of which is a mock element that does not ship:

- **No `work_started` moment.** `lastHumanStatusAt` says *when a human last set a status*, not
  *which status* nor *what it was before*. The mock's "Work started · board todo → in-progress" is
  two claims the scalar cannot make. It is used only where it is honest: as one side of the
  divergence contrast (D6).
- **No `designed` moment and no DESIGNED station.** No entity.
- **No review-requested moment.** Recorded limit, restated: there is no such event, so "waiting on
  a reviewer since X" is indistinguishable from "PR open since X". The rail says *change opened*
  and dates it; it never says a reviewer has been waiting.
- **No check duration.** `ci_check` carries only `updatedAt`. "Red for 41m" is computable (age of
  the failing check); "checks took 4m" is not. The rail states counts (`14/14 checks passed`) and,
  when red, the age of the failure — never a duration.

### D3 — The rail's stations, and the header that must not over-promise

Stations, in order, each rendered only when its moment exists:

| Station | Node kind | From |
| --- | --- | --- |
| Idea | `empty`/`done` ring | `createdAt`, plus `cycleAssignedAt` + cycle name when planned |
| Change opened | `open` | `pull_request.openedAt`, `repo#number`, branch → base |
| Reviewed | `done` / `rev-wait` | `review` rows: latest state, round count |
| Merged | `done` | `mergedAt`, `mergeCommitSha`, passed/total checks |
| Live / Not live yet | `done` / `empty-urgent` | the `mergeCommitSha ↔ deployment.sha` join |

The mock's rail header reads `idea → designed → built → live`. With the designed station folded,
the header states **`idea → built → live`** — the chain the page can actually draw. A header
promising a station that never appears is the same lie as a disabled menu row.

Node kinds and the `//` break come from `buildRealityShape`'s vocabulary; the rail does **not**
declare a sixth node kind. The break falls on the segment `breakIndex` already derives from which
divergence fired.

The rail's accessible description names the stations it actually drew, in order, and the surface
it is drawn on is declared (`surface="bg"`), because the rail's knockout contract requires it.

### D4 — The bifact: one signal, two registers

The subline is built from **one** `computeDeliverySignal` result per render:

- **Plain line**: status arc + status label · cycle · labels · the shared dictionary's
  `sayRestPhrase(..., 'neutral')` phrase. No second vocabulary; if the dictionary is silent for
  this issue's predicates, the plain line ends after the labels rather than inventing filler.
- **Mono line**: the mono facts the timeline holds — `git merged <sha7> · PR #<n> · drifted <age>`
  — with the GitHub provenance mark under the dictionary's existing rule (the mark suffixes
  sourced facts; it never replaces a status arc and never takes the urgent ink).

`ia.html`'s word diet permits mono sublines **on the detail only**, so this register does not
travel to any other surface.

### D5 — The masthead gains one additive slot, rather than a hand-rolled band 2

`Masthead` grows an optional `kicker?: ReactNode` — the row above the title. The issue page puts
breadcrumb · key · divergence pill there, the title in `title`, the bifact in `meta`, and Follow +
Mark Done in `actions`. Additive: every existing caller is byte-unchanged. The alternative —
this page rendering its own band 2 — is precisely what `app-frame` deleted from ten routes.

The divergence pill is **never colour-only**: it carries the dictionary's text, and its urgency is
carried by weight and ink together, matching the list's phrase treatment.

### D6 — The callout's evidence, and what "Keep as is" is allowed to mean

Evidence line: `in-progress set <age> ago ≠ merge <sha7>, <age> ago`, contrasting
`lastHumanStatusAt` (falling back to `updatedAt` when the scalar is absent, and saying so in the
words it uses) with the merge moment.

- **Mark Done (⏎)** calls the existing `mutators.issue.setStatus` with `done` — the same mutator
  the properties block uses. No new mutator, and the id is the row's own; nothing is minted here.
- **Keep as is (esc)** dismisses **the callout, for this reader, for this visit**. It is local
  component state: it writes nothing, and the divergence pill, the `//` break and the phrase at
  rest all remain. Anything else would be the surface lying about a fact that is still true —
  and there is no "acknowledged" column to write to, which is the honest reason as well as the
  scoping one.

Both are real buttons in the focus order; ⏎ and esc are bound **while the callout has focus
within**, never as a document-level listener, because ⌘K and the frame own the global layer.

### D7 — Referenced in: linked changes only, or nothing

The block renders **only** rows that exist: the linked pull requests with their `issue_link.source`
("matched by branch `eng-116-apple-pay`", "referenced in the PR body"), and the counts of what is
already on the page (files, comments). With no links it **folds away entirely** — no empty state,
no header standing over nothing. The mock's cycle-report, decision and retro-action rows require a
backlink query this change is explicitly forbidden to add.

### D8 — Resolving `$issueKey` properly

New named query `issues.byKey({ teamId, number })`:

```
teamScoped(withLinkedDelivery(zql.issue.where('teamId', teamId).where('number', number) …).one(), ctx)
```

— the same `teamScoped` predicate, the same related subtree and the same `needsTriage` treatment
as `issues.byTeam`, so it can neither widen a read nor expose a triage row the list holds back.

Why an existing query cannot serve: `issues.detail` is keyed by `id`, which the URL does not
carry; `issues.byTeam` syncs the **entire team's** issues with their linked-delivery subtree to
render one, which a deep link on a cold client pays for in full. This is the "genuinely needs one"
case the scoping decision reserved.

Key parsing: the segment is accepted as `<TEAMKEY>-<number>` (case-insensitively matched against
**this team's** key) or as a bare `<number>` — the form the sheet's "open full view" link emits.
Anything else resolves to not-found, and not-found is still distinguished from still-loading.

### D9 — One body, two measures

`IssueDetailBody` takes a `layout: 'page' | 'sheet'`. `page` renders the mock's two columns
(document + rail); `sheet` stacks the same sections in one column at the sheet's measure. The
sections themselves are identical components — there is no second implementation of the rail, the
callout or the feed. The page's masthead lives in the route (band 2 is the page's), the sheet
keeps its own compact header, and neither duplicates the other's content.

### D10 — Word diet and the properties block

Chrome is labels; the document column is the only editorial voice. The properties block keeps
Status, Priority, Assignee, Cycle, Labels and Updates/Follow, and **loses its `Delivery` field**:
the rail states delivery in the right column at full measure, and keeping the 118px horizontal
track as well would be the same facts drawn twice on one page. The mock's `Design` property folds.

### D11 — Sub-100ms and the derivation's cost

`buildIssueTimeline` is O(links + reviews + checks + deployments) for one issue and runs
memoized on the row's identity. The deployment join reuses `buildDeploymentIndex` exactly as the
list does. The by-key query narrows the synced set from "the team's backlog" to one row plus its
subtree, so this change makes the deep-link path strictly cheaper than today's.

### D12 — Accessibility and contrast

The rail is an `<ol>` whose accessible description names the stations drawn (never a summary that
promises a station that folded). The divergence pill and the callout carry text, not colour alone.
`packages/ui/src/styles/contrast.test.ts` is extended with the mono subline ink, the rail's fact
lines, the callout's ink on its tinted ground and the pill's ink — in **every** theme block, light
and dark. Following `app-frame` DI-2 and `issue-list-daylight` DI-2: if a mock colour cannot hold
AA, the ink steps up and the measurement is recorded beside the reason rather than deleted.

## Risks / Trade-offs

- **Half the mock does not ship.** Four blocks fold (designed station, status history, backlinks,
  PR comment counts), and the page will read quieter than `issue-full.png`. That is the correct
  trade — `NORTHSTAR.md`'s own `issue.html` self-critique already says "only real activity history
  can earn the left column back to equal weight" — but a reviewer comparing screenshots must be
  told which absences are deliberate. The docs page names all four.
- **A new named query is a new permission surface.** Mitigated by construction (identical
  predicate to its siblings) and by an integration test that drives it against live Postgres:
  a non-member gets empty, and a member of team A cannot resolve team B's key.
- **The bifact can drift between registers.** Mitigated by both lines being built from one signal
  and one timeline in one function; a unit test asserts the two lines over the same fixture.
- **`lastHumanStatusAt` may be absent** on rows predating it. The evidence line degrades to the
  facts it has rather than printing a bogus age.

## Migration Plan

None. No schema change, no data migration, no env var. The new query is additive; every existing
query, mutator and route is unchanged apart from the two files named in Impact.

## Open Questions

- Whether "Referenced in" should fold entirely when the only referents are the linked PRs the rail
  already draws, rather than repeating them. Resolved during the build with the mock in hand;
  recorded below.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables and no mutators.** One new named query is permitted **only** because resolving
  an issue by key genuinely needs one (D8); it carries the same team-scoped read predicate as its
  siblings.
- **Two honest limits, never papered over:** `ci_check` has no start/finish times (only
  `updatedAt`), so "red for 41m" is computable and "checks took 4m" is not; and there is no
  review-requested event, so "waiting on a reviewer since X" is indistinguishable from "PR open
  since X".
- **The `?open=<issueId>` sheet keeps working**, and the sheet and the full page share their body
  (D9) rather than diverging into two implementations.
- **Keyboard-first:** every action reachable and activatable without a pointer; the callout's ⏎
  and esc behave as drawn; ⌘K is owned globally by the frame — this surface *registers* commands
  and binds no listener of its own.
- **Sub-100ms, offline-capable:** render from already-synced rows; no interaction newly waits on
  the network.
- **Accessibility:** the vertical rail carries a truthful accessible description, the divergence
  pill is not colour-only, and theme contrast holds in **every** theme block
  (`packages/ui/src/styles/contrast.test.ts`).
- **Two hard-won CI lessons carried forward:** no test hard-codes a magic budget that encodes e2e
  fixture size (fixtures accumulate rows across specs — derive bounds from the page), and no test's
  premise is "this environment lacks X" (CI is Node 24, dev machines may be Node 26 — stub the
  environment explicitly).

Taken during the build:

### DI-1 — The rail's "branch → base" has nothing behind it, so no field pretends otherwise

`issue.html` draws the Change-opened station as `eng-116-apple-pay → main`. `pull_request` stores
`repo`, `number`, `url`, `title`, `state`, `headSha`, `mergeCommitSha`, `openedAt` and `mergedAt` —
**no head ref and no base ref**. The plan's phrasing ("head/base refs where stored") resolves to
*not stored*. `IssueChangeOpenedMoment` therefore carries `headSha` and nothing that could be
mistaken for a branch name; the branch fact the page *can* state is the one on the LINK
(`issue_link.source === 'branch'`, "matched by branch"), which is a different claim and a true one.

### DI-2 — `now` is spent on one shared age, not on a second clock

`buildIssueTimeline(input, now)` gives every moment an `ageMs` alongside its `at`. Two fact lines
on one page describing one timeline (the rail's station and the feed's entry) then cannot disagree
about how long ago something happened, which is the same failure mode D1 exists to prevent on the
date axis. It is a number, not a formatted string — the surface still owns the words.

### DI-3 — The deploy join is *called*, not *re-implemented*

The first draft re-derived the `repo + sha` index key inside `issue-timeline.ts`. Its unit tests
failed immediately: `delivery.ts` builds that key with a NUL separator, not the space its comment
describes, and a second copy of a private key format is a bug waiting for a rename. The timeline now
calls `assembleLinkedEntities([link], deployIndex)` with the index `buildDeploymentIndex` produced,
so the join rule — same repo, merged PR only, `mergeCommitSha` against `deployment.sha`, earliest
success, **no `headSha` fallback** — exists in exactly one place. The raw deployment rows are read
back only to name the `environment`, which the index does not carry.

The stale comment in `delivery.ts` is corrected in the same pass (comment only — the separator
itself is unchanged, because changing a shipped join's key format is a behaviour change nothing here
needs).

### DI-4 — `latestMoment` ships beside the derivation

The rail draws ONE Reviewed station and ONE Merged station over a list that may hold several of
each. Left to the page, that scan grows in the component and picks its own tie-break. It is a
four-line export next to the thing it scans instead.

### DI-5 — `issues.byKey` filters `needsTriage`, so a guessed number cannot reach the inbox

`issues.detail` carries no `needsTriage` filter (it is keyed by an id the reader had to already
hold). A by-KEY resolver is different: `(teamId, number)` is guessable, so it takes the
`issues.byTeam` treatment — `where('needsTriage', false)` — and a triage row the list holds back
stays held back. Tested in `queries.test.ts` beside the sibling assertions.

### DI-6 — Key parsing has a third state: undecided

`parseIssueKey(segment, teamKey)` returns `number` (resolved), `null` (not an address in this team)
or **`undefined`** — "the team key has not synced, so `ENG-116` cannot be told apart from
`OPS-116`". Collapsing that third state into not-found is how a correct deep link flashes "this
issue does not exist" on a cold client. The route holds it: not-found is said only once the team
list is complete AND either the segment is malformed or the by-key query returned complete-and-empty.

### DI-7 — `Masthead` gains a kicker with a `data-testid`, matching its siblings

The new row is `data-testid="masthead-kicker"`, in the same style as `masthead-count`, and it is
absent from the DOM entirely when no kicker is passed. Every existing caller's rendered output is
byte-unchanged, which `masthead.test.tsx` asserts directly rather than by inspection.

### DI-8 — The masthead is rendered by the DETAIL, not by the route

D5 says band 2 is the page's. On this page band 2 *is* the issue: breadcrumb, key, the divergence
pill, the two-register subline, Follow and the primary action all read the **same**
`computeDeliverySignal` and the same timeline the rail reads. The route holds only `(teamId,
number)` and a synced row; it has neither the team's deployments nor the issue's cycle, so a masthead
built there would have to recompute the signal from a second set of queries — which is exactly the
"one page, two derivations" failure D1 exists to prevent.

So `IssueDetail` renders the shared `Masthead` itself when `layout === 'page'`, and the route keeps
it only for the two address-resolution states (loading, not-found) where there is nothing but the
segment to say. Exactly one masthead renders in every state, and it is the same component.

The editable title goes in the masthead's `title` slot rather than staying in the document column:
the mock draws the title once, and a page that drew it in band 2 *and* at the top of the document
would be the same words twice. `TitleField` therefore takes `as: 'heading' | 'inline'` — the panel
has no band 2, so it renders its own `<h1>`; the page's field sits inside the masthead's.

### DI-9 — `buildRailShape` joins `buildRealityShape` in the vocabulary

The rail needed two things the vocabulary kept private: which connector a station's node earns
(`segmentInto`) and which segment the `//` falls on (`breakIndex`). Deriving either in `apps/web`
would have been a second copy of the grammar with the first one's name on it — and the break index in
particular is a rule (`status_ahead_of_pr` → first segment, `done_but_ci_failing` → the CI segment,
`status_behind_merge` → last) that must stay identical between a dense row and a rail or the two
drawings of one divergence disagree.

`packages/ui/src/components/reality-track.tsx` gains one exported pure function,
`buildRailShape(stations, { divergence })`, and `buildRealityShape` is refactored to share its
`applyBreak` helper so there is one implementation of the break, not two. Nothing new is DRAWN: the
rail component, its node kinds, its `//` and its knockout contract are PR #32's, unchanged.

### DI-10 — The rail has no lede, because the phrase is already said once

`issue.html` draws a lede above the rail ("Built — not live yet · merged 8f21c4a · no prod deploy
since") *and* a status sentence in the masthead. With one shared dictionary those two collapse into
the same string, and drawing it twice on one page is the duplication the dictionary exists to end.
The phrase lives in the subline, where the two registers are; the rail's header states the chain and
its stations state the evidence. The mock's ritual line ("The work moved, the ritual didn't.") is cut
for the same reason `ia.html`'s word diet cuts explanation sentences from work surfaces.

### DI-11 — The rail's header chain is DERIVED, never written down

D3 fixed the header at `idea → built → live`. That is right for the mock's issue and wrong for an
issue with no linked change, where it would promise two stations that are not drawn. The chain is
therefore computed from what was drawn: `idea` always, `built` once a change is linked or opened,
`live` once one merged. An unlinked issue's rail reads `idea` and promises nothing else.

### DI-12 — Only one divergence has an honest board-side repair

The callout offers **Mark Done** for `status_behind_merge` only. `done_but_ci_failing` is not
repaired by a status — the checks are red whatever the board says — and `status_ahead_of_pr` needs a
change, not a click. Both still draw the callout, the sentence and the mono evidence; they just offer
the dismissal alone rather than a button that would write a lie. A viewer is offered the dismissal
only, in every case.

### DI-13 — `⏎` on a button means what the browser already means by it

No document-level listener exists on this page: the frame owns that layer, and a second global
keydown handler is how ⌘K's ownership was lost before `app-frame`. The `⏎` hint therefore documents
two real bindings and no third: the browser activates a focused button on Enter, and the callout's
own `onKeyDown` answers Enter from anywhere inside its subtree that is not already a button (which
would fire twice). Escape is handled the same way, including from a button, because nothing else
consumes it there. `issue-detail.test.tsx` asserts the negative directly: the same key pressed on
`document.body` writes nothing.

### DI-14 — "Referenced in" stays, and it is the door to the change

The Open Question asked whether the block should fold when the only referents are the linked pull
requests the rail already draws. It does not, for one concrete reason: removing the `Delivery`
property (D10) removed the page's only **link out to GitHub**, and losing an outbound door is a
regression. "Referenced in" carries what the rail deliberately does not — how yapm knows the change
belongs to this issue (`matched by branch` / `referenced in the change body`), the change's lifecycle
state, and the href. With no links it folds away entirely: no header, no empty state, and no new
query was added to manufacture one.

### DI-15 — Follow moves to band 2 on the page, and stays in Properties in the panel

The mock puts Follow in band 2. `FollowControl` is mounted **once** per rendered surface, never
twice: on the full page it is a masthead action, and the properties block's `Updates` field renders
only in the panel, which has no band 2 of its own. Two mounts would give the reader two identical
controls over one subscription. The capability, its hint, its error state and its retry are identical
either way, and it stays available to viewers — a viewer can be mentioned, so a viewer is
auto-subscribed and must be able to stop.

### DI-16 — The phrasing layer is separate from the derivation, and lives in `apps/web`

`buildIssueTimeline` decides what is true and emits no strings beyond its enum kinds (D1).
`apps/web/src/issues/timeline-view.ts` turns those moments into this surface's words — station
labels, fact lines, feed entries and the mono subline. It is pure and unit-testable, it holds the
`ia.html` rule that the mono register lives on the detail only, and it keeps `issue-detail.tsx` a
component file rather than a component file with a dictionary inside it. Nothing there reads a row:
if a sentence cannot be built from a moment, the moment did not happen and the sentence is not said.

### DI-17 — Contrast: the callout's body inks are the new pair

`contrast.test.ts` already held `--status-urgent-ink` over the `--urgent-soft` composite (the digest's
divergence row). What this change adds to that ground is `--text-1` (the callout's sentence) and
`--text-2` (its mono evidence line) — asserted at AA normal in all six theme blocks, and passing in
every one with no token edit needed. The mono subline and the rail's fact lines are `--text-2` on
`--bg`, which the block's first assertion already holds; a second assertion over the same pair is how
one of the two quietly stops being maintained, so the reasoning is recorded beside the new one
instead.

### DI-18 — What the e2e suite had to change, and what it must not

`connectors.spec.ts` asserted the panel showed `DIVERGENCE_LABEL` ("PR merged but this issue is not
marked done") — a string the removed `Delivery` property rendered. The fact did not go away; it is
now stated in the shared dictionary's words. The assertion was **strengthened rather than relaxed**:
the pill's exact dictionary text, the rail, the `//` break, the "Not live yet" station and both
halves of the two-register subline naming the same merge commit. A new spec drives the whole bridge
from the keyboard on the full page — breadcrumb, key, pill, chain, evidence, then ⏎ on the callout —
and asserts that marking done removes the pill, the callout AND the break, because all three state
one fact that stopped being true. No bound anywhere is a hard-coded fixture size.

### DI-19 — The address resolver is a component, because a route body cannot be driven

Task 6.7 asks for a test that `ENG-116` resolves, a bare `116` resolves, `OPS-116` in team ENG is
not-found, and loading is distinguished from missing. The first three are the parser's, and
`model.test.ts` holds them. The fourth is **not the parser's**: it is the three-way decision the route
makes over two query results, and DI-6's whole point is that the third state exists. That decision
sat inside a `createFileRoute` component reachable only through a `RouterProvider` — which is to say,
only through the e2e suite.

So the body moves to `apps/web/src/issues/issue-address.tsx` (`IssueAddress({teamId, issueKey})`) and
the route becomes what every other route in this app already is: params, `Authenticated`, `AppFrame`,
one feature component. `issue-address.test.tsx` then drives all three states directly, including the
two that no e2e run can produce on demand — a by-key query that has not answered yet, and a team list
that has not answered yet. Mutating `undecided` to `false` fails exactly one case, which is what makes
it a check rather than a decoration.

The harness models one thing the earlier detail harness did not need: an unanswered `.one()` query
yields `undefined` and an unanswered collection yields `[]`. Collapsing those two is how a test claims
"missing" is rendered when the surface actually renders "loading".

### DI-20 — Two claims the docs make that only a test can keep true

The docs page states that ⌘K on this surface offers *Mark done* and *Open the change*, and that a
viewer is offered neither. Nothing asserted either: `useCommandSource` is inert without a provider, so
the existing suite — which renders the detail bare — proved only that registering did not throw.
`issue-detail.test.tsx` now mounts the detail inside `CommandRegistryProvider`, presses ⌘K on
`window`, and selects *Mark done* through the palette to the same mutator. It is the positive half of
the assertion that was already there in the negative: nothing is bound on `document`, and what is
registered actually arrives.

The e2e suite gains the address contract it never had — the panel's door, the key typed into the bar,
and another team's key resolving to nothing. The key is READ OFF THE PAGE (the team key is generated
per run), so no bound in it is a fixture value.

### DI-21 — One pull request backs the issue, and the signal says which

The plain register's phrase comes from `computeDeliverySignal`, which describes the **newest-opened**
linked change. The mono line and the rail were reading the timeline directly and picking "the" pull
request by their own rules — `latestMoment(…, 'merged')` for the sha, `latestMoment(…,
'change_opened')` for the number. On an issue with one linked change those rules agree; on an issue
with two (a merge and a later follow-up still open) they describe two different changes as though
they were one, and the mono line lends an old merge commit to a sentence about a new change.

`DeliverySignal` therefore carries `pullRequestId` — *which* change the rest of the signal is about —
and `assembleLinkedEntities` carries the row id through to it. `apps/web` narrows the moment list to
that change (`momentsForChange`) before phrasing the mono line, the rail and the callout's evidence.
Deriving the same selection a second time in `timeline-view.ts` was the alternative and is the thing
this change exists to prevent.

The activity **feed** is deliberately not narrowed: a feed reports what happened, and a second linked
change is one of the things that happened.

### DI-22 — A pending check is not a failing check

`checksFact` printed `checksTotal - checksPassed` as the failing count, which calls every check that
has not reported yet a failure. `IssueMergedMoment` now carries all four counts — passed, failing,
pending, total — from the `checkCounts` pass that already computed them, and the line states the
pending ones separately ("1 of 14 checks failing, 2 still reporting") rather than folding them into
the failure tally. Every fixture in the suite was uniformly green, which is why the arithmetic
shipped; the mixed case is now a unit test on both sides of the seam.

### DI-23 — The on-accent key hint carries no opacity

The 10px `⏎` keycap inside Mark Done inked itself `text-primary-foreground/80` on the accent fill.
That is the one pair `contrast.test.ts` pins at 4.5, stepped under AA in five of six theme blocks by
a modifier no token assertion can see. The ink is solid now; the keycap stays quiet through its size.
Its border is non-text drawing and remains an alpha, raised to 75% because 60% measures 2.46 in
editorial light — and both halves are now measured in `contrast.test.ts` beside the callout's pair.

### DI-24 — The callout hands focus somewhere deliberate

Both callout actions unmount the element holding focus. Left alone that drops a keyboard reader to
`<body>` at the exact moment the flow is keyboard-only. The `Delivery` section — the thing the
callout was talking about, and the one that survives both outcomes — takes `tabIndex={-1}` and is
focused by both handlers before the callout goes. It is a landing place, not a tab stop.
