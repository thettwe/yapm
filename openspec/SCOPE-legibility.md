# SCOPE — legibility: one register, one notation at rest, one front door

Scoped 2026-08-14 from a maintainer interview held against the running app. **Nothing here is
built or proposed yet.** This is the mission input for the next build wave, in the shape
`SCOPE-v1-gaps.md`, `SCOPE-ai-features.md` and `SCOPE-planning-surfaces.md` took for theirs.

This family is sequenced **before** `SCOPE-planning-surfaces.md`, on the maintainer's call. Release
1.0.0 was already held for that family; it is now held for this one first. The argument for the
order is in "Why this goes first" below, and it is not a matter of taste.

## The complaint, and why it is a spec finding rather than an opinion

The maintainer's words: yapm "becomes too complicated and too text heavy and so many things to
learn." A walk through every authenticated surface, signed in against seeded data, found that the
product is **breaking two of its own laws**, both already written in `DESIGN.md`:

- *"The word diet — chrome carries labels, surfaces carry phrases, and only the hero of a page is
  allowed a sentence. **Explanatory prose on a work surface is a bug.**"*
- *"**Nothing draws ink it has no fact for** … an ornament repeated on sixty of sixty-nine rows is
  noise in either modality."*

So the work is not a redesign. It is enforcement of rules the product already agreed to, plus one
genuine reversal (below) that the maintainer chose knowingly.

**The root finding: yapm encodes one fact in three notations simultaneously.** The phrase
dictionary, the drawn reality track, and the mono bifact each carry delivery reality; each was
designed for a different reader; all three ship on the same row. On the issue list, nine
consecutive rows read `Built — not live yet` beside a track that draws the same thing. On the issue
detail, `Done in git, not on the board` renders **three times at once** — breadcrumb chip,
subtitle, divergence card — plus a fourth time as the `//` in the rail. A newcomer must acquire
three vocabularies before row one parses, and a fluent user reads every fact three times forever.

## What the maintainer chose

Four questions, answered against screenshots of the running app.

**1. How far?** **A deeper IA rethink** — reopen the information architecture itself: the eight
destinations, the ~fifteen-concept vocabulary, and a first-run path that teaches the notation once
instead of never. Explicitly accepted that this may supersede parts of the northstar. Two narrower
options (a five-item surgical trim; the full nine-item audit list) were offered and declined.

**2. The issue row — how does the double encoding resolve?** **Phrase only when it is news.**
Ordinary rows go silent and carry the drawn track alone; exception rows (divergence, failing
checks) keep their words. Two alternatives were declined: dropping the phrase everywhere in favour
of a peek, and keeping both columns as they are today.

**3. Process?** **OpenSpec proposals first** — no product code until the specs are reviewed.
Consistent with the process choice recorded for the planning-surfaces family.

**4. Sequence?** **Before planning-surfaces**, accepting that 1.0.0 moves out further.

Four more, answered after the first draft of this document raised them:

**5. How much authority does D1 have over the deck?** **Removal is on the table** — D1 may
retire or demote an existing stop, not merely ration new ones. The deck a member learned may
therefore get smaller, and that cost was accepted deliberately.

**6. Where does the text go when a row goes visually silent?** **The accessible name on the
reality track carries the phrase.** Visually silent, fully present in the accessibility tree,
nothing to press and nothing to discover. The peek-carries-it and visible-but-demoted options
were both declined — the first because scanning fifty-four rows would cost fifty-four
interactions, the second because the repetition survives it.

**7. When this family and the northstar disagree, which wins?** **The specs win, and the
northstar is redrawn or annotated afterwards.** The mocks are a record of a decision that has
since moved on — which is what `NORTHSTAR.md` already does for the divergences the build was
right to take. Drawing the new frame first was offered and declined, consistent with the
straight-to-proposals choice.

**8. What gets authored first?** **C1 and B1.**

## Why this goes first

Not preference — arithmetic. Three families are queued against the same eight-stop deck:

| family | what it wants to add | state |
|---|---|---|
| this one | fewer destinations, one register | scoped here |
| `SCOPE-planning-surfaces.md` | a timeline destination, board swimlanes, a workload view | scoped, 9 changes |
| `decision-record` | ~~a **Decisions** stop in `more▾` and the `g d` hint back~~ — **rationed 2026-08-16**: the Record is a doorway, no seat and no key | proposed, 0/70, re-authored against D1 |

`app-frame/spec.md:47` fixes the deck at **"exactly six stops"** — Home, Issues, Triage, Cycles,
Delivery, `more▾` — with `more▾` already holding three items. Both queued families add destinations
to a deck that is already at its written budget, and neither can be blamed for it, because no
change owns the budget. **Setting that budget is D1 below, and it is the one hard dependency this
family imposes on the other two.** Building four planning surfaces on the current patterns would
inherit and multiply exactly what the maintainer is complaining about.

## The recorded positions this family must re-argue, not route around

Per the rule the planning-surfaces scope set for itself: *a recorded position may be changed, never
quietly contradicted.* Five are in the way.

1. **`app-frame/spec.md:47` — "exactly six stops."** D1 reopens it. The number may survive; what
   cannot survive is a family adding a seventh without amending the sentence.
2. **`app-frame/spec.md:229` — the metrics rule "SHALL appear once in the application, on the
   delivery surface."** The Delivery masthead's `team-level only — never a per-person number` is
   therefore *mandated*, not leaked. **Resolved 2026-08-15: nothing in this family reverses it.**
   B1 was expected to want it behind `how ·` and, on inspection, declined — the clause is a
   page-scoping promise rather than a derivation, so folding it into an affordance built for
   derivations is a category error, and `how.tsx` renders its panel as `{open ? … : null}`, which
   would take the guarantee out of the DOM entirely rather than merely quieting it. The line
   stays. Recorded here so a later change knows the position was examined and kept, not missed.
3. **`ROADMAP.md` §Differentiation commitments — the row both "draws" its delivery signal "and
   **says** it."** The chosen row design amends this commitment. ROADMAP must be edited in the same
   change, not left contradicting the product.
4. **`CLAUDE.md` makes `design-explorations/overhaul-2026-08/northstar/` canonical** — "judge
   shipped screens against" it. D1 changes the frame those five files draw. **Resolved (question 7):
   the specs win and the northstar is redrawn or annotated afterwards**, the way `NORTHSTAR.md`
   already records the divergences the build was right to take. Whichever change moves the frame
   owns that redraw; leaving the mocks contradicting the product is the one outcome ruled out.
5. **ROADMAP's "two visual registers" gap names five un-rebuilt destinations** — Board, Retros,
   Projects, Roadmap, Inbox. **The list is partly stale.** Projects and Roadmap now render the
   settled vocabulary (shared masthead, glyph geometry, phrases at rest, `how ·`); **Retros does
   not** — it still draws cards, a pill badge, five identical outlined buttons and an explanatory
   sentence. A1 must re-verify the list surface by surface before believing it.

## The constraint that makes the row change non-trivial

`reality-vocabulary/spec.md:361` requires that a phrase be *"real text, never an icon-only signal,
so it is readable by assistive technology and by a reader who cannot distinguish the drawing's
hues."*

Silencing the phrase on ordinary rows makes their delivery signal **drawing-only** — which that
sentence forbids, for the two readers least able to absorb the loss. So B2's central design
question is not *whether* to silence but *where the text goes*: **visual silence must not become
accessibility silence.** The mechanism is already there — `reality-vocabulary/spec.md:355-359` lets
a register "resolve a key to *silence*" while requiring every register to be total over the key
set — so this is a
register definition plus an accessible-name contract, not a new mechanism.

**Answered (question 6 above): the accessible name on the reality track carries the phrase.** B2
therefore owes two testable requirements in its spec deltas — that a silenced row's track exposes
the phrase as its accessible name, in the same words the visible register would have used; and
that the track's stations stay separable **by shape**, so a reader who cannot tell the hues apart
loses nothing either. A silenced row is silent to the eye and to no one else.

## The proposed change sequence

Seven changes in five tracks. Tracks are independent; the order inside each is forced.

### Track A — one register

| # | change | what it does | needs |
|---|---|---|---|
| A1 | `register-seam` | Rebuild whatever genuinely still carries pre-overhaul chrome to the settled vocabulary — **Retros confirmed, the rest to be re-verified** rather than trusted from ROADMAP. Closes the "two visual registers" known gap and lets that ROADMAP entry be struck | — |

### Track B — the word diet, enforced

| # | change | what it does | needs |
|---|---|---|---|
| B1 | `explanation-at-rest` | **Generalize a rule that already exists.** `delivery-metrics/spec.md:271` says every derived number "SHALL carry a quiet `how ·` affordance and SHALL carry no other explanation at rest: no caption sentence, no legend, no footnote, no tooltip" — and it is enforced on exactly one page. Home prints `yours = assignee you · status < done · …` and `composed = attention first · …`; Projects prints `workspace-scoped · counted over the issues in your teams` **directly beside its own `how ·`**. Lift the rule to every surface and fold the prose behind the affordance built for it. **Scoped 2026-08-15 to the query-definition footnotes only** — the boundary is that `how ·` explains *derivations*, so refusals, the mandated metrics promise, section standfirsts and live-session retro copy all stay at rest. **Reverses no recorded position**, which is what makes it cheap | — |
| B2 | `phrase-is-news` | The chosen row design: the list/digest register resolves non-exception keys to silence, exceptions keep their words, and the accessible name carries what the eye no longer reads. Also fixes Roadmap's `Scheduled outside this window` — technically true, fired on **10 of 10 rows**, which is the ornament rule again. Amends ROADMAP's differentiation commitment | — |
| B3 | `one-timeline` | Issue detail: `Done in git, not on the board` three times → once (the divergence card survives; it is the best interaction in the product). The DELIVERY rail and the ACTIVITY feed are the same timeline twice — pick the rail, leave Activity what the rail does not carry | B2 (shares the dedupe rule) |

### Track C — the front door

| # | change | what it does | needs |
|---|---|---|---|
| C1 | `front-door` | Sign-in lands on `/`, which is **Members / Teams / Invitations** — workspace administration. The morning digest is one click behind it. Redirect to the anchor team's Home (`app-frame:181` already defines the anchor), move administration to Settings. Also: Issues opens showing **54 Done of 57**, so the default lens buries the three live rows under an archive | — |

### Track D — the destination budget

| # | change | what it does | needs |
|---|---|---|---|
| D1 | `destination-budget` | Reopen `app-frame:47`. Decide the deck's real budget and the rule for earning a stop, including whether a zero-count destination folds — the product already holds that Triage renders a permanent stop while empty, and already holds the opposite rule for the attention badge (`app-frame:169`, "Zero is absence, not a zero"). **Removal is in scope** (question 5): D1 may retire or demote a stop, not only ration new ones, so it must also say what happens to a member who learned the old deck. **Publishes the budget the other two families build within.** Gates planning-surfaces | — |

### Track E — learning it once

| # | change | what it does | needs |
|---|---|---|---|
| E1 | `notation-legend` | One reachable place that teaches the track's four stations, the `//` break and the glyph geometry. Progressive disclosure, not a product tour, and not a legend pinned to every page — the thing B1 exists to remove | B2, D1 |
| E2 | `first-run` | What a workspace with no cycle, no issues and no linked change shows. Today Home says *"No cycle is running. Start one and this page becomes the team's morning"* — the one place a teaching sentence is arguably right, and it is the only one that gets a considered answer | C1 |

**Suggested order:** **C1 and B1 first** — the cheapest, most visible relief, and neither blocks
anything. **D1 next**, because it is the gate on the other two families and every week it waits is
a week planning-surfaces cannot start. Then **B2** (the design decision is already made, but it
owes the accessibility answer), then **A1** and **B3**. **E1 and E2 last**, because what they teach
must stop moving first.

## What the next session should do

1. Author the proposals (proposal.md, design.md with ASCII sketches, tasks.md, spec deltas),
   validate with `npx -y @fission-ai/openspec@latest validate --all`, and put them up for review —
   **proposals only, no product code**, per the maintainer's process choice.
2. Every proposal touching one of the five recorded positions above must **quote it and argue the
   reversal in its design.md.**
3. Add the ROADMAP rows, mark the family scoped, and note the sequencing change against
   planning-surfaces. **Done for the first two: rows 46 (`front-door`) and 47
   (`explanation-at-rest`) are in `ROADMAP.md`.** The remaining five changes take rows as they
   are authored. Note for whoever authors them: a change should NOT add its own row while
   siblings are being written in parallel — ROADMAP is then a guaranteed conflict, and the row
   is better taken once by whoever integrates.
4. **Re-verify the un-rebuilt destination list by walking each surface**, rather than inheriting
   ROADMAP's list — it is already partly stale.
5. ~~Ask whether `decision-record` stays parked until D1 publishes the budget.~~ **Answered
   2026-08-16: unparked, and re-authored against D1 rather than left to rot.** It is the first
   change the budget said no to. Its `app-frame` delta MODIFIED a requirement D1 removes by name,
   and its `team-home` delta carried pre-legibility text that would have reverted both B1 (built
   and merged, PR #59) and D1's footer rationing — the delta hazard now written up in
   [PROCESS.md](../PROCESS.md) §1, found in the wild rather than in theory. Both are rebuilt as
   unions; the **Decisions** stop and the `g d` reclaim are withdrawn and the Record becomes a
   doorway. Archive order is now load-bearing: **`explanation-at-rest` → `destination-budget` →
   `decision-record`**, and `openspec validate --all` passes in any order, so the gate is human.

## Found while walking, not otherwise tracked

- **Roadmap header labels collide** — two cycle-band labels overdraw near `today`, rendering as
  `Cycle 62` where `Cycle 6` and `Cycle 2` overlap. A drawing bug, not an IA one; it wants a
  one-line fix wherever it belongs, not a place in this family.
- **Navigating to the board opened five stacked file-choosers** under Playwright, blocking the
  page. Not reproduced by hand and possibly a driver artifact of the card drag-and-drop zone —
  **worth ten minutes before it is believed or dismissed**, because if it is real it is a
  keyboard-and-pointer trap on a primary lens.
- Team Home's bottom row (`Issues › Board › Delivery in full › Retro › Roadmap`) duplicates the
  deck above it — a second navigation system on the one page that least needs one. Small enough to
  fold into C1.
- Delivery's `CYCLE FLOW` and `REVIEW RHYTHM` are the two least readable drawings in the product:
  bars labelled `8 9 10 11 12 0` with no axis, and twenty micro-tracks with no legend.
  **Corrected 2026-08-15, and the correction is instructive.** An earlier draft of this line
  assigned the caption removal to B1. That was wrong:
  `openspec/specs/delivery-metrics/spec.md:263-266` *mandates* those sentences — "each [section]
  leads with **one sentence stating what the data says** … Those section standfirsts SHALL be
  the only place on this work surface where a full sentence is allowed." Removing them is an
  amendment to `delivery-metrics`, not an enforcement of B1's rule, and B1 correctly declines
  it. The readability problem is real and stays open; it belongs to whoever next owns the
  Delivery surface, as a change that argues that requirement rather than routing around it.
  The near-miss is the point: this family exists because the product contradicted its own
  written rules, and the scope doc for it did the same thing on its first draft.
