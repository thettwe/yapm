# Design — destination-budget

The mission input is `openspec/SCOPE-legibility.md` §"Track D — the destination budget". This file
records the decisions that scope left to the build, argues every recorded position the change moves,
and names the two it examined and kept.

The governing sentence: **the deck is a list of things a member has to learn, so its length is a
product decision and not a leftover.** Every other question here — what earns a seat, whether a stop
folds at zero, where planning-surfaces goes, what `g d` means — falls out of taking that sentence
literally and then counting honestly.

## Context

What exists and must be used rather than rebuilt:

- **The sentence being reopened.** `openspec/specs/app-frame/spec.md:47`, and the transient clause
  three lines under it at `:50-52` that makes the number wrong.
- **The deck itself.** `apps/web/src/frame/deck.tsx` — five hand-written `<Link>` elements
  (`:105-147`), `MoreMenu` (`:155-245`) holding two groups: a responsive `Team` group
  (`:169-201`, `className="lg:hidden"`, items carrying `sm:hidden` at `:172` and `md:hidden` at
  `:181`) and a permanent `More` group (`:202-241`). There is no `STOPS` array and no config object;
  the deck's membership is JSX. `DeckStop` (`:26-34`) already carries eight members.
- **The grammar.** `apps/web/src/frame/go-to.ts:35-71` — eight cases, one switch, suppressed by four
  guards (`:22-24`, plus the whole listener not installing when `teamId === null` at `:19`) and a
  1200ms prefix expiry (`:12`).
- **The three advertisement sites.** The menu's six `Kbd` hints (`deck.tsx:176`, `:185`, `:197`,
  `:212`, `:225`, `:237`); the palette's eight `Go to` commands
  (`apps/web/src/frame/app-frame.tsx:126-179`, whose `shortcut:` strings all match `go-to.ts`); and
  `apps/docs/src/content/docs/features/app-frame.md:91-101`.
- **The reach guarantee.** `app-frame/spec.md:259-267` — every authenticated route reachable from
  the frame "as a deck stop, a `more` item, a lens, an entry in the workspace/team switcher, an entry
  in the user menu, an item in the deck's right-hand cluster, or a doorway from a page that is itself
  reachable", and losing reachability "SHALL be treated as a regression". This change does not touch
  that requirement, and it is why a doorway is a real answer rather than a euphemism for exile.

Constraints inherited and not negotiable here: the deck is identical on every page
(`app-frame/spec.md:20-21`); the band never wraps (`DESIGN.md:23`); keyboard-first; tokens only;
no read log (`VISION.md:49`).

## Goals / Non-Goals

**Goals**

- Count the thing the deck actually offers, and write the count where a future change will trip over
  it rather than read past it.
- State a rule two readers apply to the same surface and reach the same tier, without asking anyone.
- Answer the zero-count question with an argument, in either direction, rather than an inheritance.
- Publish a budget the other two families can design against **today**, including where each of
  their surfaces goes.
- Take a member nothing they already learned.

**Non-Goals**

- Building any planning surface, or the Decisions record, or a producer for triage.
- Retiring a destination from the product, or converting one into a lens (D5).
- Rebinding any `g` key (D9).
- Redesigning Home. The onward footer is rationed by the rule; the band order, the footline and every
  band-owned doorway are untouched (D10).
- A teaching surface for the move. E1 `notation-legend` and E2 `first-run` own teaching, and
  `SCOPE-legibility.md:172` already sequences E1 behind this change.

## The deck, before and after

At the comfortable width (≥1024px), today:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ Acme / Engineering ▾   Home  Issues  Triage  Cycles  Delivery  more▾   ⌕⌘K •4 ✉ ●│
│                          ────                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                                     more▾ ┌──────────────────┐
                                                           │ MORE             │
   5 bar destinations + the transient                      │ Retros      g r  │
   3 in the menu, hints visible                            │ Projects    g p  │
   ── 8 destinations ──                                    │ Roadmap     g m  │
                                                           └──────────────────┘
```

At the comfortable width, after:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│ ▣ Acme / Engineering ▾   Home  Issues  Cycles  Delivery  more▾          ⌕⌘K •4 ✉ ●│
│                          ────                                                      │
└────────────────────────────────────────────────────────────────────────────────────┘
                                              more▾ ┌──────────────────┐
                                                    │ MORE             │
   4 bar destinations + the transient               │ Triage      g t  │ ← moved, key unchanged
   4 in the menu, hints visible                     │ Retros      g r  │
   ── 8 destinations ──                             │ Projects    g p  │
   the band is one item shorter                     │ Roadmap     g m  │
                                                    └──────────────────┘
```

At the narrowest width (<640px), today and after — the case the budget is actually derived from:

```
 today                                       after
┌──────────────────────────────┐            ┌──────────────────────────────┐
│ ▣ Acme / Eng ▾  Home Issues  │            │ ▣ Acme / Eng ▾  Home Issues  │
│                     more▾    │            │                     more▾    │
└──────────────────────────────┘            └──────────────────────────────┘
   more▾ ┌──────────────────┐                  more▾ ┌──────────────────┐
         │ TEAM             │                        │ TEAM             │
         │ Triage      g t  │                        │ Cycles      g c  │
         │ Cycles      g c  │                        │ Delivery    g d  │
         │ Delivery    g d  │                        │ MORE             │
         │ MORE             │                        │ Triage      g t  │
         │ Retros      g r  │                        │ Retros      g r  │
         │ Projects    g p  │                        │ Projects    g p  │
         │ Roadmap     g m  │                        │ Roadmap     g m  │
         └──────────────────┘                        └──────────────────┘
            6 items                                     6 items
```

The two narrow menus are the same length. **The demotion costs nothing where room is scarcest and
gives a bar seat back where it is not** — which is also the finding that fixes the ceiling (D2).

## Decisions

### D1 — The count is over destinations, and the old sentence never was

`app-frame/spec.md:47` says "exactly six stops in order: Home, Issues, Triage, Cycles, Delivery, and
a `more` menu". `app-frame/spec.md:50` says the sixth "SHALL be a transient, never a destination".
Both are in the same requirement. So the sentence counts five destinations and one non-destination,
arrives at six, and the three real destinations inside the transient are outside the number entirely.

This is not a reading only a lawyer reaches. The product's own test is named *"the deck offers the
six destinations and nothing else"* (`apps/web/src/frame/app-frame.test.tsx:272`) and asserts
`toEqual(['Home', 'Issues', 'Triage', 'Cycles', 'Delivery'])` at `:281`, with the comment "The sixth
is `more▾`" at `:282`. A test that asserts five under a name that says six is the sentence's ambiguity
compiled.

And `openspec/changes/decision-record/specs/app-frame/spec.md:5-10` is the loophole exercised in
good faith: it adds a ninth destination and reproduces "exactly six stops" **verbatim**, changing only
"Retros, Projects and Roadmap" to "Retros, Projects, Roadmap and Decisions". Nothing in that delta is
careless. The sentence it copied genuinely does not cover what it changed.

**The decision: count destinations, at every width, and say that the transient is not one.** The
requirement's *name* moves with the number, which is why this delta uses `## REMOVED` plus `## ADDED`
rather than `## MODIFIED`: leaving a requirement titled "Six destinations" over a body that says
eight is exactly the stale-doc failure `CLAUDE.md` forbids, and the title is part of what misled.
Five of the six original scenarios are carried through the replacement **verbatim**. The sixth —
"The more menu is keyboard-operable and escapable" — is generalised in one clause: its THEN moves
from "the retro/projects/roadmap items were reachable" (`app-frame/spec.md:77`) to "every
destination in its permanent list was reachable", because Triage joins that list and a scenario
naming three of the four items would go stale on the change that wrote it.

**The count is written in a second requirement, and removing one without the other would leave the
capability contradicting itself.** `app-frame/spec.md:179-212` — "Honest degradation where no team is
in context" — names it three times: "its six stops SHALL point at an anchor team" (`:181`), "the six
stops SHALL be absent rather than disabled" (`:184`), and a scenario THEN reading "the deck's six
stops point at Engineering" (`:194`). Remove "Six destinations …" and leave that requirement standing
and the archived capability offers eight destinations across two tiers in one requirement while
saying "six stops" three times in the next — which is precisely the defect this family exists to
remove, and a peculiarly embarrassing one to ship *in this change*. It is
therefore carried as a `## MODIFIED`, restated in full with all four of its scenarios, and the only
edit is the count word: the stops become **the deck's destinations, however many the budget allows**,
plus one sentence saying the count is the deck's own so a later tier move never has to amend this
requirement again. Nothing else about the degradation — the anchor rule, the statusline's silence
off-team, the stale-anchor discard — is touched.

**The capability's Purpose line is the one place a delta cannot reach.** `openspec/specs/app-frame/spec.md:6`
reads "It carries the six destinations, the one attention number, and the single owner of the
command-palette shortcut", and OpenSpec's archive step rewrites only the target spec's
`## Requirements` section — everything above it, `## Purpose` included, is copied through untouched
(`specs-apply.js`'s `extractRequirementsSection`, whose `parts.before` comes from the target file, not
from the delta). A `## Purpose` block in a delta is honoured only when the capability is being
created. Confirmed rather than assumed: archiving this change against a scratch copy of `openspec/`
applies `+ 4 added, ~ 1 modified, - 1 removed` to `app-frame` and leaves `:6` reading "six
destinations" untouched. So that line is corrected **by hand at archive time**, and `tasks.md` §8
carries it beside the other prose this change makes stale rather than leaving it for a reviewer to
catch.

### D2 — The ceiling is eight, and it is derived from the fold rather than chosen

A number pulled from taste is a number the next family argues with. This one comes from the
narrowest supported width, where the bar keeps only Home, Issues and the trigger
(`deck.tsx:105-122` carry no responsive class; `:127`, `:135` and `:144` do), and everything else is
in the menu.

| width | bar destinations | menu items | destinations offered |
|---|---|---|---|
| ≥1024px, today | 5 | 3 | 8 |
| <640px, today | 2 | 6 | 8 |
| ≥1024px, after | 4 | 4 | 8 |
| <640px, after | 2 | 6 | 8 |

Six menu items at the narrow width is not a target this change invents — it is what ships, and what
`apps/docs/src/content/docs/features/app-frame.md:30` already publishes: "at a narrow measure the bar
carries fewer than six stops and the menu carries up to six items." A ninth destination puts seven
items in a menu, on the viewport with the least room for one, on a band that may not wrap.

So: **at most eight destinations, at most four on the bar, at most six menu items at any width.** The
three bounds agree, which is how you can tell the number was derived. Eight is also, and not by
coincidence, exactly what ships — and the maintainer's complaint is that what ships is already "too
complicated … so many things to learn". A ceiling above the current count would be a licence. A
ceiling below it would force a retirement nobody has argued for. Eight forbids growth without
demanding a casualty, and the displacement rule is what lets a genuinely better destination in
anyway, at the price of naming what it beats.

**The consequence, stated rather than buried: the budget published to the other two families is
zero.** That is a real answer to "what may they add", not a refusal to answer — the second half of it
is the table in the proposal, which says where each of the nine queued surfaces goes instead. A
family told "no destinations, and here is the seat each of your surfaces already has" can start on
Monday. A family told "we'll see" cannot.

### D3 — The rule: three tests, and the tier is the answer

Stated so a future change applies it without asking:

1. **An entity of its own.** Already written at `app-frame/spec.md:56` — "A destination for which no
   entity exists SHALL NOT be rendered at all — never as a disabled or dead link" — and argued in
   the deck's own comment (`deck.tsx:22-24`): "a disabled row is chrome promising what the product
   cannot keep." Carried through unchanged.
2. **Not a re-cut, and not an interior.** The Board precedent (`app-frame/spec.md:54`) generalised.
   A surface presenting the rows of **one** collection another destination owns, re-ordered or
   re-drawn, is a lens. A surface answering, at higher resolution, a question a destination already
   answers is that destination's interior.
3. **A producer that fills it in the ordinary course of work.** The new one, and the one that decides
   a tier rather than existence. It is `VISION.md:45` applied to navigation — "wherever a fact can
   come from git, CI, or deploys, it is never asked of a human" — read as: a destination on the bar
   is a place work *arrives*, and a place nothing arrives at is a place you visit, not a place you
   are shown.

**Why "how often is it used" is not on the list, and never can be.** It is the first test anybody
reaches for and it is unavailable on principle: `VISION.md:49` — "yapm has no read log, and adding
one would be the wrong side of this line." A usage test would either be unmeasurable or a
surveillance feature. Writing that refusal into the requirement is not decoration; it is the reason
the three tests are structural, and it stops a future change from arguing a promotion on invented
telemetry.

**The displacement obligation** is what makes a ceiling a ceiling. At eight, adding requires naming
what leaves and showing it failing a test. And **growth by menu is growth** — stated explicitly,
because the menu is exactly where the old sentence's blind spot was and a rule that does not say so
rebuilds the loophole one level down.

### D4 — A zero count does not fold a destination, and the badge rule stops at the badge

The maintainer's question was whether the product's own principle transfers:
`app-frame/spec.md:169` — *"Zero is absence, not a zero … the deck shows no attention badge and the
statusline shows no attention segment"* — against a Triage stop that renders permanently while empty.

**It does not transfer, and here is the argument rather than the assertion.**

The badge rule's own reasoning is about a number, and the code says so:
`apps/web/src/frame/deck.tsx:279-280` — "ABSENT at zero, never a zeroed badge: `0` would be a claim
that four exception classes were evaluated and all came back empty, which off-team and pre-sync is
exactly what is not known." A rendered `0` **asserts something** — that a derivation ran and returned
nothing. That is why absence is more honest than a zero there. A destination asserts nothing of the
kind. It offers a place. The place exists whether or not it holds anything this morning, and a member
opening an empty Triage and seeing `Nothing waiting.` has learned something true.

Second, and decisively: a data-conditional stop breaks a requirement that is already written.
`app-frame/spec.md:20-21` — *"The deck SHALL be identical on every page — nothing in it adapts to the
page except which destination is marked current."* A deck that folds on a count does not vary across
pages; it varies across **mornings**, which is worse, because the reader can compare two pages side
by side and cannot compare two Tuesdays. The keyboard grammar degrades the same way: `g t` that
navigates on Tuesday and does nothing on Wednesday is not a shortcut, it is a coin toss, and
`go-to.ts`'s switch would need a data dependency it has never had.

Third — and this is the part that makes the answer useful rather than merely correct — **the case
that raised the question is not a zero-count case at all.** Triage is not empty *today*; it is empty
for essentially every self-hosted team, forever, because nothing fills it (D5). That is a tier
problem, resolved once by the rule, not a folding problem resolved per team by the deck. Answering it
with a fold would have made the deck flicker for a hundred teams to paper over one missing producer.

**Where the boundary is drawn, and what this change deliberately does not touch.** The masthead count
stays. `openspec/specs/triage/spec.md:115` requires "a mono count of the waiting issues" and carves
out exactly one thing on an empty queue — "The ordering label SHALL NOT be drawn over an empty queue"
— so the count was deliberately kept, and `openspec/specs/retrospective/spec.md:397` mandates the same
shape. `apps/web/src/triage/triage-view.tsx:395` already gates it on sync completeness rather than on
the value, with a comment saying why. A page stating what it holds, on a page the member deliberately
opened, is a different act from chrome making a claim on every page; the requirement says so and
leaves the count to the capability that owns it. Amending `triage:115` and `retrospective:397` would
be a second change with a second argument, and this one does not need it.

### D5 — Triage is demoted, not retired, and not turned into a lens

**The case for moving it.** `openspec/specs/triage/spec.md:30` already concedes the producer gap in
the capability's own words: an issue enters triage "created with `needsTriage` set through
`issue.create` — the argument a programmatic ingest of externally-created issues would set; **no
shipped UI surface or connector sets it today** — or flagged from an existing issue through
`issue.flagTriage`." Verified against the running code rather than trusted:

- `apps/web/src/issues/command.tsx:293` is the single runtime call to `flagTriage`, surfaced as the
  palette row `Send to triage` (`:791-801`). It acts on an issue the member is already reading.
- `packages/schema/src/zero/mutators.ts:766` declares `needsTriage` optional and `:804` writes
  `args.needsTriage ?? false`. No shipped caller passes `true`.
- The only `true` rows in the repository are two seed fixtures — `packages/schema/src/db/seed.ts:216`
  and `:224`, both titled `Incoming: …` — written only under `SEED_DEMO_CONTENT`
  (`apps/server/src/auth-routes.ts:106`), which defaults to false.

So a fresh self-hosted workspace has an empty inbox and keeps one until somebody presses a palette
row. `Send to triage` **forwards** work; it does not receive it. Test 3 fails, and the tier is the
menu.

**Why not retire it, or make it a lens on Issues?** The lens reading is genuinely tempting:
`triage/spec.md:53` describes the inbox as "a filtered view of `issue` by the orthogonal flag", which
is test 2's definition of a lens almost word for word. It is declined for two reasons. First, it
reverses a recorded position head-on: `triage/spec.md:109` requires the view be "reached from the
application frame's Triage destination (and its `g t` shortcut) **rather than from a per-page view
switcher**" — an explicit refusal, which a lens would contradict rather than amend. Second, a
demotion is a one-line reversal when a producer ships; lens-ification dismantles a masthead, an empty
state, a decision panel and four verdict keys, and there is no cheap way back. **A budget change
should take the reversible version of a decision it is the first to make.**

**What the return condition is, in writing.** The requirement names it: an ingest of externally
created issues, an inbound path, or a connector that creates them. When one ships, Triage is eligible
for the bar again "by a change that names what it displaces, and no re-argument of what triage *is*
SHALL be required to move it back." That sentence exists so the demotion cannot harden into a verdict
on the feature.

### D6 — Roadmap keeps its seat, and this is the rule's hardest live case

Test 2 nearly catches Roadmap: it renders from the same project rows the Projects destination lists,
so on a fast reading it is Projects re-cut onto a time axis — a lens, and a free seat for whoever
wants one.

It survives, and the distinction is the one that also saves Home. **A lens presents the rows of one
collection; Roadmap composes across two.** It draws projects *against cycles* — cycle boundaries and
a today caret are facts Projects does not carry and cannot show — so it answers a question no single
collection owns. Home is the same shape at a larger scale: it has no entity of its own and composes
seven queries, which under a naive test 2 would demote the front door.

Recording the near-miss matters more than the verdict. A rule whose first application would have
demoted Home is a rule that was written carelessly, and the fix — "one collection re-cut is a lens;
a composition across collections may be a destination" — is what makes test 2 usable by somebody who
did not write it. It is also what routes B1: an A1-upgraded Roadmap already draws bars, milestones
and a time axis, so B1's remaining increment (dependency arrows, issue-level bars, swimlanes) is that
destination's **interior**, at higher resolution, not a peer of it.

### D7 — What the two queued families may add, and where

The proposal carries the table; the reasoning is here.

- **B1 `timeline-lanes` → the Roadmap's interior.** `SCOPE-planning-surfaces.md:84` describes it as
  "bars, milestones, dependency arrows, swimlanes by team/project" and names no home at all — the
  document contains no occurrence of "deck", "destination" or "navigation" in 124 lines, which is not
  an oversight to hold against it but the exact gap this change closes. The only place it is priced
  as a destination is `SCOPE-legibility.md:79`, in a summary line written before anyone costed it.
  A1 `project-schedule` (`SCOPE-planning-surfaces.md:76`) already puts bars and milestones on the
  shipped Roadmap and says it "extends `projects/spec.md:133` … rather than replacing it". Two
  changes building two timelines is the double-encoding this whole family exists to remove.
- **C1 `board-swimlanes` → the Board lens's interior.** Costs nothing; `app-frame/spec.md:54` already
  fixes Board as a lens. Worth noting for C1's author that its real reversal is elsewhere and unnamed
  in its scope row: `openspec/specs/board/spec.md:147` — "The board SHALL NOT offer a grouping or a
  sort control."
- **D2 `flow-analytics`, D3 `team-capacity` → Delivery.** `app-frame/spec.md:229-230` requires the
  metrics promise appear "once in the application, on the delivery surface", which makes Delivery the
  page the product has already designated for team-level measurement. A second metrics destination
  would put that promise in the wrong place or in two places.
- **D4 `workload-view` → a lens in the Issues masthead.** Open work re-cut by assignee is one
  collection re-cut by one axis: test 2, exactly. `SCOPE-planning-surfaces.md:50` notes the assignee
  filter already exists on the list and the board, which is the same observation arriving from the
  other direction.
- **D1 `status-history` → no surface.** A table.

Note on names, because both scope documents use the same label: `D1` here is
`destination-budget` (`SCOPE-legibility.md:166`). `D1` in `SCOPE-planning-surfaces.md:96` is
`status-history`. Anything citing "D1" across the two families should say which.

### D8 — `decision-record` is over budget, and the Record is a doorway

`decision-record` is proposed, 0/64 tasks, parked for the maintainer's go
(`SCOPE-planning-surfaces.md:118`). `SCOPE-legibility.md:196-197` flags "whether `decision-record`
stays parked until D1 publishes the budget" as **still unanswered**. So this is exactly the collision
D1 was sequenced to resolve, and ducking it would leave the parked change to discover the budget by
failing review.

As authored it takes the deck to nine (`decision-record/specs/app-frame/spec.md:5-10`). Under the
ceiling it must either name a displacement or land differently. **The rule points at a doorway**, and
so does everything else already written:

- `app-frame/spec.md:262-265` lists "a doorway from a page that is itself reachable" as a first-class
  home and names six routes that live that way — search, the notification inbox, product digests, the
  settings surfaces, team members and theme selection. The Record would be the seventh, not an
  exception.
- `northstar/ia.html:368`, in the note under the destination tree (`:367-368`), already says it: "the
  Record and Runway are pages without bar seats — doorways reach them."
- `decision-record` builds its own doorways anyway. Its proposal pins a decision chip above the
  thread it distilled (`:46-49`) and renders a DECIDED THIS CYCLE band on Home (`:58`). A record page
  reached from the chip, the band, search and the palette is reached from where the reader is already
  thinking about the decision.

This change does **not** edit `decision-record`'s files. It states the consequence: **two of its
deltas must be re-authored before it builds.**

- Its `app-frame` delta, in two places — the `more` item and the `g d`/`g s` swap. It is a
  `## MODIFIED` of the very requirement this change removes, so after this change archives the
  requirement it targets does not exist at all.
- Its `team-home` delta, which is **not** `## ADDED` only. It carries `## ADDED Requirements` at
  `:1` (the DECIDED THIS CYCLE band, which the budget does not touch) **and**
  `## MODIFIED Requirements` at `:33`, restating "The team page is an adaptive digest composed from
  synced work-graph facts" (`:35`) wholesale. Its body at `:39-40` is the pre-B1, pre-D1 text — "then
  a composed mono footline and an onward footer (Issues · Delivery · Retro · Roadmap, with a ⌘K
  hint)" — so archiving it after B1 and this change reverts **both**: B1's `how ·` composition record
  and this change's footer rationing, in one silent overwrite. D14 states the mechanism.

Everything else in that change (the entity, the ownerless guarantee, the Decide affordance, the
DECIDED THIS CYCLE band itself) is untouched by the budget and stands.

### D9 — `g d` stays Delivery's, and a binding belongs to its destination

`decision-record` proposes rebinding `g d` to Decisions and moving Delivery to `g s`
(`decision-record/specs/app-frame/spec.md:17-19`, with a scenario at `:51-55`). Under D8 there is no
Decisions destination, so there is no key to reclaim and the swap does not happen. `go-to.ts:35-71`
is unchanged by this whole change — which is the point, not a coincidence.

The general rule this change writes is worth more than the specific ruling: **a `g` binding belongs
to its destination, not to its seat.** Two consequences.

*It answers "what happens to someone who learned the old deck."* Triage moves and `g t` does not.
The route does not move, the palette entry does not move, the verdict keys do not move. And a fact
worth stating because it is the opposite of what a demotion sounds like: **Triage's shortcut becomes
more visible, not less.** Today the menu's `Team` group is `lg:hidden` (`deck.tsx:169`), so at a
comfortable desktop width the `g t`, `g c` and `g d` hints are drawn nowhere in the deck and the ⌘K
palette is their only in-product home. After the move, Triage sits in the permanent `More` group
(`:202`), whose items are drawn at every width — so `g t` gains an advertisement it did not have. The
requirement makes that general: a menu destination carries its hint at every width, not only where
something has folded.

*It catches a live defect class.* `openspec/specs/delivery-metrics/spec.md:226` says the Delivery view
is reachable "by its `g d` shortcut". `decision-record/proposal.md:94-105` lists four modified
capabilities — `issue-detail`, `app-frame`, `team-home`, `local-first-sync` — and `delivery-metrics`
is not among them. The swap would have left a shipped requirement naming a key it no longer owned.
That is not a criticism of a careful proposal; it is evidence that the obligation needs to be written
down, which is why the new requirement says a rebinding change SHALL amend "every requirement in any
capability that names the key" and SHALL list that capability among its modified capabilities.

Also settled by the same rule: **only destinations hold `g` bindings.** Lenses, doorways, artifacts
and transients do not. That is already how the product behaves — `apps/web/src/frame/app-frame.tsx:95`
and `:100` register the inbox and search with no `shortcut:` field at all — so the rule describes the
shipped grammar rather than inventing one, and it is what keeps a doorway-shaped Record from quietly
acquiring a key later.

### D10 — Home's onward footer is rationed by the rule, not redesigned

It arrived here twice. `SCOPE-legibility.md:208-210` calls it "a second navigation system on the one
page that least needs one" and suggests folding it into C1; `openspec/changes/front-door/proposal.md:101-107`
declined, counted it honestly — "four of its five items are already deck-reachable and one is not" —
and said "deciding how much of it to ration is D1 `destination-budget`'s work". A third deferral
would be the family failing its own discipline.

The rule applied: **a page that has shown its own work may not re-offer the deck's destinations
beneath it as a second navigation** — narrowed to that shape in D13, which audits the two shipped
surfaces an unqualified version would have caught. Issues (`team-home.tsx:985`), Delivery (`:1000`),
Retro (`:1011`) and Roadmap (`:1018`) are all deck destinations. Board (`:992`) is a lens and has no
seat of its own, so it stays, along with the `⌘K` hint. The footer goes from five links to one.

Two boundaries, drawn explicitly so this stays a rationing and not a redesign. **A band's own doorway
is not navigation** — the cadence band links onward to Delivery as part of the fact it is stating
(`openspec/specs/team-home/spec.md:257`), and the hero's artifact chip opens the retro it names; both
survive, and the delta says so in a scenario. And **nothing else about the digest moves**: band order,
folding, the footline (`team-home/spec.md:285-296`) and the keyboard-traversal requirement
(`:298-305`, which still reaches "onward links", of which there is now one) are untouched.

Considered and rejected: keeping the footer whole on the grounds that Home is the product's one
editorial surface and an article may end with "read next". It is a real argument — but four of the
five "read next" links are one keystroke away on every page in the product, and the fifth is not.
Keeping four to preserve the shape of a footer is ink with no fact behind it, which is `DESIGN.md:34`.

### D11 — The northstar redraw, and how small it actually is

`CLAUDE.md` makes `design-explorations/overhaul-2026-08/northstar/` canonical — "judge shipped
screens against" it — and this change moves the frame those files draw.
`SCOPE-legibility.md:107-111` already settled the direction: "the specs win and the northstar is
redrawn or annotated afterwards … whichever change moves the frame owns that redraw; leaving the
mocks contradicting the product is the one outcome ruled out." This change owns it.

What that costs, counted rather than estimated:

- The eight `gb-tab` runs: `home.html:194-199`, `issues.html:195-200`, `issue.html:277-282`,
  `delivery.html:173-178`, `ia.html:255-260`, `home-digest.html:244-249`,
  `home-digest-2.html:352-357`, `home-digest-2-quiet.html:244-249`. One span removed from each.
- `ia.html` three more times: the frame miniature (`:283-284`), the headline "Six stops on the bar."
  (`:320`), and the destination tree (`:324-367`), whose Triage root at `:343` moves under the
  `more ▾` node at `:359`.
- The three digest onward footers (`home-digest.html:420-426`, `home-digest-2.html:633-639`,
  `home-digest-2-quiet.html:423-429`), which draw the four links D10 rations —
  `Issues · Delivery in full · Retro · Roadmap` — and, unlike the shipped footer, **no board link**.
  So the redraw there is not "delete four": it is delete four and draw the one doorway the rationed
  footer keeps, beside the `⌘K` hint. A removal-only edit would leave a foot holding a hint and
  nothing else, which is the opposite of what the delta requires.
- `NORTHSTAR.md`: the "six stops with `more▾` as a transient" sentence (`:56-57`), the `gbar` md5
  claim (`:40-41` — `571eee83506c`, an all-or-nothing invariant that a single-file edit falsifies),
  and a **fourth divergence entry** beside the three at `:61-83`, in the same voice the existing
  three use.
- `ia.html:375` draws a Decisions item in the open menu with a `g d` hint, and `:364` lists the same
  destination as a child of the `more ▾` node in the destination tree. Under D8 neither ships. The
  annotation records both as a divergence rather than deleting the drawings, which is exactly how
  `NORTHSTAR.md:65-67` already handles the same item's first fold.

**And what it does not cost.** The 16 PNGs are not in the repository: `.gitignore:55` is
`design-explorations/**/*.png` and `git ls-files design-explorations/overhaul-2026-08/northstar/`
returns nine files — `NORTHSTAR.md` and the eight HTML. No reviewer, no CI gate and no fresh clone
ever sees a northstar screenshot, so "re-render every PNG" is not an obligation this change can be
held to and is not in `tasks.md`. Anyone re-rendering locally should also adopt the retuned amber, per
`NORTHSTAR.md:79-80`.

### D12 — Two positions examined and deliberately kept

Recorded here because a family whose discipline is *"a recorded position may be changed, never quietly
contradicted"* should be equally explicit when it declines to change one.

- **`app-frame/spec.md:229` — the metrics promise.** "The one binding rule about metrics
  ('team-level only — never a per-person number') SHALL appear once in the application, on the
  delivery surface." D7 routes D2 `flow-analytics` and D3 `team-capacity` onto Delivery **because** of
  this line, not despite it. `SCOPE-legibility.md:98` records the same resolution for B1. The line
  stays and this change strengthens its reach.
- **`app-frame/spec.md:56` — no destination without an entity.** Carried through the replacement
  requirement verbatim, and promoted from an isolated sentence into test 1 of the rule. It is the one
  test the deck already applied, once, to Decisions (`deck.tsx:22-24`); the change generalises it
  rather than reopening it.

### D13 — The second-navigation rule reaches a page with content, and stops at an empty state

The rule D10 applies was first written unqualified: *"No surface SHALL re-offer the deck's own
destinations as a second navigation … it SHALL NOT reproduce the bar's or the menu's list at its own
foot."* A prohibition whose first application breaks shipped code is a prohibition nobody audited, so
here is the audit. A grep for `Doorway` across `apps/web/src` returns exactly three files, and
reading each for a doorway **foot** — a row of onward links at the bottom of a surface — finds
three:

- `apps/web/src/home/team-home.tsx:976-1032` — `OnwardFooter`, standing under a full page of the
  team's morning. This is the one D10 rations.
- `apps/web/src/triage/triage-view.tsx:1004-1031` — `EmptyQueue`: the done disc, `Nothing waiting.`,
  and then `Issues` (`:1019`) · `Cycles` (`:1021`) · `Projects` (`:1023`), with the same `·` dividers
  (`:1005-1009`) and the same `⌘K goes anywhere` hint (`:1024-1027`) Home's footer carries. All three
  are deck destinations under this change's own budget.
- `apps/web/src/notifications/inbox-view.tsx:498-519` — `EmptyInbox`: an `Issues` doorway (`:513`)
  and a `Home` doorway (`:515`).

So two shipped surfaces violated the unqualified rule on the day it was drafted. **The rule
over-reached, and it is narrowed rather than enforced.**

The deciding evidence is that both feet are required *in writing* by capabilities this change does
not own. `openspec/specs/triage/spec.md:241`: the empty queue "SHALL offer an onward foot to the
surfaces a member goes to next", asserted by its scenario at `:252`.
`openspec/specs/notifications/spec.md:668`: the empty inbox draws "a settled mark, a short statement,
the kinds of thing that arrive here, and at least one onward doorway", asserted at `:688`. Enforcing
the unqualified rule would **empty** Triage's foot outright — all three of its doorways are deck
destinations — in flat contradiction of a recorded position, without amending it. And it would leave
the inbox holding exactly one doorway, the `Home` one, which points at `/`: the workspace
administration surface, homed in the switcher rather than the deck (`routes.test.tsx:133`). A rule
that satisfies "at least one onward doorway" by deleting the doorway a reader of an empty inbox
actually wants has not been applied, it has been gamed.

The line that survives is the one D10's own argument draws. Home's footer stands under a page that
has just shown the team's morning: it is a second navigation, standing beside a first. An empty state
has no first — nothing of its own is on the page — and its doorways are what the surface says instead
of nothing. The test a later change applies: **did this surface render its own content above the
doorways?** If yes, the deck's destinations do not belong beneath them. If no, the doorways are the
content. That is settled by looking at the surface, which is the property D3's test 2 also has to
have.

What the narrowing leaves untouched, said plainly rather than left to be discovered: the cleared
triage queue and the empty inbox keep every doorway they draw today. `triage-view.tsx` and
`inbox-view.tsx` are not edited by this change, `openspec/specs/triage/spec.md:239-262` is not among
the requirements it modifies, and the `notifications` capability is not in its delta at all. One
observation recorded rather than acted on: the inbox's `Home` doorway is labelled for the digest and
points at workspace administration. C1 `front-door` examined `/`, costed moving it, and deliberately
left the route where it is (`front-door/proposal.md:95-100`); whether a doorway labelled `Home`
should lead there is that change's ground or a later Settings change's, and it is not a question the
deck's budget can answer.

Considered and rejected: keeping the rule unqualified and rationing both empty states by it. That
buys one shorter sentence with two dead ends, on the two surfaces in the product whose entire job in
that state is to say where to go next.

### D14 — This change's `team-home` delta is written against B1's text, and three changes now queue on one requirement

B1 `explanation-at-rest` modifies the same requirement this change modifies.
`openspec/changes/explanation-at-rest/specs/team-home/spec.md:3` and this change's delta both restate
"The team page is an adaptive digest composed from synced work-graph facts" **wholesale** — which is
what an OpenSpec `## MODIFIED` block does, so the requirement's live text is whichever of the two
archived last, not a merge of them.

`SCOPE-legibility.md:175-176` sequences them: "**C1 and B1 first** … **D1 next**." By the time this
change syncs, the live text of that requirement is B1's, not
`openspec/specs/team-home/spec.md:8-20`'s. So this delta is authored as the **union** of the two:
B1's composition-record clause inside the band-order sentence, B1's "The digest SHALL carry no
explanatory prose at rest" paragraph and B1's "The page states no derivation at rest" scenario are
all carried through verbatim, and this change adds only its footer rationing and its two scenarios.
Where the two texts touch they are reconciled in one clause rather than left to contradict: B1's
"the onward footer's doorways are labels and SHALL remain visible" becomes "labels rather than
derivations, and SHALL remain visible at rest — however few of them the deck leaves the footer to
carry", and the paragraph that follows says which ones those are. Nothing in B1's files is edited
here; in code the two do not touch at all, because B1 rewrites `Footline` and says in both its
proposal (`explanation-at-rest/proposal.md:167`) and its tasks (`tasks.md:30`) that `OnwardFooter`
and its call site are untouched.

**The merge-order constraint a reviewer must honour: B1 archives before this change.** If this one
archives first, B1's delta — authored against the pre-B1 text, and correctly so — will restore
`(Issues · Delivery · Retro · Roadmap, with a ⌘K hint)` and drop this change's footer paragraph and
both of its scenarios, silently reverting D10. In that order the repair is to re-author *B1's* delta
as the union; it is not to land both and hope one notices.

The rest of the family was checked the same way. Two of the three neighbours do not collide; the
third collides twice, on both of the requirements this change touches:

- B1's other three deltas — `projects`, `retrospective`, `reality-vocabulary` — touch no capability
  this change modifies.
- C1 `front-door`'s `app-frame` delta is `## ADDED Requirements` carrying exactly one requirement,
  "Signing in lands on work, not on administration" (`front-door/specs/app-frame/spec.md:3`). This
  change removes "Six destinations …" and adds four requirements under names C1 does not use, so the
  two sets are disjoint and either order applies cleanly. C1's other delta is `issue-list`, which
  this change does not touch. The one place they read the same surface — C1's "The deck MAY offer a
  stop pointing at such a team" (`:10-12`) — is about which team a redirect resolves to, and survives
  the rename of the count word intact.
- **`decision-record` collides on both of the same requirements, and its `team-home` delta is the
  one that is easy to miss.** That delta is `## ADDED` at `:1` — the DECIDED THIS CYCLE band, which
  costs the budget nothing — **and `## MODIFIED` at `:33`**, restating "The team page is an adaptive
  digest composed from synced work-graph facts" (`:35`) wholesale, exactly as B1 and this change both
  do. So **three** in-flight changes restate that one requirement: B1 `explanation-at-rest`, this
  change, and `decision-record`. Its body at `:39-40` is the pre-B1, pre-D1 text — "then a composed
  mono footline and an onward footer (Issues · Delivery · Retro · Roadmap, with a ⌘K hint)" — so
  archiving it after the other two would revert **both** of them at once: B1's `how ·` composition
  record and this change's footer rationing. The repair is the same as B1's and for the same reason:
  `decision-record`'s `team-home` delta must be re-authored as the union before it builds, which is
  the second half of D8's consequence. Its `app-frame` delta is a `## MODIFIED` of the very
  requirement this change removes (`decision-record/specs/app-frame/spec.md:1-3`) — D8's collision
  seen from the delta's side, and the reason that one must be re-authored rather than merged: after
  this change archives, the requirement it targets does not exist.

## Risks

- **The budget reads as a "no" to planning-surfaces.** Mitigated by refusing to publish the ceiling
  without the placement table: every one of the nine queued surfaces has a named home before this
  change merges, so the family's first proposal can be written the day it lands. If a placement turns
  out to be wrong, the displacement rule is the documented way to argue it — with a named casualty.
- **`decision-record` was proposed in good faith and this change moves its ground.** Mitigated by
  scope: two clauses of one delta, named precisely, with the alternative shape named too, and no file
  of that change edited here. The maintainer's go was already withheld pending this budget.
- **The rule could be applied mechanically to demote something it should not.** This is the Home and
  Roadmap near-miss (D6). Mitigated by writing the collection-versus-composition distinction into the
  test rather than into this file, and by requiring a displacement to *show* the failure rather than
  assert it.
- **A member with Triage in muscle memory clicks the bar and finds nothing.** Mitigated by the
  binding rule — `g t` is unchanged, and the destination that moved is the only one whose keyboard
  hint is now drawn at every width. Not mitigated by any in-product announcement, deliberately: a
  dismissible "we moved this" banner is chrome with an expiry date, on a change whose entire purpose
  is less chrome. The honest homes for teaching are E1 and E2.
- **Three `team-home` deltas target one requirement, and any two of them revert each other if they
  archive out of order.** B1 `explanation-at-rest`, this change, and `decision-record`
  (`specs/team-home/spec.md:33-40`, still holding the pre-B1, pre-D1 text) all restate "The team page
  is an adaptive digest composed from synced work-graph facts" wholesale. Mitigated between the first
  two by authoring this one as the union of B1's text and this change's own (D14), and by making the
  order a gate in `tasks.md` §11 rather than a hope; mitigated for the third only by saying so, here,
  in D8 and in that gate — `decision-record` is parked at 0/64 and must be re-authored before it
  builds, so there is no delta of its to fix on this branch and no file of its this change may edit.
  Not mitigated by tooling in any of the three directions: `npx openspec validate --all` passes with
  all of them on disk, so a flipped order fails nothing — it just quietly deletes B1's `how ·`
  clauses, or this change's footer rationing, or both at once, depending on which went last.
- **The second-navigation rule is applied to an empty state by a reader who skipped D13.** Mitigated
  by putting the exception in the requirement rather than only in this file, and by giving it its own
  scenario, so "an empty state may point at a destination" is an acceptance criterion and not a
  footnote. The two shipped feet it protects are named in `tasks.md` §4 as files this change must not
  touch.
- **A future change edits `deck.tsx` and quietly re-adds a stop.** The deck's membership is JSX, not
  a list (`deck.tsx:98-151`), and `routes.test.tsx`'s `ROUTE_HOMES` only compares its **keys** against
  the router — the `'stop' | 'more' | 'doorway'` values are never checked against the deck, so a
  demoted destination could keep a stale `'stop'` label and nothing would fail. `tasks.md` §5 closes
  that specific hole, because a budget nothing enforces is a comment.

## Decisions made during implementation

### The deck enforcement test renders the deck directly, with three neighbours stubbed

`tasks.md` §5.1 asks that every `'stop'` in `ROUTE_HOMES` be checked against a *rendered* bar link
and every `'more'` against a *rendered* menu item. `routes.test.tsx` renders the real router with no
session, so no deck is drawn on any route it visits, and building one there would have meant mocking
Zero for the whole file. Chosen instead: mount `<Deck>` as the component of a scratch route tree —
the house pattern `header-menus.test.tsx`, `team-home.test.tsx` and `delivery-view.test.tsx` all
use — with `Switcher`, `UserMenu` and `InboxBadge` stubbed to `null`. Each of those three reads Zero
and none is what the assertion is about. The comparison is by `href` with the query string stripped,
because `Delivery`'s link carries `?window=6` and the route id does not.

The `'more'` assertion is scoped to the permanent group (`getByRole('group', { name: 'More' })`)
rather than to the popup. jsdom applies no stylesheet, so the folding `Team` group is visible to a
test at every width; an unscoped assertion would pass with Triage back in the `lg:hidden` group,
which is the exact regression §5 exists to catch.

### The §5 guard was falsified rather than assumed green

A test that has never been seen to fail is a test nobody has checked the direction of, and §5's whole
claim is that a ninth destination trips over it. So both halves were made to go red on purpose and
then reverted, against the built branch:

- **A scratch ninth row** (`'/teams/$teamId/decisions': 'more'`) turns **four** tests red — the
  ceiling (`stop` + `more` ≤ 8), the deck cross-check, and the two pre-existing key tests that
  compare the table against the router. The ceiling fires on the count alone, which is the one that
  has to work when the ninth destination *is* registered and the other three would pass.
- **A stale tier** (`'/teams/$teamId/triage'` put back to `'stop'`) turns **two** red: the
  cross-check, because the table claims a bar link the deck no longer draws, and — unplanned but
  correct — the ceiling's second bound, because five bar destinations exceed four. The hole D14's
  last risk names ("a demoted destination could keep a stale `'stop'` label and nothing would
  fail") is closed in two independent places rather than one.

`apps/web/src/routes.test.tsx` is byte-identical to its committed form afterwards; the file was
restored from a copy, not re-edited, and `git diff` was confirmed empty before the suite was re-run.

### Comments naming the old count that `tasks.md` located in a different file

Two of the comments 6.6 names (`"would otherwise leave six stops pointing at"`, `"A workspace with
no teams drops the six stops"`) are in `apps/web/src/frame/app-frame.test.tsx:376` and `:500`, not in
`team-home.test.tsx` — the line numbers had moved under `explanation-at-rest`. They are reworded
where they actually live. One more the task list does not name,
`apps/web/src/pm-digest/digests-entry.tsx:26` ("not one of the six destinations"), is reworded for
the same reason: it is a sentence this change makes false.

### `ia.html` needed a Triage glyph that did not exist

9.3 asks for a `g t` row in the drawn-open `more▾` menu, and every row in that menu carries an inline
glyph. There was no `#g-triage` symbol in the file, so one was added in the same hand as its
neighbours (1.6 stroke, 20×20 box): a tray with an inbound path. Reusing `#g-decision` or
`#g-projects` would have drawn a lie in a file whose whole job is to be read literally.

### `home-digest-2-quiet.html`'s deck already diverged from the `gbar` md5 invariant

9.5 asks that the md5 at `NORTHSTAR.md:40-41` be re-verified and re-stated. Recomputing it the way
the recorded value was computed (normalized whitespace, `active` class stripped) reproduces
`571eee83506c` exactly on the pre-change files — for seven of the eight. `home-digest-2-quiet.html`
hashed to `afb1d4d23e93` **before this change touched anything**: a quiet morning draws no attention
badge and one unread rather than three, which is the file's whole point. The invariant's own sentence
scopes itself to "all five files", so nothing was wrong; the annotation now says which files hash
alike and why the eighth does not, so the next reader does not spend the same twenty minutes.
The new value across the seven is `5635e13a1609`.

### The e2e suite could not be run locally, and why — not a claim that it passes

`apps/web/playwright.config.ts` boots its own app server (`reuseExistingServer: false`, deliberately)
on `E2E_SERVER_PORT`. The dev stack running on this machine pins zero-cache's `ZERO_QUERY_URL` and
`ZERO_MUTATE_URL` to the **dev** server's host port, and `apps/server/src/auth.ts:172` verifies the
sync JWT with `issuer`/`audience` equal to that server's own `BETTER_AUTH_URL`. So a token minted by
a second app server on any other port is rejected by the server zero-cache calls back into, every
sync query fails, and the sign-in page holds its loading state — which is exactly the failure the
suite reported: seven of seven specs timing out in `openWorkspaceOverview`, before reaching a single
assertion of this change's. Sign-in itself was verified working against both servers by hand
(`POST /api/auth/sign-in/email` → 200, `GET /api/zero/token` → 200 on each), which is what isolates
the cause to the issuer binding rather than to anything on this branch.

Running it would have meant stopping a server this build did not start. The e2e tier is instead
covered by CI, where the full suite is **green (12m25s)** on this branch — including the two new
specs and the reach path `openTriage` now takes through `goToMore`. CI runs it once; the second run
`tasks.md` §11.2 asks for, against helper breakage being order-dependent, has not happened. Every
navigation claim that could be checked without the suite was checked by hand in a real browser
against the running dev app — see the §10 record below.

### §10, performed and recorded — including what was not performed

Done in a real browser (Chromium via Playwright, against the running dev app), at 1440 / 900 / 600:

| width | bar | menu | total | duplicates |
|---|---|---|---|---|
| 1440 | Home · Issues · Cycles · Delivery | Triage `g t` · Retros `g r` · Projects `g p` · Roadmap `g m` | 8 | none |
| 900 | Home · Issues · Cycles | Delivery `g d` \| Triage · Retros · Projects · Roadmap | 8 | none |
| 600 | Home · Issues | Cycles `g c` · Delivery `g d` \| Triage · Retros · Projects · Roadmap | 8 | none |

The narrow menu holds six items, which is D2's derivation observed rather than asserted. Triage's
`g t` hint is drawn at all three widths, which is D9's claim that the advertisement improved.

Also confirmed by hand: on `/teams/{id}/triage` the menu's Triage carries `aria-current="page"` and
the `more▾` trigger carries none; `g t` from a team surface opens Triage with no deck seat involved
(the first attempt appeared to fail and did not — two `press_key` round-trips exceeded
`PREFIX_WINDOW_MS`, which is the guard working); `g d` still opens Delivery, the canary for D9 and
for `delivery-metrics/spec.md:226`; Home's foot carries `Board ›` and the `⌘K` hint and nothing else,
while SHIP CADENCE keeps its own `Delivery ›`; a cleared triage queue still offers
`Issues · Cycles · Projects` and an empty inbox still offers `Issues · Home`, both untouched (D13);
and off a team (`/inbox`) the deck still offers its destinations with none marked current.

**Not performed:** 10.3 in full. The team available on the running stack has an empty triage inbox
(confirmed: `Nothing waiting.`) but does have retros and projects, so "a team with an empty triage
inbox, an empty retros list *and* no projects" was checked only in its first third. Nothing in the
change makes a destination conditional on a count — that is the whole of D4, and the deck's JSX has
no data dependency to make it so — but the observation is not the same as the argument, and this one
was not made. It is left for the integrator's pass.

### D4 had no automated coverage at all, and now has the half that needs no browser

The tests-and-docs pass found one genuine gap in an otherwise complete build: **nothing in the
suite proved D4** — that a zero count does not fold a destination. `app-frame.test.tsx`'s
*"at zero the badge and the attention segment are absent, not zeroed"* asserts the badge's absence
and says nothing about the deck's membership, which is precisely the coupling D4 forbids; and
§10.1 had routed the whole of *"Two mornings read the same"* to a browser, alongside the two
scenarios that genuinely need one.

Only part of that scenario needs a browser. The width half does; the **morning half does not** —
it is one team rendered over two data shapes, which is exactly what jsdom is for. Added as
`app-frame.test.tsx` *"a morning with nothing waiting offers the destinations a busy one does, in
the same order"*: it reads the bar and the permanent list on the empty fixture, then again on
`fourExceptions()`, and compares. The badge is asserted on both renders in the same breath, because
without it the comparison could hold for a reason that has nothing to do with D4 — the two renders
have to be shown to genuinely differ before their agreeing about destinations means anything.

**Falsified in both directions**, since a test nobody has seen fail is a comment:

- Gating Triage's permanent item on `attention !== null` (fold when quiet) turns **three** tests
  red — the new one and the two that render the quiet fixture.
- Gating it on `attention === null` (fold when busy) turns **exactly one** red: the new one. Every
  other test in the file, and the whole of `routes.test.tsx`, stays green.

The second is the one that justifies the test existing. A data-dependent deck that happens to agree
with each fixed fixture is invisible to a suite of single-render assertions, however many there are;
only a test that renders the same route twice over different data can see it. `deck.tsx` was
restored from a copy and `git diff` on it confirmed empty before the suite was re-run.

This does not close 10.3. The hand check on a team that is empty in all three respects is still
unmade, and the new test is not a substitute for it: it proves the deck does not vary with the data
the frame reads, not that each destination opens onto its own empty state. That second half is still
the integrator's.

### The palette stopped keeping its own copy of the eight

Review found the one place the budget was still enforced by hand: `app-frame.tsx` wrote out eight
`Go to` rows beside `deck.tsx`'s eight `<Link>`s, and the §5 guard held `ROUTE_HOMES` against the
deck only. Two lists of the same thing, one of them unchecked — which is how a palette ends up
offering a destination the deck retired, or advertising a key the menu no longer draws.

The eight now live once, in `apps/web/src/frame/destinations.ts`: id, label, `g` key, tier and route
id. The palette maps that table (its navigation targets are a `Record` keyed by destination id, so a
row added to the table does not compile until it has somewhere to go), `DeckStop` is the table's own
id union, and `routes.test.tsx` holds the table against `ROUTE_HOMES` and against the rendered deck —
labels, order and hints. The deck's JSX stays hand-written: each `<Link>` carries its own search
params and its own fold class, and generating that from data would trade a checked duplication for
an unreadable one.

One visible consequence: the palette's `Go to` group now reads in the DECK's order — the bar's four,
then the menu's four — rather than the router's. Triage moves from third row to fifth, which is where
a member now finds it in the deck.

Falsified: trimming the mapped list to seven turns the new palette assertion red; putting `triage`
back to `tier: 'bar'` turns the table/inventory agreement and the deck cross-check red; changing the
menu's `g t` hint to `g x` turns the cross-check red on the advertisement alone.

### The menu draws the current page, and a shed destination keeps its marking

Two gaps in D5's marking, both found in review, both in the same clause.

`MenuLinkItem` had no `aria-current` styling, so a member on Triage who opened `more▾` saw it drawn
exactly like Retros, Projects and Roadmap — marked for a screen reader and for nobody else. It now
takes weight and a 2px accent rule down its leading edge: the same pair the bar's active stop uses,
with the ink left on `--text-1` for the reason DI-2 already recorded, so the accent is only ever the
non-text rule. Both pairs are measured on the popup surface in `contrast.test.ts`.

And the `Team` group's two items carried no `aria-current` at all. Below the width that folds one,
the bar link holding the marking is `display:none`, so a member on Delivery at 900px was on a page
the deck claimed nowhere. Both folding items now take the marking from the frame's `stop` rather than
from the router's href match — the router marks a link only where the URL agrees with it, so on
`/delivery?window=12` there was nothing to inherit. Two nodes now carry the attribute per route while
only one is drawn, which is why the counting assertions stay scoped to a group.

### The menu's marking has two grounds, and the shared item had only been drawn on one

A menu row is painted on `--bg-elevated` at rest and on `--accent` when it is hovered or arrowed
onto. The marking above was written against the first only: an accent rule on an accent fill
measures 1:1, so the 2px rule the spec SHALLs disappeared at exactly the moment the reader was
pointing at the row, and `--text-1` on that fill measures 2.53–4.08 across the six presets, which
left weight carrying the state alone. Both step to `--on-accent` on the highlighted ground, in one
compound `data-highlighted:aria-[current=page]:` variant so the cascade resolves it by specificity
rather than by whichever utility Tailwind happened to emit last. `contrast.test.ts` now measures the
pair on both grounds, and records the `--text-1` bound that made the plain marking lose on the
second — DESIGN.md's "every ground" clause, applied to a surface that had been measured on one.

### The switcher's team row is exact, because the shared item now draws what it marks

`MenuLinkItem` is used by the deck, the account menu, the digests entry and the workspace/team
switcher, so giving it a current-page drawing gave one to all four. Three were already truthful;
the switcher's team row was not, because `/teams/$teamId` is a prefix of every team page and its
link is non-exact — on Members, on Issues, on Retros it drew itself as the current page while
activating it would have navigated to team Home. It takes `activeOptions={{ exact: true }}`, the
same flag and the same reason as the deck's Home stop.

Scoping the drawing to the deck instead — passing it down as a `className` — was the alternative,
and it was rejected because the defect it fixes is narrower than the one it hides: a shared menu row
SHOULD draw the page it is on, and three of the four call sites want exactly that. The bug was a
link claiming a page it does not open, and that is fixed where the claim is made. The switcher's
`<Link to="/">` needed nothing: TanStack's prefix test requires the next segment to be `/`, so the
workspace row is active on `/` alone. Both are pinned in `header-menus.test.tsx`.
