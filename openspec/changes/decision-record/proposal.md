## Why

The triangle's most expensive failure is not a missed deadline. It is re-litigating a settled
debate six weeks later because the settlement lived in comment 47.

Every tracker on the market records that a *status* changed. None of them remembers *why*. yapm's
whole wedge is that the work graph holds the facts an issue tracker throws away — the PR, the
check, the deploy, the incident — and the one fact it still throws away is the team's own reasoning.
`design-explorations/overhaul-2026-08/plays/PLAY-decisions.md` is the approved argument and
`plays/decisions-thread.html` + `plays/decisions-record.html` are the approved drawings: a thread
can end in one sentence, that sentence is pinned above the thread it distilled, and the sentences
accumulate into a team page that answers *"why did we do it this way?"* six weeks from now.

It is also the change that pays off a fold already standing in the shipped product:
`northstar/home-digest-2.html` draws a **DECIDED THIS CYCLE** band that Home does not render. This
change builds the entity, so that fold opens.

A second fold stays shut. `destination-budget` published a budget for the deck while this change sat
parked, and **this change is the first the budget says no to** — the first surface in the repository
whose placement is decided by a rule it does not own, rather than by its own argument. PR #33 also
folded the **Decisions** item out of `more▾` with the comment *"no entity backs it, and a disabled
row is chrome promising what the product cannot keep"*, reassigning `g d` to Delivery in the
meantime — and the first draft of this proposal read that as a condition that had expired: build the
entity, take the menu item back, take `g d` back, move Delivery to `g s`. That plan is now
withdrawn — but its premise was half right, and the half that was right has to be paid: *"no entity
backs it"* really does stop being true the moment this change lands, so the three comments that give
it as the reason (`deck.tsx:23-24`, `go-to.ts:8`, `app-frame.test.tsx:499-500`) are corrected to the
reason that replaces it. The conclusion they support does not move; only the reason does. The
budget's ceiling is eight destinations, and
`destination-budget/specs/app-frame/spec.md:30-32` says where the deck stands against it: *"Today
the deck stands exactly at its ceiling: Home, Issues, Cycles and Delivery on the bar, and Triage,
Retros, Projects and Roadmap in the menu's permanent list."* A ninth is not free anywhere —
`:168-170` says *"Growth by menu is growth. A change adding to the menu's permanent list spends
exactly the same budget as one adding to the bar, and no requirement, scenario or review SHALL
treat the menu as the cheaper door"* — and `:162-166` says what a change at the ceiling owes:
name the destination it displaces and **show** it failing one of the three admission tests.

This change can name none. Every one of the eight is a place a team works, and arguing Triage or
Roadmap out of the deck to make room for a record that is read a few times a cycle would be the
displacement rule used as a crowbar. So the budget's answer applies here in its published form —
`destination-budget/proposal.md:96-97`: *"The budget is zero destinations; the answer is where, not
no"* — and the *where* is already written down for this surface. Its placement table
(`destination-budget/proposal.md:107`) lands the Record as **a doorway at
`/teams/{teamId}/decisions`**, which is the shape `openspec/specs/app-frame/spec.md:259-267` already
blesses ("a doorway from a page that is itself reachable" is a first-class home, and search, the
inbox, digests, the settings surfaces, team members and theme selection all live that way) and the
shape `northstar/ia.html:368` already draws in its own note: *"the Record and Runway are pages
without bar seats — doorways reach them."* The northstar contradicts that note within the same
section — its destination tree hangs `Decisions` under `more ▾` (`ia.html:364`) and its drawn-open
menu gives it a `g d` hint (`:375`) — and `destination-budget` owns that redraw. The note is the
half that survives.

The rest follows without further argument. `g d` **stays Delivery's** and the `g s` swap does not
happen, because `destination-budget/specs/app-frame/spec.md:262-264` says *"Only a destination SHALL
hold a `g` binding. A lens, a doorway, an artifact and a transient SHALL NOT — they are reached from
the surface that owns them, from the command palette and from search"*. A doorway that quietly kept
a key would be a destination wearing a smaller word.

Vision principles served: **the work graph is the product** (a decision is a first-class node, not
a comment convention); **team-level only, structurally** — the decision table has **no author
column at all**, the same structural guarantee `retro_card_author` gives the retro, made impossible
in the schema rather than merely discouraged in the UI; **keyboard-first**; **sub-100ms and
offline** (the record renders from already-synced rows); **free means free**.

## What Changes

**A `decision` entity — the first new table in this design series.**

- Team-scoped, one plain sentence (capped, so it stays a sentence), a `decided_at`, a link to the
  issue whose thread it distilled, the comment range it came out of, the count of comments in that
  thread stamped at decide time, and an optional `revisit_cycle_id`.
- **No author column, no owner column, no `decided_by`.** Not nullable, not server-only —
  *absent*. The chip's provenance line reads `from a thread of 5 · the team's call, no owner`, and
  it is true because there is nothing in the row that could say otherwise. A drift test asserts
  the absence in Postgres *and* in the Zero schema, so a later change cannot add one quietly.
- Forward-only Kysely migration applied at boot, hand-written Zero schema entry, team-scoped read
  predicate identical in shape to its siblings, and the CI drift test between the Zero schema and
  the live Postgres schema covers every column.

**A Decide affordance in the comment composer.** Any thread can end in one sentence: a `Decide`
control beside `Comment`, reachable from the composer without a pointer, opening a single-line
field with the sentence budget stated. Writing a decision is a normal team-member write; there is
no admin bypass for *reading* another team's decisions.

**The decision chip, pinned above the thread it distilled.** The sentence in plain type, provenance
as a mono line, the revisit pill where one is set — and the thread beneath it truly collapses
(the play's "quiet by opacity" is explicitly filed as a sketch; a real 40-comment thread needs a
real collapse with a control that says how many are behind it).

**The Decisions record page**, at `/teams/{teamId}/decisions`, **reached as a doorway and holding no
seat in the deck**: `Decisions` + a mono count, the standfirst, a search field, chip-rows grouped by
cycle, the revisit pill where one is set, one row unfoldable in place to read the *why* without
leaving. **No owner column exists on the page because none exists in the row.**

**The Record's three doorways**, none of which is a deck seat or a `g` key:

- the pinned decision chip on the issue whose thread it distilled;
- Home's **DECIDED THIS CYCLE** band, whose chips lead to their issues and whose header leads to the
  Record;
- a command-palette row on every team surface, with no shortcut string, sitting beside `Go to inbox`
  and `Search everything` — the two doorways the frame already registers exactly this way
  (`apps/web/src/frame/app-frame.tsx:94-103`, neither carrying a `shortcut:` field, which is the
  evidence `destination-budget/design.md:431-435` cites for the binding rule).

The palette row is load-bearing rather than a convenience: the chip and the band both come from
rows, so on a team that has recorded nothing they are both absent, and without it the empty Record
page — which this change specs a scenario for — would be reachable only by typing its URL. That
would fail `openspec/specs/app-frame/spec.md:259-267`, which requires every authenticated route to
be reachable from the frame without prior knowledge of its URL.

**One fold opens.** Home renders **DECIDED THIS CYCLE** — decision chips, no owner, folding entirely
when the cycle holds none. The `more▾` fold stays shut, `g d` stays Delivery's, and no route,
shortcut or deck seat moves.

**Honesty constraints, carried into the requirements.** A decision **never expires** — it gets
revisited. No glyph fades, no row dims with age, nothing sorts by staleness. A revisit marker names
a cycle and says, in words, that it will resurface at that cycle's planning; **there is no planning
surface in yapm yet**, so the marker stores, displays, and lists under a "revisits due" filter on
the record page — and the docs say plainly that resurfacing at planning arrives when a planning
surface does, rather than implying it already happens.

Non-goals — deliberately folded:

- **The triangle rail's DESIGN section** (`decisions-thread.html`'s right rail). It assumes design
  frames attached to comments as first-class artifacts; those do not exist. Filed as SKETCH by the
  play and not built.
- **A `D` bare-key shortcut on the thread.** The composer's control and the palette are the two
  routes; a bare letter over a page full of prose is a keystroke waiting to fire by accident.
- **Area labels from the AI change-area map.** `areas.ts` maps repository file paths, not issues.
  The record page's area column is the issue's own labels or nothing.
- **AI-suggested decision sentences.** The play's own self-critique says the tool can suggest an
  editing discipline but not enforce one; a model writing the team's settlement is the opposite of
  what this entity is for.
- **A planning surface.** Named above; out of scope, and said so on the surface.
- **No new container, service, job, dependency or env var.**

## Capabilities

### New Capabilities

- `decisions`: the decision entity and its record — what a decision is, the ownerless guarantee,
  how one is made from a thread, how the record page reads, searches and groups, what a revisit
  marker means and where it will resurface, and the rule that the record never fades.

### Modified Capabilities

- `issue-detail`: the comment thread gains the Decide affordance, the pinned decision chip above
  the thread, and the true collapse of a thread a decision has settled.
- `app-frame`: **one scenario, and nothing else.** The deck's membership, its tiers and its
  bindings are untouched. `destination-budget`'s "A bounded deck: eight destinations, and everything
  else is a doorway, a lens or a transient" carries the scenario "A destination with no entity
  behind it does not render", whose WHEN reads *"in a build where no decision entity exists"*
  (`destination-budget/specs/app-frame/spec.md:106-109`). Shipping the entity falsifies that WHEN
  and leaves the rule with no case to exercise, so the scenario is re-pointed at the general shape —
  a destination the interaction model draws with no entity storing its rows — and the requirement is
  restated in full around it, every other sentence and all ten other scenarios carried through
  verbatim.
- `team-home`: the DECIDED THIS CYCLE band, and the band-order and no-new-query clauses that
  currently forbid it. The digest requirement is restated as the **union of three** — the text
  `explanation-at-rest` ships (the composition record behind a `how ·`, the "no explanatory prose at
  rest" paragraph, the "states no derivation at rest" scenario), the footer rationing
  `destination-budget` adds, and this change's band — because all three restate one requirement and
  a `## MODIFIED` block overwrites wholesale.
- `local-first-sync`: team-scoped `decision` sync, deny-by-empty, auth-before-existence, no admin
  read bypass across teams — and the structural absence of an author column asserted by the drift
  test.

## Impact

- `packages/schema/src/migrations/0024_decision.ts` (new) + `migrations/index.ts`; `db/types.ts`
  gains the `decision` table; `db/schema-drift.test.ts` gains its shape *and* the absent-author
  assertion.
- `packages/schema/src/zero/schema.ts`: the `decision` table entry and its relationships.
- `packages/schema/src/zero/queries.ts`: `decisions.byTeam` (one named query, serving the record
  page and Home), and `.related('decisions')` inside the existing issue-detail query's existing
  `teamScoped(...)` predicate.
- `packages/schema/src/zero/mutators.ts` + `server-mutators.ts`: `decision.record`,
  `decision.revise`, `decision.retract`.
- `packages/schema/src/zero/decisions.ts` (new): the pure derivations — cycle grouping, search
  match, provenance phrasing — computed client-side over synced rows.
- `packages/schema/src/zero/team-home.ts`: the DECIDED THIS CYCLE band model.
- `apps/web/src/decisions/` (new): the record page; `apps/web/src/routes/teams.$teamId.decisions.tsx`.
- `apps/web/src/issues/issue-detail.tsx`: the Decide control, the pinned chip, the settled-thread
  collapse.
- `apps/web/src/frame/deck.tsx` and `go-to.ts`: **behaviour untouched.** No item joins `more▾`,
  `DeckStop` gains no member and no `g` case changes — the budget's whole point, and the reason
  `openspec/specs/delivery-metrics/spec.md:226` ("or by its `g d` shortcut") needs no amendment and
  `delivery-metrics` is not among this change's modified capabilities. Their *comments* do change,
  once: `deck.tsx:23-24`, `go-to.ts:8` and `app-frame.test.tsx:499-500` each say Decisions folds
  away because *"no entity backs it"*, and this change ships the entity. Each is reworded to the
  reason that survives — the budget's ceiling and the doorway placement (design D10) — leaving
  `deck.tsx`'s comment still carrying the sentence `destination-budget/design.md:214` cites it for.
- `apps/web/src/frame/app-frame.tsx`: one palette row for the Record, registered where the frame
  already registers the inbox and search (`:93-117`), with **no `shortcut:` field**. The frame
  builds one `Go to` group: the eight destination rows (`:124-179`) and then `...commands` spliced
  at its tail (`:180`). The Record's row joins the frame's existing shortcut-less rows at that tail
  exactly as `Go to inbox` and `Search everything` do, so this change adds no row carrying a
  `shortcut:` and needs no `command-palette` delta. Reconciling
  `destination-budget/specs/command-palette/spec.md:37-42`'s set-identity clause against that
  group's pre-existing doorway rows is `destination-budget`'s obligation, not this change's.
- `apps/web/src/routes.test.tsx`: `ROUTE_HOMES` gains `'/teams/$teamId/decisions': 'doorway'`.
  `destination-budget/tasks.md:35` and `:36` turn that table's values into assertions — `:35` that
  every `'stop'` is a bar link and every `'more'` is a menu item, `:36` that at most eight rows are
  either — so `'more'` here would fail a test that ships before this change builds.
- `apps/web/src/home/team-home.tsx`: the DECIDED band, and the band header's doorway to the Record.
- `packages/ui/src/components/drawn.tsx`: the decision mark (a fact held inside a promise) on the
  shared 20-unit grid — additive only.
- `packages/ui/src/styles/contrast.test.ts`: this surface's pairs, **appended as a clearly
  delimited block at the END of the file** (three cross-branch merge conflicts in this series say
  why).
- `apps/web/e2e/decisions.spec.ts` (new): deciding a thread, and reading the record.
- No dependency, env var, container, service or job is added or changed. `ROADMAP.md` is not
  edited — parallel builds; the maintainer adds the row at archive time.

Docs: `apps/docs/src/content/docs/features/decisions.md` (new — the entity, the ownerless
guarantee and why it is structural, deciding a thread, the record page, revisit markers and the
plain statement about where they will resurface, **and that the Record is reached from the chip, the
Home band and the palette rather than from the deck**); `features/issue-detail.md` (the Decide
affordance and the settled thread); `features/team-home.md` (the DECIDED band and its doorway);
`README.md`'s feature list. **`features/app-frame.md` is not edited**: the deck's list and the
keyboard table are unchanged by this change, and the page `destination-budget` leaves behind stays
true.
