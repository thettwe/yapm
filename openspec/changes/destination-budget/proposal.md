## Why

`openspec/specs/app-frame/spec.md:47` is the sentence this change exists to reopen:

> The deck SHALL present exactly six stops in order: Home, Issues, Triage, Cycles, Delivery,
> and a `more` menu.

Three lines later the same requirement says the sixth is not a destination at all —
`app-frame/spec.md:50`: *"The `more` menu SHALL be a transient, never a destination: it opens on
activation, lists Retros, Projects and Roadmap with their keyboard hints."* So the number counts a
transient and stops there. The deck actually offers **eight** places: five bar stops plus the three
in the menu, which is exactly what `apps/web/src/frame/deck.tsx:26-34` declares (`DeckStop` has
eight members) and what `apps/web/src/frame/go-to.ts:35-71` implements (eight `g` cases). The
product's own test says the quiet part out loud: `apps/web/src/frame/app-frame.test.tsx:272` is
named *"the deck offers the six destinations and nothing else"* and asserts an array of **five**,
with a comment at `:282` reading "The sixth is `more▾`".

**The sentence caps bar seats and says nothing about the menu, so every queued addition goes where
the sentence cannot reach.** `openspec/changes/decision-record/specs/app-frame/spec.md:5-10`
demonstrates it perfectly: it adds a ninth destination and reproduces "exactly six stops" *verbatim*,
editing only the menu's item list. Nothing about that delta is dishonest — the sentence it copied
genuinely does not cover what it changed. A budget with a hole in it is worse than no budget,
because it lets a change grow the deck while truthfully reporting that it left the budget alone.

`openspec/SCOPE-legibility.md:74-87` is why this is D1's problem rather than a footnote: three
families are queued against the same deck, "both queued families add destinations to a deck that is
already at its written budget, and neither can be blamed for it, because no change owns the budget."
This change owns it.

Vision principles served: **keyboard-first** — a `g` grammar is only worth learning if it is
constant, and this change makes constancy a requirement rather than an accident; **speed is the
feature** in the form `DESIGN.md:33` states it — *"only the hero of a page is allowed a sentence"* —
applied to chrome instead of prose, because a deck is a list of things to learn and the maintainer's
complaint was that there are too many; **metrics are never surveillance** — `VISION.md:49` says
"yapm has no read log, and adding one would be the wrong side of this line", which is precisely why
the rule this change writes is structural and can never be "the destinations people visit most".

## What Changes

**The count moves from bar seats to destinations, and the ceiling is eight.** The deck offers at
most eight destinations at any width, in two tiers: at most four on the bar plus the `more` trigger,
and the rest in the menu's permanent list. Home and Issues never leave the bar. The ceiling is not
chosen, it is derived — see design D2. Today the deck stands **exactly at** it, which means the
budget published to the other two families is **zero new destinations**.

**Triage moves from the bar to the menu.** This is the removal the maintainer put on the table
(`SCOPE-legibility.md:54-56`), taken in its reversible form. The argument is not that Triage is
empty today; it is that **nothing in the shipped product fills it**. `openspec/specs/triage/spec.md:30`
concedes it in the capability's own words — issues enter triage "created with `needsTriage` set
through `issue.create` — the argument a programmatic ingest of externally-created issues would set;
**no shipped UI surface or connector sets it today** — or flagged from an existing issue through
`issue.flagTriage`." The one runtime path is `apps/web/src/issues/command.tsx:293`, reached from the
palette row `Send to triage` at `:791-801`: a member choosing an action on an issue they are already
reading, which forwards work rather than receiving it. `packages/schema/src/zero/mutators.ts:766`
and `:804` show `needsTriage` defaulting to `false` with no shipped caller passing `true`; the only
`true` rows in the repository are two seed fixtures (`packages/schema/src/db/seed.ts:216`, `:224`)
behind `SEED_DEMO_CONTENT`, checked at `apps/server/src/auth-routes.ts:106`. Nothing is taken away:
the route, the verdict keys, the `g t` binding, the palette entry and the requirement that triage is
never a view switcher all survive untouched.

**A rule a future change can apply without asking.** Three tests — an entity of its own; not a
re-cut of one collection another destination owns and not that destination's interior; a producer
that fills it in the ordinary course of work — plus the tier each failure lands in, plus a
displacement obligation: at the ceiling, a change adding a destination must name the one it displaces
and show it failing a test. **Growth by menu is growth**, stated as a requirement so the loophole
cannot reopen.

**A zero count does not fold a destination, and this change says why rather than leaving the
inconsistency to be noticed.** `app-frame/spec.md:169` requires "Zero is absence, not a zero" for the
attention badge; `apps/web/src/frame/deck.tsx:279-280` gives the reason — a rendered `0` "would be a
claim that four exception classes were evaluated and all came back empty". That reasoning is about a
*number*. A destination is not a number; it is an offer of a place, and the place exists whether or
not it holds anything this morning. Folding one on a count would also break a promise that is
already written: `app-frame/spec.md:20-21` — *"The deck SHALL be identical on every page — nothing in
it adapts to the page except which destination is marked current"* — and a deck that adapts to a
team's data varies across mornings instead of across pages, where a reader cannot see the two states
side by side to learn the rule. **The refusal is now a requirement**, and the permanently-empty case
that raised the question is resolved once, at the tier, instead of per team by the deck.

**A `g` binding belongs to its destination, not to its seat.** Moving a destination between tiers
never changes its key — which is the whole answer to "what happens to someone who learned the old
deck". Only destinations hold bindings; lenses, doorways, artifacts and transients do not, which is
already true of the inbox and search (`apps/web/src/frame/app-frame.tsx:95-103` registers both with
no `shortcut:`). A change that reassigns a key must move **every** advertisement in the same change,
including every requirement in every capability that names it.

**Home's onward footer is rationed, because it was handed here twice.**
`openspec/changes/front-door/proposal.md:101-107` declined it and said "deciding how much of it to
ration is D1 `destination-budget`'s work"; `SCOPE-legibility.md:208-210` calls it "a second
navigation system on the one page that least needs one". The footer keeps the board — a lens, and the
only one of its five with no seat of its own — and the `⌘K` hint. Issues, Delivery, Retros and
Roadmap go, because each is a deck destination. Band-owned doorways are untouched: the cadence band
still links to Delivery (`openspec/specs/team-home/spec.md:257`) and the hero's artifact chip still
opens its retro.

**What this publishes to the two queued families.** The budget is zero destinations; the answer is
*where*, not *no*:

| queued change | may add | where |
|---|---|---|
| A1 `project-schedule`, A2 `issue-dates`, A3 `issue-dependencies` | nothing | facts and affordances on surfaces that exist; A1 says so itself (`SCOPE-planning-surfaces.md:76`) |
| B1 `timeline-lanes` | nothing | the Roadmap destination's **interior** — A1 already turns its dots into bars, so B1's remaining increment is resolution, not a new place. `SCOPE-legibility.md:79`'s phrase "a timeline destination" was written before anyone costed it; this change costs it |
| C1 `board-swimlanes` | nothing | the Board lens's interior, which costs no budget at all (`app-frame/spec.md:54`) |
| D1 `status-history` | nothing | a table; no surface |
| D2 `flow-analytics`, D3 `team-capacity` | nothing | sections of Delivery, where `app-frame/spec.md:229` already requires the team-level metrics promise to live |
| D4 `workload-view` | nothing | a **lens** in the Issues masthead — open work re-cut by assignee is one collection re-cut, which is the definition test 2 applies |
| `decision-record` | nothing | the Record as a **doorway** at `/teams/{teamId}/decisions`, reached from the decision chip its own proposal builds (`decision-record/proposal.md:46-49`), from Home's DECIDED THIS CYCLE band (`:58`), from search and from the palette — the shape `app-frame/spec.md:262-265` already blesses and `northstar/ia.html:368` already draws ("the Record and Runway are pages without bar seats — doorways reach them") |

The consequence for `decision-record` is stated plainly rather than left to be discovered: as
authored it puts the deck at nine, and **two of its deltas must be re-authored before it builds.**
Its `app-frame` delta changes in two places — the `more` item, and the `g d` → Decisions / `g s` →
Delivery swap. **`g d` stays Delivery's**, which is also why
`openspec/specs/delivery-metrics/spec.md:226` ("or by its `g d` shortcut") needs no amendment here.
That the swap would have made `delivery-metrics` stale while `decision-record/proposal.md:94-105`
does not list that capability is the exact defect the new binding rule prevents.

Its **`team-home` delta must be re-authored too**, and that one is easier to miss because the band it
adds costs the budget nothing. That delta is not `## ADDED` only: it carries `## ADDED Requirements`
at `:1` **and** `## MODIFIED Requirements` at `:33`, restating "The team page is an adaptive digest
composed from synced work-graph facts" (`:35`) wholesale — the same requirement B1
`explanation-at-rest` and this change both restate, which puts three in-flight changes on one
requirement. Its body at `:39-40` still reads "then a composed mono footline and an onward footer
(Issues · Delivery · Retro · Roadmap, with a ⌘K hint)" — the pre-B1, pre-D1 text — so archiving it
after the other two would silently revert both B1's `how ·` composition record and this change's
footer rationing. `decision-record/proposal.md:94-105` already lists `team-home` among its modified
capabilities, so the obligation is visible from inside that change too. This change edits none of
`decision-record`'s files; design D8 and D14 record the collision and the repair.

**The northstar is redrawn, and this change owns the redraw.** `SCOPE-legibility.md:107-111` settled
it: the specs win, and "whichever change moves the frame owns that redraw; leaving the mocks
contradicting the product is the one outcome ruled out." This change moves the frame, so it annotates
`NORTHSTAR.md` and edits all eight mock decks. Scope is smaller than it looks: the 16 PNGs are
gitignored (`.gitignore:55`) and `git ls-files` returns only the nine tracked files, so there is no
screenshot to re-render and no reviewer who ever sees one.

Non-goals — deliberately not done:

- **No destination is retired from the product, and none becomes a lens.** Triage moves tier; it does
  not stop being a destination. Making it a lens on Issues was considered and declined (design D5):
  it would reverse `triage/spec.md:109`'s explicit refusal of a per-page view switcher, and it is a
  one-way door where a demotion is a one-line reversal when a producer ships.
- **Triage's masthead count is untouched.** `triage/spec.md:115` requires "a mono count of the waiting
  issues" and carves out only the ordering label on an empty queue; `retrospective/spec.md:397`
  mandates the same shape. A page stating what it holds, on a page you deliberately opened, is that
  capability's decision — see design D4 for why the badge rule stops at the frame.
- **No shortcut is rebound and no route moves.** `g h/i/t/c/d/r/p/m` are unchanged
  (`apps/web/src/frame/go-to.ts:35-71`), and so is every route file.
- **No producer for triage is built.** An ingest, an inbound path or an issue-creating connector is
  the change that earns Triage its bar seat back; naming the condition is this change's job, meeting
  it is not.
- **`Roadmap` keeps its seat.** It is the hardest live case for test 2 and it is argued rather than
  assumed (design D6), not waved through.
- **The two empty states that also draw doorway feet are audited and deliberately left whole.**
  Triage's cleared queue (`apps/web/src/triage/triage-view.tsx:1004-1031` — `Issues` at `:1019`,
  `Cycles` at `:1021`, `Projects` at `:1023`, with the same `·` dividers and the same
  `⌘K goes anywhere` hint Home's footer carries) and the empty notification inbox
  (`apps/web/src/notifications/inbox-view.tsx:498-519` — `Issues` at `:513`, `Home` at `:515`) are
  the only other surfaces in `apps/web/src` that draw one. Both are required to:
  `openspec/specs/triage/spec.md:241` mandates "an onward foot to the surfaces a member goes to
  next" and `openspec/specs/notifications/spec.md:668` mandates "at least one onward doorway". The
  second-navigation requirement is therefore written to reach a page that has shown its own content,
  not an empty state whose doorways *are* its content — see design D13, which argues the narrowing
  and records what an unqualified rule would have cost. Neither file is edited here, and neither the
  `triage` empty-queue requirement nor the `notifications` capability is modified by this change.
- **No first-run or teaching surface.** E1 `notation-legend` and E2 `first-run` own that, and
  `SCOPE-legibility:172` already sequences E1 behind this change.
- **No new table, migration, query, mutator, dependency, env var, container or route.**

## Capabilities

### New Capabilities

<!-- none: this change reopens a requirement, replaces it with one that counts correctly, and adds
     the rule that keeps it counted -->

### Modified Capabilities

- `app-frame`: the "six stops" requirement is **removed by name** — its title is part of what is
  wrong — and replaced by one stating a ceiling of eight destinations across two tiers, with five of
  its six scenarios carried through verbatim, the sixth (the menu's keyboard scenario) generalised
  from "the retro/projects/roadmap items" to "every destination in its permanent list" because
  Triage joins that list, and the menu's current-page marking made explicit. That same replacement
  requirement also carries **the second-navigation prohibition** — a surface that has rendered its
  own content may not stand a list of deck destinations at its foot — together with the
  **empty-state carve-out** that keeps it off a surface whose doorways *are* its content, and the
  two scenarios that make both halves acceptance criteria rather than prose ("A page with content
  does not rebuild the deck beneath it" and "An empty state may point at a destination"). The
  carve-out is argued in design D13, which audits the two shipped feet an unqualified rule would
  have emptied.
  Three further requirements are added: the rule for what earns a place and what a new one costs;
  the refusal to vary the deck with a team's data, with the badge rule's boundary stated; and the
  binding rule that a `g` key belongs to its destination rather than its seat.
  One existing requirement is **modified**: "Honest degradation where no team is in context"
  (`app-frame/spec.md:179-212`) names the old count three times — `:181`, `:184` and its first
  scenario's THEN at `:194` — so leaving it alone would archive a capability saying four in one
  requirement and six in another. It is restated in full, with all four of its scenarios, and the
  only edit is the count word: the stops become the deck's destinations, however many the budget
  allows. The capability's Purpose line (`app-frame/spec.md:6`, "It carries the six destinations")
  says it a fourth time and **no delta can reach it** — OpenSpec's archive step rewrites only the
  `## Requirements` section — so it is corrected by hand at archive time, in §8 of the task list.
- `triage`: the Triage destination sits in the `more` menu's permanent list rather than on the bar,
  with the producer argument and the return condition written into the requirement. It stays a
  destination and not a lens, keeps `g t`, and the masthead-count and one-count-everywhere clauses
  are carried verbatim.
- `command-palette`: the always-present set stops being "the six destinations" — already wrong at
  eight and wrong again at every future number — and becomes the deck's own membership, with the
  reason a bar destination needs its binding stated here: the palette is the only place in the
  product that advertises it.
- `team-home`: the onward footer carries only what the deck does not offer as a destination, plus
  the `⌘K` hint; band-owned doorways are explicitly unaffected. This delta is authored against
  **B1 `explanation-at-rest`'s** version of that requirement rather than the one in
  `openspec/specs/team-home/spec.md` — B1 restates the same requirement wholesale and is sequenced
  first — so it carries B1's composition record, its "no explanatory prose at rest" paragraph and
  its scenario through verbatim. Design D14 states the merge-order constraint that keeps the two
  from reverting each other.

## Impact

Product code, none of which this proposal writes:

- `apps/web/src/frame/deck.tsx`: Triage's `<Link>` (`:123-130`) leaves the bar; its menu item moves
  out of the responsive `Team` group (`:169-179`, `className="lg:hidden"` on the group and
  `"sm:hidden"` on the item) into the permanent group (`:202-241`), gaining the explicit
  `aria-current` its siblings at `:209`, `:222` and `:234` already carry and the item at `:171-179`
  does not. The header comment at `:18-24` and the fold-order comment at `:153-154` both state the
  old membership and must move with it. `DeckStop` (`:26-34`) is unchanged — it already has eight
  members.
- `apps/web/src/frame/go-to.ts`: **no case changes.** The comment block at `:5-11` names the deck's
  advertised grammar and needs one clause; the switch at `:35-71` is untouched, which is the whole
  point of the binding rule.
- `apps/web/src/frame/app-frame.tsx:120-183`: the palette's `Go to` group is unchanged in content
  and order — eight commands, eight shortcut strings, all still matching `go-to.ts`.
- `apps/web/src/home/team-home.tsx:976-1032`: `OnwardFooter` keeps its Board link (`:992`) and the
  `⌘K` hint and drops Issues (`:985`), Delivery (`:1000`), Retro (`:1011`) and Roadmap (`:1018`).
  Its call site at `:128` is unchanged; no band folds.
- `apps/web/src/frame/app-frame.test.tsx:272-285` is the test this change is measured by: its name
  ("the deck offers the six destinations and nothing else"), its `toEqual([...])` at `:281` and its
  comment at `:282` all encode the old count and the old membership. It gains a case for the menu's
  permanent list and one for the current-page marking on a menu destination, which nothing asserts
  today.
- `apps/web/src/routes.test.tsx`'s `ROUTE_HOMES` (`:132-159`) records each route's home as
  `'stop' | 'more' | 'doorway'` but only its **keys** are compared against the router; the values are
  never checked against the deck, so Triage's row would go on reading `'stop'` and nothing would
  fail. Closing that is part of this change, not a follow-up.
- `apps/web/e2e/triage.spec.ts:23-29` (`enterApp`) and every spec that reaches Triage by clicking the
  bar; `apps/web/e2e/support.ts:81-91` already exports a `goToMore` helper for exactly this shape.

Documentation and drawings:

- `apps/docs/src/content/docs/features/app-frame.md`: the frontmatter description (`:3`), the band
  table's deck row (`:11`), §"The six destinations" (`:18-30`) including the bold stop list at `:22`
  and the fold paragraph at `:27-30`, the reach table (`:34-42`) and the keyboard table (`:91-101`,
  unchanged in content but now the place a bar destination's binding is advertised). §"Off a team"
  says it twice more — "the six stops stay, pointing at your **anchor team**" (`:76`) and "a
  workspace with no teams at all drops the six stops entirely" (`:81`) — which is the same
  requirement this change now modifies in the spec, said in the docs' own voice; and the ⌘K
  paragraph at `:108` lists "the six destinations, the inbox, search everything" as the frame
  palette's contents.
- `apps/docs/src/content/docs/index.md:39` — "Six destinations, one command palette" — and
  `apps/docs/src/content/docs/features/delivery.md:8` — "one of the six stops in [the deck]". Both
  are one clause each, and both are the count this change moves.
- `apps/docs/src/content/docs/features/triage.md:11` ("take the **Triage** stop in the deck") and
  `:14` ("the deck already carries it two stops to the left", which stops being true when Triage
  leaves the bar); `features/team-home.md`'s description of the footer.
- `DESIGN.md:23` — "The deck's six stops — Home · Issues · Triage · Cycles · Delivery · `more▾`" and
  the fold order in the same bullet.
- `README.md:63-65`, which names all six.
- `design-explorations/overhaul-2026-08/northstar/`: all eight files draw the same bar —
  `home.html:194-199`, `issues.html:195-200`, `issue.html:277-282`, `delivery.html:173-178`,
  `ia.html:255-260`, `home-digest.html:244-249`, `home-digest-2.html:352-357`,
  `home-digest-2-quiet.html:244-249`. `ia.html` draws it three more times: the frame miniature
  (`:283-284`), the headline "Six stops on the bar." (`:320`), and the destination tree
  (`:324-367`). The three digest mocks' onward footers (`home-digest.html:420-426`,
  `home-digest-2.html:633-639`, `home-digest-2-quiet.html:423-429`) draw exactly the four links this
  change rations — `Issues · Delivery in full · Retro · Roadmap` — **and no board link at all**, so
  matching D10 there is a rewrite rather than a deletion: the four go and a board doorway arrives
  beside the `⌘K` hint. `NORTHSTAR.md` needs its `<header class="gbar">` md5 claim (`:40-41`) re-stated, its "six
  stops with `more▾` as a transient" sentence (`:56-57`) corrected, and a fourth divergence recorded
  beside the three at `:61-83`.
- `openspec/SCOPE-planning-surfaces.md` and `openspec/SCOPE-legibility.md` are **not** edited by this
  change; the budget lives in the spec, which is where a later change will look for it.
- `ROADMAP.md` is **not** edited on this branch — siblings in this family are authored in parallel and
  that file is the guaranteed conflict, per `SCOPE-legibility.md:191-193`. The integrator takes the
  row.

No dependency, env var, container, table, migration, named query or mutator is added or changed.
`packages/schema` is not touched at all; `packages/ui` is not touched, so
`packages/ui/src/styles/contrast.test.ts` gains no pairs — every token in play is already asserted.
