# Design — explanation-at-rest

## Context

The mission input is `openspec/SCOPE-legibility.md`, change **B1**. Its own row (`:152`) states the
finding: *"`delivery-metrics/spec.md:271` says every derived number 'SHALL carry a quiet `how ·`
affordance and SHALL carry no other explanation at rest: no caption sentence, no legend, no
footnote, no tooltip' — and it is enforced on exactly one page."*

What already exists and must be **used, not rebuilt**:

- `packages/ui/src/components/how.tsx` — the affordance. Trigger is a real `<button>` with
  `aria-expanded` (`:53`), `aria-label={\`How ${label} is derived\`}` (`:58`), Escape-closes-and-
  returns-focus (`:33-38`), and focus-leaving-folds (`:42-46`). The panel is
  `{open ? (…) : null}` (`:66-91`) — **conditionally rendered, not visually hidden**.
- Two surfaces already mount it correctly beside the prose they should have folded:
  `apps/web/src/projects/projects-view.tsx:223-230` and
  `apps/web/src/projects/project-page.tsx:378-384`. Their panel text is good and is not edited.
- `apps/web/src/home/team-home.tsx:148-173` — `BandHeader`, which already has an `onward` slot
  (declared `:152`, typed `:157`, drawn `:170`) currently used by the YOURS Runway doorway
  (`:735`).
- `packages/schema/src/zero/team-home.ts` — `YOURS_FOOTNOTE` (`:363-364`), `footline`
  (declared `:339-340`, assembled `:545-548`, returned `:561`).

Constraints inherited and not negotiable here: no product code in this change (the maintainer's
process choice, `SCOPE-legibility.md:47`); tokens only; keyboard-first; sub-100ms; three containers;
all derivations in `packages/schema`.

## Goals / Non-Goals

**Goals**

- One requirement, in `reality-vocabulary`, that binds every surface — so the next surface does not
  re-decide this.
- The four query-definition sites stop printing their derivation at rest; every clause stays
  reachable.
- The boundary is written down and testable: what folds, and what must never be folded.
- Retros stops contradicting `retrospective/spec.md:403`.
- No shared component edited, no e2e touched, no assertion weakened.

**Non-Goals**

- Reversing `app-frame/spec.md:229` (D5). This change reverses no recorded position at all.
- Folding refusals, the retro room's live-session copy, or Delivery's section standfirsts (D10).
- Any change to the deck, to row phrases, to the frame, or to `packages/ui`.
- Any new synced entity, named query, mutator, migration or container.

## Decisions

### D1 — The boundary: `how ·` explains derivations, and is not a drawer for prose

The failure mode this change could create is worse than the one it fixes: a rule that says "prose
folds" turns `how ·` into a place to hide anything a reviewer finds wordy, and the first casualties
would be the sentences that make yapm honest. So the boundary is a requirement, not a convention.

**Folds — a query definition.** A statement of the rows a surface counted, the scope it counted
them over, or the clauses of the lens it applied. It is a derivation of what is drawn; it is
identically true of every render; and re-reading it every morning buys the reader nothing. All four
in-scope sites are exactly this:

| site | what it defines |
|---|---|
| `team-home.tsx:835` | the YOURS lens: `assignee you · status < done · ordered by last movement` |
| `team-home.tsx:971` | the page's composition rules, over the bands that actually rendered |
| `projects-view.tsx:222` | the counting scope: workspace-wide projects, team-scoped issues |
| `project-page.tsx:377` | the same, for one project |

**Never folds — a refusal.** `cycles-view.tsx:562`, `roadmap-view.tsx:255` and
`delivery-view.tsx:435` state what the product **will not** measure. A refusal is not the derivation
of anything drawn; it is the reason something is *absent*, and absence is the one thing a fold
cannot communicate. `projects/spec.md:141` requires it in so many words — *"The surface SHALL state
that refusal in its own words."* Each already carries its own `how ·` for the derivation it refused
(`roadmap-view.tsx:258-262`, `cycles-view.tsx:564-568`), which is the correct division of labour and
the model for the rule.

**Never folds — a mandated promise.** D5.

**Never folds — a derived section standfirst that states a finding.** D10. This is the category the
definition above comes closest to swallowing — a standfirst *is* a sentence about derived data, and
"a caption sentence" is in the fold list. What separates it is that the standfirst states the
**finding** rather than the method: `metrics/page.ts:1015` assembles *"Nothing carried from one of
these N cycles into the next."* — that is the reading, not the recipe for it, and the recipe already
sits in the same section's `how ·` (`delivery-view.tsx:332`). Fold the finding and the drawing
beneath it has nothing left to be evidence *for*.

**Never folds — an empty state's one quiet line.** There is no drawn fact to hang an affordance on,
and the line is the surface's only content. This is `decision-record`'s D8 precedent and it is why
Retros is a defect fix rather than a fold (D6).

### D2 — The prohibition generalises; the obligation does not

`delivery-metrics/spec.md:271` is two sentences welded together:

1. *"Every derived number on the page SHALL carry a quiet `how ·` affordance"* — an **obligation**.
2. *"and SHALL carry no other explanation at rest"* — a **prohibition**.

Lifting (1) product-wide would require an affordance beside every mono count in the product — the
masthead count on nine surfaces, `done/total` on every project row, `Day N of M` on the hero. That
adds chrome in the name of removing chrome, and it is the opposite of what
`SCOPE-legibility.md:13` was scoped against.

So the generalised requirement lifts **(2) only**, and states (1) as conditional: where an
explanation exists it lives behind exactly one `how ·`; a number nobody explains needs no
affordance. `delivery-metrics/spec.md:271` keeps its stricter local form for the Delivery page,
where the obligation is genuinely wanted, and stays true underneath the general rule. It is not
edited by this change — a page-specific rule that is stricter than the general one is not a
contradiction.

The new requirement also adds a clause with no precedent, because two surfaces need it: **a
derivation SHALL NOT be drawn beside its own affordance.** That is the literal shipped state at
`projects-view.tsx:222-230`, and no existing sentence forbids it.

### D3 — The fold is a DOM absence, and that is the right trade for a query definition

`how.tsx:66` renders the panel as `{open ? (…) : null}`. The derivation is therefore **absent from
the document** when closed — not `hidden`, not `sr-only`, not clipped. Folding a sentence behind it
removes that sentence from the accessibility tree, from find-in-page, and from a `getByText` query,
for every reader equally.

For a query definition that is acceptable, on three grounds:

1. **It is supplementary.** The facts the definition scopes — the rows, the counts, the meters —
   are all still drawn. Nothing that only the sentence knew is lost.
2. **The trigger is a real control with a truthful name.** `how.tsx:58` gives it
   `aria-label="How the counting rule is derived"`; `:53` exposes `aria-expanded`; `:33-38` binds
   Escape. A screen-reader user reaches it in document order and is told exactly what it holds.
   This is strictly better than a `title` attribute or a hover tooltip, both of which the rule bans.
3. **It is the pattern already shipped** for every derived number on Delivery
   (`delivery-metrics/spec.md:271` — *"Every derived number on the page SHALL carry a quiet `how ·`
   affordance"*, keyboard-operable and Escape-dismissible by `:231`) and for the past-target
   derivation on Projects (`projects/spec.md:297`). This change adds no new interaction for a reader
   to learn.

And it is **precisely why the refusals and the metrics promise are not folded.** For those, absence
from the DOM at rest is the whole harm: the reader who does not open the fold learns nothing about
what the product declines to measure, and a promise nobody can find is not a promise. The same
mechanical fact argues both sides of D1's line, which is what makes the line real rather than
aesthetic.

### D4 — Where each affordance lands

**Home — the YOURS band.** The lens definition belongs to the band, and the band already has a
header slot for exactly this kind of trailing element (`BandHeader`'s `onward`, `team-home.tsx:152`).
The `how ·` rides beside the count — the derived number it defines — which is the Delivery pattern
verbatim.

```
before                                     after
────────────────────────────────────────   ────────────────────────────────────────
 YOURS  3                                   YOURS  3                        how ·
 ◐ ENG-117  Rate-limit the coupon …         ◐ ENG-117  Rate-limit the coupon …
   Approved — merge when ready                Approved — merge when ready
   checks green · approved 9h                 checks green · approved 9h
 ▸ 1 of yours is waiting on others          ▸ 1 of yours is waiting on others
 ───────────────────────────────────        ───────────────────────────────────
 yours = assignee you · status < done ·     (nothing)
 ordered by last movement · your work
 only — never compared
```

Opened, the panel's kicker reads `how · yours` and the body carries the clauses in prose. The
Runway doorway and the lens affordance cannot collide over that one slot: the doorway is rendered
only when `empty && runway !== null` (`team-home.tsx:736`), and the lens affordance is rendered only
when the band has rows.

**Home — the page foot.** The composition record has no number to sit beside; it is a statement
about the page. The affordance stands alone where `Footline` (`team-home.tsx:968-975`) stood, above
the untouched `OnwardFooter`.

```
before                                     after
────────────────────────────────────────   ────────────────────────────────────────
 composed = attention first · your lens     how ·
 — your work only · empty bands fold away
 ─────────────────────────────────────      ─────────────────────────────────────
 Issues ›  · Board ›  · Delivery in full    Issues ›  · Board ›  · Delivery in full
```

**Projects index and one project's page.** One `<span>` deleted; the `<How>` beside it is not
edited, because its panel text (`projects-view.tsx:226-229`, `project-page.tsx:381-383`) already
carries both the scope and the counting rule. The masthead's `ScopeChip`
(`apps/web/src/projects/project-controls.tsx:38-54`, mounted at `projects-view.tsx:141` and
`project-page.tsx:226`) is a **label**, not a derivation, and stays.

```
before                                     after
────────────────────────────────────────   ────────────────────────────────────────
 workspace-scoped · counted over the        how ·
 issues in your teams   how ·
```

### D5 — Why `your work only — never compared` folds and `never a per-person number` does not

These two look alike and are not. Both are promises about surveillance. The difference is what each
is a promise *about*.

`team-home.tsx:835`'s clause is the **last clause of a query definition**: `assignee you · status <
done · ordered by last movement · your work only — never compared`. It describes the rows the band
selected. It is true of the render because the query says so, and `team-home/spec.md:226-227`
already carries the structural guarantee independently — *"the YOURS band contains no other user's
identity or per-person count."* That guarantee does not weaken when the sentence folds; it was never
carried by the sentence. The delta restates it and drops only the clause requiring the footnote to
be printed.

`delivery-view.tsx:146`'s clause is a **page-scoping promise about the product**, appended to a
standfirst that says nothing else about it. It is not derived from anything on the page, and:

- `app-frame/spec.md:229-230` **mandates** it — *"The one binding rule about metrics ('team-level
  only — never a per-person number') SHALL appear once in the application, on the delivery
  surface."*
- `apps/web/src/delivery/delivery-view.test.tsx:278` asserts the standfirst carries it and `:280`
  asserts `toHaveLength(1)` over the whole rendered page.
- `packages/schema/src/zero/metrics/page.test.ts:856-865` asserts the string is declared in exactly
  one source file across four `src` roots.

`SCOPE-legibility.md`'s B1 row, as first drafted, scoped this change as *"Carries the
`app-frame:229` reversal"*, and its recorded-position 2 (`:96-103`) argued it as one of five
positions in the family's way. The maintainer's decision is that the promise stays, and that
resolution now reads back in the scope doc itself — *"Resolved 2026-08-15: nothing in this family
reverses it. B1 was expected to want it behind `how ·` and, on inspection, declined"* (`:98-99`).
**This proposal therefore narrows its own scope line rather than executing it, and reverses no
recorded position at all.** That is worth stating rather than passing over: a family whose stated
discipline is *"a recorded position may be changed, never quietly contradicted"*
(`SCOPE-legibility.md:91-92`) owes the same explicitness when it declines to change one.
`app-frame:229` remains open for a later change to argue on its merits — with the two tests above as
the cost of doing so.

### D6 — Retros is a defect, and this change deliberately does not rebuild the surface

`retrospective/spec.md:403` scopes the quiet line to *"A team with no retros"*.
`retros-view.tsx:185-190` renders it outside the `retros.length > 0` branch that closes at `:180`,
so it renders always. `retros-view.test.tsx:101-105` and `:123` both mount teams with **no retros**,
so the suite has never had reason to notice.

```
today, on a team with nine retros            after
─────────────────────────────────────────    ─────────────────────────────────────────
 Retros  9                                    Retros  9
 ▪ Cycle 1 retro   Vote   Went well           ▪ Cycle 1 retro   Vote   Went well
 ▪ Cycle 2 retro   Closed Went well           ▪ Cycle 2 retro   Closed Went well
 …                                            …
 A retro opens when a cycle closes.           (nothing)
 cycle 9 closes in 5 days
```

On a team with **no** retros the block is unchanged, sentence and mono fact together — the empty
state keeps its one quiet line (D1), and `cycle 9 closes in 5 days` stays as a fact rather than
moving behind an affordance nobody asked for (D2: the obligation does not generalise).

The raw scope line for this site named `retros-view.tsx:188` — the mono fact — as the thing to fold,
under the heading "query-definition footnotes". It is neither a query nor a scoping rule; it is a
derived fact, and `DESIGN.md:33` condemns the *sentence* above it, not the mono line. Folding the
fact and keeping the sentence would leave the page wordier than before. **Recorded as a deliberate
departure from the scope line, with the reason**, rather than executed as written.

`SCOPE-legibility.md:146` gives Retros to **A1 `register-seam`**, which rebuilds the card rows, the
pill badge and the outlined buttons this change does not touch. B1 lands first by the maintainer's
sequencing (`:175` — *"C1 and B1 first"*, with A1 after D1 and B2), so A1 rebuilds under the rule
rather than against it. The two changes touch the
same file; they do not touch the same lines, and this one is confined to `:185-190`.

### D7 — A `how ·` standing alone, and the cost of it

Every `how ·` shipped today sits beside visible text that names its subject — a metric label on
Delivery, `Past target` on a project row, the refusal sentence on Cycles and Roadmap. Two of this
change's four sites leave the affordance **standing alone**: Home's page foot, and both Projects
feet once their span is deleted. A sighted reader sees `how ·` at 10px and cannot tell what it holds
until they open it.

Considered and rejected: **a two-word visible label** (`counting rule   how ·`). It is defensible —
`DESIGN.md:33` allows chrome to carry labels — but it re-introduces text at rest on a surface whose
complaint is text at rest, and it would have to be invented separately for four sites, which is how
a second vocabulary starts.

Also rejected: **giving `how.tsx` a visible-subject prop.** `grep -rl '<How' apps/web/src` returns
**eight** files — `cycles-view.tsx`, `delivery-view.tsx`, `delivery/stat-tile.tsx`,
`projects-view.tsx`, `project-page.tsx`, `roadmap-view.tsx`, `retro-ai-panel.tsx` and
`routes/showcase.tsx`, the last of which draws the component for review. Changing a shared drawing
with that many mountings to solve two feet is the tail wagging the dog, and this change's whole
claim is that it edits no shared component.

**Accepted**, with the mitigations named: the panel's kicker states the subject the moment it opens
(`how.tsx:80-85` renders `how · {label}`), the trigger's accessible name states it without opening
at all (`:58`), and the cost of being wrong is one keystroke. Home's YOURS affordance does not have
this problem — it sits beside the band title.

### D8 — The derivation text stays in `packages/schema`, and the constant is renamed

`delivery-metrics/spec.md:274-275` requires the derivation text to be *"produced by the same layer
that produces the number, not by the rendering surface."* The generalised requirement carries that
clause, so:

- `YOURS_FOOTNOTE` (`team-home.ts:363-364`) → **`YOURS_DERIVATION`**, and it loses the `yours = `
  prefix, which existed only for the mono `key = clauses` drawing. `team-home.tsx:835`'s
  `.replace(/^yours = /, '')` goes with it — a rendering surface stripping a prefix off a shared
  constant is a seam nobody should have to remember.
- `footline` (`team-home.ts:339-340`, `:545-548`) keeps its name, its type and its assembly. Only
  where it is read changes. The requirement it satisfies — *"SHALL never name a rule the
  implementation does not execute"* — is untouched by this change and is restated verbatim in the
  delta.

The `team-home` requirement **"The composed footline states only rules the code executed"** keeps
its name character-for-character, because a MODIFIED requirement must. The word "footline" in it is
now slightly stale; renaming it would mean a REMOVED + ADDED pair that loses the requirement's
history to buy a better noun, which is a bad trade.

### D9 — What the tests must prove, and the two that must not move

The unit suites are the entire exposure — a grep of `apps/web/e2e` for the six strings finds one
comment at `retro.spec.ts:457`. Three kinds of assertion are needed:

1. **The prose is gone at rest.** A `queryByText` for each folded string returns null on the
   rendered surface. This is stronger than it looks precisely because of D3: the panel is not in the
   DOM, so `queryByText` genuinely proves absence rather than proving a CSS class.
2. **The clause is still reachable.** Activating the trigger by keyboard reveals the derivation;
   Escape folds it and returns focus. `projects-view.test.tsx:149-174` is the shipped model for this
   assertion, down to driving the trigger with `keyDown` and asserting no navigation.
3. **The kept promises did not move.** `delivery-view.test.tsx:278` and `:280`, and
   `packages/schema/src/zero/metrics/page.test.ts:856-865`, are run **unedited**. If this change had
   drifted into folding the metrics rule, `:280`'s `toHaveLength(1)` would go to zero and say so.

One assertion needs strengthening rather than updating:
`packages/schema/src/zero/team-home.test.ts:457` reads
`expect(model.yours.footnote).toBe(YOURS_FOOTNOTE)` — a tautology that stays green through any
change to the constant's value. It becomes an assertion over the **clauses** the derivation must
state, including that it no longer carries the `yours = ` prefix.

And one gap gets closed: `apps/web/src/projects/projects-view.test.tsx` asserts nothing at all about
its own footnote. The change that deleted the span would have passed that file unedited. It gains
both halves of (1) and (2).

### D10 — Delivery's `CYCLE FLOW` and `REVIEW RHYTHM` standfirsts stay, and that is a departure

The scope line for B1, as first drafted, read:

> Delivery's `CYCLE FLOW` and `REVIEW RHYTHM` are the two least readable drawings in the product:
> bars labelled `8 9 10 11 12 0` with no axis, and twenty micro-tracks with no legend. B1 removes
> their captions; something has to replace what the captions were doing, and that is real design
> work rather than a trim.

Read plainly, that line assigned B1 the **removal** and put only the **replacement** outside the
sequence. This change declines the removal too, and the reason is not that replacing the captions
would be expensive. It is that removing them is not this change's rule to enforce. (The scope doc
has since been corrected on the same ground — `SCOPE-legibility.md:211-222` now carries the bullet
with its own note that *"An earlier draft of this line assigned the caption removal to B1. That was
wrong"*. This decision is why, and it stands whether or not that note survives another edit.)

`openspec/specs/delivery-metrics/spec.md:263-266` mandates them, in these words:

> The Delivery view SHALL be composed of sections, each of which leads with **one sentence stating
> what the data says** and then draws the evidence for it. Those section standfirsts SHALL be the
> only place on this work surface where a full sentence is allowed; everywhere else the page SHALL
> speak in labels and drawn marks.

What the scope line called those sections' "captions" is this sentence: by `:263-266` a section
standfirst is *"the only place on this work surface where a full sentence is allowed"*, so there is
nothing else on `CYCLE FLOW` or `REVIEW RHYTHM` the word could name. It is not prose the page
happened to accumulate — it is the one sentence the capability requires each section to lead with,
and `:268-269` requires it to be *derived from the data it introduces* rather than a fixed string.
`delivery-view.tsx:335-341` renders exactly that,
once per section, from `flow.standfirst` (`:376`) and `rhythm.standfirst` (`:402`), both assembled
in `packages/schema/src/zero/metrics/page.ts` (`:1013-1033`, `:1086-1096`). Deleting them is an
**amendment to `delivery-metrics`**, which would have to argue the journalism-cut requirement on its
merits and rewrite `:263-266`. Dressing that up as enforcement of the `how ·` prohibition would be
precisely the quiet contradiction this family exists to stop.

The aesthetic argument — that folding the sentence leaves two undecipherable drawings — is true and
secondary. It survives as the reason the readability problem is *real*: an axis-less bar row and
twenty unlabelled micro-tracks still need work, and that work belongs to whoever next owns Delivery,
as a change that names `delivery-metrics:263-266` and either keeps the sentences or replaces what
they do. B1 hands it forward untouched rather than half-doing it.

**Recorded as a deliberate departure from the scope line, with the reason** — the same treatment D6
gives the Retros site, and for the same purpose. A departure named is reviewable; a departure
dressed as compliance is how a scope quietly stops meaning anything. The delta's boundary
requirement carries this as its fourth never-fold category, so the next reader of the rule is bound
by it rather than by this paragraph.

## Risks / Trade-offs

- **A reader who never opens a fold loses the clauses.** Accepted for query definitions, argued in
  D3, and bounded by D1 — the sentences whose loss would actually cost honesty are the ones this
  change refuses to touch.
- **Two bare affordances.** D7, accepted with mitigations. This is the judgement most worth a
  human's eyes on the rendered page.
- **The `YOURS_DERIVATION` rename crosses a package boundary** (`packages/schema/src/index.ts:856`).
  It is one exported symbol with four references, all named in tasks.md.
- **Retros collides with A1's file.** D6. Line-disjoint, and B1 lands first by the maintainer's
  sequencing.
- **A future change may read the general rule as licence to fold a refusal.** Mitigated by writing
  the boundary as its own requirement with its own scenarios, rather than as a paragraph inside the
  `how ·` requirement where it would be easy to overlook.
- **`delivery-metrics/spec.md:271` and `issue-list/spec.md:333` now restate a general rule.** Left
  in place deliberately: both are stricter than the general form on their own pages, and deleting a
  true page-level requirement to remove a repetition in the specs is not this change's business.

## Migration Plan

Nothing to migrate. No schema, no data, no env, no container, no route. One exported constant is
renamed inside `packages/schema`; every consumer is in this repo and is listed in tasks.md.

## Open Questions

None blocking. The one judgement no test can settle is whether the two bare `how ·` affordances
(D7) read as quiet affordances or as orphaned punctuation on the rendered page — a human comparison
at 1440×900, named as such rather than approximated by an assertion.

## Appendix — the inventory the boundary was drawn against

The proposal's claim that this change takes five sites out of many is only worth reading if the
"many" is a list rather than a number somebody remembered. It is **27 sites across eight surfaces**,
each verified by reading the line. (Eight is the count of surfaces that *carry* explanation at rest;
the proposal's *"two surfaces out of nine"* counts the product's work surfaces the rule could bind.
Different denominators, both true.)

| surface | sites | what they are | this change |
|---|---|---|---|
| Team Home | `home/team-home.tsx:835`, `:971` | two query definitions | **folds both** |
| Projects index | `projects/projects-view.tsx:222` | the counting scope, printed beside its own `how ·` | **folds it** |
| One project's page | `projects/project-page.tsx:377` | the same, for one project | **folds it** |
| Roadmap | `projects/roadmap-view.tsx:255` | a refusal (*"What this page won't guess"*) | stays (D1) |
| Cycles | `cycles/cycles-view.tsx:562` | a refusal, same words | stays (D1) |
| Delivery | `delivery/delivery-view.tsx:146`, `:160`, `:179`, `:435`; `delivery/metric-tiles.tsx:77`, `:180` | the mandated metrics promise; two empty-state details; a whole-family absence line; the honesty refusal; a tile caption | stays — D5 for the promise, D1 for the refusal and the empty-state lines; the tile caption is `delivery-metrics`'s own business, not this rule's |
| The retro room | `retro/retro-view.tsx:664`, `:729`, `:833`; `retro/retro-board.tsx:542`, `:970`; `retro/retro-actions.tsx:68`, `:92`, `:116`; `retro/retro-ai-panel.tsx:406`, `:643`, `:650`; `retro/retro-seed-panel.tsx:88`, `:92` | thirteen strings instructing a live facilitated session | stays (D1) |
| Retros index | `retro/retros-view.tsx:186`, `:188` | one empty-state block, rendered unconditionally | **defect fix** (D6) |

Six of the 27 lines move, and they are five sites once the Retros block is counted as the one block
it is: two on Home, two on Projects, one on Retros. The other **21 lines stay at rest**, and every
one of them stays by a rule in D1 rather than by this change running out of appetite. The two
Delivery section standfirsts are *not* in
this table — they are not explanation attached to a drawing, they are the sentence
`delivery-metrics/spec.md:263-266` requires each section to lead with (D10), and counting them as
prose-at-rest is the error that decision exists to correct.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **The prohibition generalises, the obligation does not** (D2). A number nobody explains gets no
  new affordance.
- **`how ·` explains derivations only** (D1). Refusals, mandated promises, derived section
  standfirsts, live-session instructions, and an empty state's one quiet line are not folded — and
  the boundary ships as its own requirement with scenarios, not as prose inside another one.
- **This change reverses no recorded position** (D5), and narrows its own scope line's first-draft
  description of it. `app-frame/spec.md:229` stands; `delivery-view.test.tsx:278`/`:280` and
  `metrics/page.test.ts:856-865` run unedited as the proof.
- **Retros is a defect fix, not a fold** (D6), and the sentence folds while the mono fact stays —
  a deliberate departure from the scope line's `retros-view.tsx:188`, with the reason recorded.
- **Delivery's section standfirsts stay** (D10) — the second deliberate departure, and the one the
  scope line assigned rather than merely suggested. `delivery-metrics/spec.md:263-266` mandates
  them; removing them is an amendment to that capability, not enforcement of this one's rule.
- **No shared component is edited.** `packages/ui/src/components/how.tsx` ships unchanged, so
  `contrast.test.ts` gains no pairs and no other surface's `how ·` moves.
- **The derivation text stays in `packages/schema`** (D8), per `delivery-metrics/spec.md:274-275`.
- **No e2e spec is added or edited.** PROCESS.md §3: this change touches none of the four
  big-feature axes — no synced entity, no mutator, no permission surface, and no signature UI
  beyond the removal of four spans. The grep at proposal §Impact is the evidence.
- **`ROADMAP.md` is not edited by this change** — parallel proposals in this family make it the
  guaranteed conflict, so the row is taken once by whoever integrates. Row 47
  (`explanation-at-rest`) is already in `ROADMAP.md`, added alongside row 46 (`front-door`); the
  build flips its status column at archive time rather than adding a second row.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### The YOURS row block lost its closing rule with the footnote's divider, and got it back a
### different way

**Ambiguous:** task 3.1 deletes the hairline at `team-home.tsx:833` "which exists only to divide
that footnote from the rows". It did more than that. The YOURS row `<Link>` (`:779`) was the one
row drawing in this file **without** `last:border-b` — lines 406, 871 and 938 all carry it — because
the hairline was always the last child and closed the block for it. Deleting it left the band's rows
ending on open air whenever neither the waiting line nor the "No reviews owed" line rendered.

**Chosen:** add `last:border-b` to the YOURS row, which is the grammar the other three row lists in
the file already use. **Why:** the alternative is keeping a hairline whose only remaining job is to
close a block that every other band closes with a modifier — one seam instead of two. The fold was
supposed to remove ink, not remove structure.

### The composition record reads as a sentence over schema clauses, not as a relocated mono line

**Ambiguous:** task 4.1 says the panel body "lists `model.footline`'s clauses". A `<ul>` in a 280px
panel, a mono line moved verbatim, and a sentence were all defensible.

**Chosen:** one sentence — *"This page was composed by the rules it actually applied: attention
first, your lens — your work only, empty bands fold away."* — with the mono clause line kept in the
`constraint` slot, which is what that slot is for. **Why:** D8 requires the clauses to come from
`packages/schema`, and they still do — the render joins them, it does not author them. The mono form
survives verbatim one line below, so a reader who preferred the old drawing still gets it. Moving
the mono line into the panel unchanged would have folded a drawing rather than a derivation.

### The empty-record guard is unreachable on this build, and was written anyway

Task 4.2's guard (`footline.length === 0 → null`) cannot fire today: `team-home.ts:548` pushes
`empty bands fold away` unconditionally. It is written because the requirement binds the *record*,
not today's assembly — the day a clause becomes conditional, the foot must not strand an affordance
over nothing. Noted so a later reader does not delete it as dead code.

### Escape inside the panel does not leave the project page, and the test now says so

`project-page.test.tsx`'s scope test drives Escape twice for two different jobs. `how.tsx:33-38`
calls `stopPropagation`, so Escape inside an open panel folds the panel and returns focus to the
trigger **without** taking the page's Escape route back to the deck. That was true before this
change and untested; the rewritten test asserts both halves, because a fold that also navigated
would be a real regression and nothing else would have caught it.

### Looked at, and what looking found (task 10)

Rendered at 1440×900 over the dev stack's seeded Engineering team, light and dark:

- **Home at rest** draws no mono clause line anywhere — `composed =`, `yours =` and
  `never compared` are all absent from `main`'s text. Two triggers exist, named
  `How yours is derived` and `How this page is derived`.
- **The YOURS panel** hangs from the trigger's right edge (`align="end"`), so it stays inside the
  content column rather than running off it — the reason that prop exists.
- **The page foot's affordance** (D7's accepted risk): it does **not** read as orphaned punctuation.
  `how ·` is a word at 10px, and the panel overlaps the onward footer only while it is open, which
  is what an elevated panel is for. Recorded as looked-at rather than reasoned-about.
- **Projects index**: `workspace-scoped` and `counted over` are both gone; the masthead's
  `yapm workspace` chip still carries the scope as a label, so the surface is not silent about scope
  with the fold shut. Same on one project's page (`workspace project` absent, chip present).
- **Retros**: the defect is fixed live — the Engineering index lists two retros and renders **no**
  `retros-quiet` node. The empty state itself could not be rendered on this stack (no team in the
  synced set has zero retros), so it stays proven by `retros-view.test.tsx` rather than by eye.
- **Delivery, unchanged**: the metrics promise, the burndown refusal, `CYCLE FLOW` and
  `REVIEW RHYTHM` all still render at rest. This is the render that proves the boundary held.

### The e2e suite and the compose smoke test were run in CI, not on this machine

**Ambiguous:** tasks 11.2 and 11.3 ask for the full Playwright suite and the compose smoke test.
Both were attempted locally against the shared dev stack and both are unrunnable there, for reasons
that have nothing to do with this change: the suite's harness boots its own server on `:3210` and
expects a **fresh** database (`docker/docker-compose.dev.yml up` with new volumes in CI), while the
dev stack's Postgres holds an older run's `jwks` row and its zero-cache is bound to the dev server —
so every spec signed in and then sat on *Loading workspace…* because sync never established. The
smoke test wants port 3000 and a `--build` of the production image; 3000 is held by an unrelated
project's container on this machine.

**Chosen:** run both on the canonical harness — GitHub Actions, PR #59 — rather than tear down or
reconfigure a stack another build may be using. Both are green on `89bc8b8`: **Playwright e2e 11m7s
with no spec edited**, and **Compose smoke test 2m57s**. That is the same evidence CI would demand
at merge, produced by the job that owns it. Recorded rather than quietly skipped, because "ran the
suite" and "the suite ran" are different claims.

### Task 9.5's premise was wrong about README, and README was stale

**Ambiguous:** task 9.5 asks to *confirm* the root docs are untouched by this change "and therefore
not stale". The confirmation and the conclusion are two different claims, and for `README.md` they
came apart: the file is untouched, and it was stale anyway. `README.md:87` read *"The band ends
'your work only — never compared'."* — a sentence about where the text is **drawn**, which this
change is precisely the deletion of. Nothing in the task list would have caught it, because the task
was written as a confirmation of the file's git status rather than of its content.

**Chosen:** rewrite the bullet around the affordance, matching the idiom `README.md:166` already
uses for Delivery (*"carrying a quiet `how ·` that unfolds its own derivation"*). The guarantee the
bullet exists to make — your own work only, never compared — is unchanged and still stated; only the
claim about where it is printed moved. PROCESS.md §2 names README first among the docs a change must
not leave stale, so this is the rule working, not an extension of scope.

**The general lesson, worth more than the fix:** a fold makes stale every doc that quoted the folded
string as rendered prose. The grep that finds them is over the *deleted strings*, not over the
changed files — `grep -rn "<deleted string>" --include="*.md"` across `apps/docs/` and the root docs.
Run it after the fold, not before. The other two hits it returns (`team-home.md:111`,
`reality-vocabulary.md:190`) are correct as written: both describe the string as living behind the
affordance, which is the new truth.

### The YOURS panel's prose is authored in `packages/schema`, beside the clauses it paraphrases

**Ambiguous:** D8 puts the *derivation text* in `packages/schema` and names `YOURS_DERIVATION` as
the thing it moves. The panel body is a second statement of the same lens — prose where the constant
is clauses — and the first build authored it inline in `team-home.tsx`, on the reading that only the
mono line was "the derivation". That left the band's lens written twice, in two packages, each
independently editable: change the ordering clause in the schema and the sentence in the render goes
on saying "ordered by whatever moved most recently" whether or not it is still true.

**Chosen:** `YOURS_DERIVATION_PROSE` beside `YOURS_DERIVATION`, and `TeamHomeYours` grows a
`derivationProse` field the render reads. `DeliveryPageHow` is the precedent — it pairs a `body`
with a `constraint` on one object for exactly this reason, and `stat-tile.tsx:110-116` renders both
without authoring either. **Why:** `delivery-metrics/spec.md:274-275` asks for the derivation to be
produced by the layer that produces the number, and a paraphrase of a derivation is a derivation. It
also makes the drift testable, which it was not: `team-home.test.ts` now asserts the prose carries
the assignee, status, ordering and never-compared clauses, in the same block that asserts the mono
line does.

`Footline`'s sentence is deliberately not given this treatment. It joins `model.footline`'s
schema-authored clauses into a sentence rather than restating them, so there is nothing there for a
second author to drift — the same distinction §D8's own note about the `constraint` slot draws.

### Keyboard reveal: the surface suites fire the click a native button raises, and say why

**Ambiguous:** task 7.10 asks every reveal to be "driven by keyboard". The shipped idiom at
`projects-view.test.tsx:168` drives a `How` trigger with `fireEvent.keyDown(trigger, { key: ' ' })`,
and copying it into the four new tests looked like compliance. It is not: `how.tsx` binds no Space
handler — Space works because the trigger is a native `<button>` and the browser raises a click —
and jsdom does not perform that translation. In the four new tests the line was inert, and the
`fireEvent.click` on the next line did all the work. The pre-existing line at `:168` is load-bearing
for a different reason: it proves the *row* does not swallow the key, and that assertion is real
whether or not the panel opens.

**Chosen:** drop the inert `keyDown` from the four new reveals, focus the trigger and fire the click
Enter and Space raise, with a comment at each site naming
`packages/ui/src/components/how.test.tsx`'s *"the trigger is a real button, so Enter and Space open
it natively"* as where the native half is proven. Task 7.10 is rewritten to state the split.
**Why:** the alternative offered — assert between the keydown and the click that nothing opened —
would enshrine jsdom's gap as expected behaviour, asserting the opposite of what a real browser
does. Adding `user-event` to make the line real is a new dependency for one assertion, which the
catalog rule (CLAUDE.md §5) makes the wrong trade. Escape remains fully proven at every site: it
folds the panel and returns focus to the trigger, both asserted.

### The Retros empty state is gated on completeness, not emptiness

**Ambiguous:** D6 frames the Retros defect as one of *placement* — the block sat outside the
`retros.length > 0` branch — and the fix as moving it inside. Gating on `retros.length === 0` alone
fixes the case D6 draws and leaves a second one: before the retros query hydrates, `retros` is empty
on a team that has nine, so the first navigation to the index renders *"A retro opens when a cycle
closes."* over a team with rows — and announces it, because the line carries `role="status"`.

**Chosen:** the whole idiom `projects-view.tsx:168-173` and `triage-view.tsx:410-418` use, not half
of it — one `<p role="status">` mounted whenever `retros.length === 0`, whose *contents* swap on
`retrosResult.type === 'complete'`: the quiet sentence and its mono next-close fact when the rows are
known, the label `Loading…` while they are not. `data-testid="retros-quiet"` rides the complete
branch, so every existing empty-state assertion — and the new one that the index with rows renders no
such node — addresses exactly the node it always did. **Why:** the spec sentence the fix serves is
*"A team with no retros SHALL be met by…"*, and an unhydrated query is not a team with no retros.
Empty and known-empty are different facts, and this surface speaks the second one out loud. Gating
the node's *existence* rather than its text would trade the wrong announcement for a blank page and
for an unreliable one: a `role="status"` inserted with its message already inside it is not reliably
spoken, which is the reason `triage-view.tsx` keeps its live region persistent across the same swap.

### The bare `how ·` reads differently at a band header than at a page foot

**Task 10.4's eyeball, taken 2026-08-15 against the merged build on the running app at 1440×900,
Warm light, no custom accent.** D7 accepted an aesthetic risk: four folded sites leave a `how ·`
with no visible text naming its subject. The task said that if it reads as orphaned punctuation
rather than a quiet affordance, that is the finding and it belongs here before anyone works around
it. It reads **both ways, and the split is positional rather than aesthetic.**

**Anchored, and it works.** Team Home's YOURS affordance sits right-aligned on the band header
beside `YOURS 2`. The header is its subject, the eye already rests there, and the mono dot reads as
belonging to the band. Projects' row-level affordances (`Past target — 1 open  how ·`) read better
still, because they sit against the very phrase they explain.

**Unanchored, and it does not.** The page-foot affordances stand alone. On Projects the effect is
strongest: after the last row the page runs to roughly 200px of empty ground and the `how ·` sits
at the bottom-left of it, touching nothing. Home's is milder only because a divider and the onward
footer follow closely. In both cases the dot has no subject within reach, and the thing D7 worried
about is what happens — it reads as a mark left behind rather than a control offered.

**Not worked around, per the task.** The distinction worth carrying forward is that the affordance
needs a subject *within reach*, not a label of its own: adding visible text would re-introduce the
prose this change removed, which D7 already rejected for good reason. What the page foot lacks is
not a word but an anchor. Whoever next owns these surfaces — most likely E1 `notation-legend`,
which has to find a home for teaching anyway — should decide whether a page-scope derivation
belongs at the foot at all, or against the masthead where the page's own subject is already named.

**Still owed, and not takeable by an agent:** tasks 10.2 (do the folded panels speak in the page's
register, or are they the mono line relocated?) and 10.7 (the dark pass across all four sites).
