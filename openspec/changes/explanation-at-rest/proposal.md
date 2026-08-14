## Why

`openspec/specs/delivery-metrics/spec.md:271` already says it, in the product's own words:

> Every **derived number** on the page SHALL carry a quiet `how ·` affordance and SHALL carry no
> other explanation at rest: no caption sentence, no legend, no footnote, no tooltip.

`openspec/specs/issue-list/spec.md:333` says the same thing for one other surface — *"The list
surface carries no explanatory sentence."* The rule is right. It is written twice, scoped to one
page each time, and enforced on **two surfaces out of nine**. `DESIGN.md:33` has meanwhile bound the
whole product to it — *"only the hero of a page is allowed a sentence. Explanatory prose on a work
surface is a bug."* — and the product has been breaking that rule on the surfaces the rule was never
lifted to.

The interesting part is not that the prose exists. It is **where** it sits.
`apps/web/src/projects/projects-view.tsx:222` prints `workspace-scoped · counted over the issues in
your teams`, and `:223-230` is a `<How label="the counting rule">` whose panel says the same thing
in a fuller sentence. `apps/web/src/projects/project-page.tsx:377` does it again, with its own How
at `:378-384`. Two surfaces built the affordance, filled it correctly, and then printed the contents
next to it anyway. That is not a missing feature; it is a rule that was never generalised, so each
surface re-decided it and two of them decided both ways at once.

Home carries the same shape without the affordance. `apps/web/src/home/team-home.tsx:835` renders
`yours = assignee you · status < done · ordered by last movement · your work only — never compared`
— the constant `YOURS_FOOTNOTE` declared at `packages/schema/src/zero/team-home.ts:363-364` and
bound to the model at `:906`. `team-home.tsx:971` renders `composed = attention first · your lens —
your work only · empty bands fold away`, from `model.footline`, assembled at
`packages/schema/src/zero/team-home.ts:545-548`. **These are two different sources**, not one
constant printed twice, and both are query definitions: they describe the rows the page selected.

Retros is a third shape again. `openspec/specs/retrospective/spec.md:403` already scopes its quiet
line correctly — *"**A team with no retros** SHALL be met by a short honest statement that a retro
opens when a cycle closes, together with the mono fact of when the next cycle closes"* — and
`apps/web/src/retro/retros-view.tsx:185-190` renders it **unconditionally**, outside the
`retros.length > 0` branch that ends at `:180`. A team with nine retros is told what a retro is,
every time. That is not a spec reversal to argue; it is a page disagreeing with a requirement it
already has.

Vision principles served: the **word diet** is `DESIGN.md`'s expression of *speed is the feature* —
a reader who must re-read a scoping rule every morning is paying for it in attention; and
**honesty**, because the rule this change does *not* generalise is as load-bearing as the one it
does (below).

## What Changes

**One rule, lifted to every surface.** `reality-vocabulary` owns the `how ·` concept
(`openspec/specs/reality-vocabulary/spec.md:7` and its requirement at `:253`), so the generalised
rule is written there once and the two page-scoped restatements stay true underneath it. The rule
gains three things it did not have: it binds every surface rather than the delivery page; it names
the mono `key = clause · clause` line as a derivation, which is the shape three of the four
instances take; and it states explicitly that a surface may **not** print a derivation beside the
very affordance that holds it.

**The prohibition generalises. The obligation does not.** *"Every derived number SHALL carry a
`how ·`"* read product-wide would require an affordance beside every mono count in every masthead —
that adds chrome to relieve chrome. What binds every surface is: where an explanation exists, it
lives behind exactly one `how ·` and nowhere else at rest. A number nobody explains needs no
affordance.

**Four sites fold.**

| surface | what is drawn at rest today | after |
|---|---|---|
| Home, YOURS band | `yours = assignee you · status < done · …` (`team-home.tsx:835`) | a `how ·` in the band header's existing `onward` slot (`team-home.tsx:148-173`) |
| Home, page foot | `composed = attention first · …` (`team-home.tsx:971`) | one `how ·` where the line stood; the onward footer is untouched |
| Projects index | `workspace-scoped · counted over the issues in your teams` (`projects-view.tsx:222`) | the span goes; the `How` already at `:223-230` stays, unedited |
| One project's page | `workspace project · counted over …` (`project-page.tsx:377`) | the span goes; the `How` already at `:378-384` stays, unedited |

**One site is a defect fix, not a fold.** `retros-view.tsx:185-190` becomes conditional on the team
having no retros, which is what `retrospective/spec.md:403` already requires. Nothing moves behind
an affordance: an empty surface is allowed its one quiet line, and the mono next-close fact stays
beside it.

**Nothing is deleted.** Every clause survives as text a reader can reach — `YOURS_FOOTNOTE` becomes
`YOURS_DERIVATION`, loses the `yours = ` prefix the mono form needed, and stays in `packages/schema`
because `delivery-metrics/spec.md:274-275` requires the derivation text to come from the layer that
produced the number, not from the rendering surface.

### Explicitly out of scope, and why — this is the argument, not the caveat

An inventory of the app found **27 sites of explanation-at-rest across eight surfaces**, each read
rather than remembered — the list is in design.md §Appendix, file and line. This change takes
**five**. The governing principle, stated plainly: **`how ·` explains DERIVATIONS. It is not a
drawer for everything a page says.**

- **The refusals stay.** `apps/web/src/delivery/delivery-view.tsx:435`,
  `apps/web/src/cycles/cycles-view.tsx:562` (*"What this page won't guess: a cycle keeps no status
  history, so nothing here burns down."*) and `apps/web/src/projects/roadmap-view.tsx:255` (*"a
  project's start — only a target is stored, so nothing here draws a bar."*) are not derivations of
  anything drawn. They are the product naming what it **refuses** to measure, which is the sentence
  `openspec/specs/projects/spec.md:141` requires — *"The surface SHALL state that refusal in its own
  words."* Folding a refusal behind an affordance built for derivations is a category error: the
  reader who never opens the fold would conclude the absence was an oversight. Each already carries
  its own `how ·` for the derivation it refused, which is the correct division.

- **The Delivery standfirst stays, and this change reverses NO recorded position.**
  `apps/web/src/delivery/delivery-view.tsx:146` appends ` · team-level only — never a per-person
  number` to the page's standfirst. `openspec/specs/app-frame/spec.md:229-230` **mandates** it —
  *"The one binding rule about metrics … SHALL appear once in the application, on the delivery
  surface."* It is a page-scoping promise, not a derivation of any number beside it; it is guarded
  by `apps/web/src/delivery/delivery-view.test.tsx:278` and `:280`'s `toHaveLength(1)`, and by the
  four-src-root filesystem gate at `packages/schema/src/zero/metrics/page.test.ts:856-865`.

  `openspec/SCOPE-legibility.md`'s B1 row, as first drafted, scoped this change as *"Carries the
  `app-frame:229` reversal."* The maintainer has since decided the promise stays, and the scope doc
  records it — *"Resolved 2026-08-15: nothing in this family reverses it"* (`:98`). **This proposal
  therefore narrows its own scope line and reverses nothing** — which is worth stating out loud,
  because a family whose whole discipline is *"a recorded position may be changed, never quietly
  contradicted"* should be equally explicit when it declines to change one.

- **The retro room's copy stays.** The thirteen strings the inventory found in the retro room are
  instructions for an action being taken now, in a facilitated session — `retro-board.tsx:542`'s
  *"Nothing yet. Your cards stay private until the room moves on."* An instruction for a live act is
  not prose at rest, and folding it would hide it at exactly the moment it is needed.

- **Delivery's `CYCLE FLOW` and `REVIEW RHYTHM` standfirsts stay — and this is a departure, not
  compliance.** The scope line, as first drafted, assigned the removal to B1 in so many words:
  *"B1 removes their captions; something has to replace what the captions were doing, and that is
  real design work rather than a trim."* It put the **replacement** outside the sequence, not the
  removal. This
  change declines both, because `openspec/specs/delivery-metrics/spec.md:263-266` **mandates** those
  sentences — *"each of which leads with **one sentence stating what the data says** … Those section
  standfirsts SHALL be the only place on this work surface where a full sentence is allowed."*
  Deleting them amends `delivery-metrics`; it does not enforce this change's rule. The readability
  problem the scope line named is real and stays open for whoever next owns Delivery. **Recorded as
  a deliberate departure with its reason (design D10)**, the same treatment the Retros site gets —
  because a departure named is reviewable, and a departure dressed as compliance is not.

- **No new affordance is invented, no shared component is edited.**
  `packages/ui/src/components/how.tsx` ships unchanged. No new register, no tooltip, no legend, no
  "learn more" pattern.

Non-goals, folded deliberately: no destination is added or removed (that is `destination-budget`);
no row goes silent (that is `phrase-is-news`); no surface is re-registered to the settled vocabulary
(that is `register-seam` — see design D6 for the one file where the two changes meet); no new table,
migration, named query, mutator, dependency, env var or container.

## Capabilities

### New Capabilities

<!-- none: this change generalises a rule that already exists and enforces it on four surfaces -->

### Modified Capabilities

- `reality-vocabulary`: the `how ·` requirement binds every surface rather than the delivery page;
  a mono clause line is named as a derivation; a derivation may not be drawn beside its own
  affordance; the fold's absence-from-the-DOM behaviour and the trigger's accessible-name
  obligation are stated; and a new requirement draws the boundary — a query definition folds; a
  refusal, a mandated promise, a derived section standfirst and an empty state's one line do not.
- `team-home`: the YOURS lens definition and the page's composition record move behind their own
  `how ·`; the honesty rule over the composition record and the structural guarantee over the
  personal lens both survive unchanged; the onward footer is untouched.
- `projects`: the counting rule that both surfaces state is carried behind each surface's `how ·`
  rather than printed beside it; the masthead scope chip stays visible.
- `retrospective`: the index's quiet line is the empty state and does not render on an index that
  is already listing retros — a scenario making the requirement's existing wording falsifiable.

## Impact

- `packages/schema/src/zero/team-home.ts`: `YOURS_FOOTNOTE` (`:363-364`) → `YOURS_DERIVATION`,
  without the `yours = ` prefix; bound at `:906`. `model.footline` (`:545-548`, typed at `:339-340`)
  is unchanged in shape — only its rendering moves.
- `packages/schema/src/index.ts:856`: the re-export follows the rename.
- `apps/web/src/home/team-home.tsx`: the YOURS footnote at `:835` and the `Footline` component at
  `:968-975` become `How` mountings; `BandHeader`'s existing `onward` slot (`:148-173`) carries the
  YOURS affordance; `OnwardFooter` (`:976`) and its call site at `:128` are untouched.
- `apps/web/src/projects/projects-view.tsx:222` and `apps/web/src/projects/project-page.tsx:377`:
  the `<span>` is removed. The `<How>` beside each is not edited.
- `apps/web/src/retro/retros-view.tsx:185-190`: the quiet block renders only when the team has no
  retros. `nextClose` (`:92-99`) is unchanged.
- Tests updated: `apps/web/src/home/team-home.test.tsx:395`, `:452`, `:453`;
  `packages/schema/src/zero/team-home.test.ts:12` and `:457`;
  `apps/web/src/projects/project-page.test.tsx:343`; `apps/web/src/retro/retros-view.test.tsx:101-105`
  and `:123`. `apps/web/src/projects/projects-view.test.tsx` asserts **nothing** about its own
  footnote today — a gap this change closes rather than inherits.
- Tests deliberately **not** touched, and asserted to still pass:
  `apps/web/src/delivery/delivery-view.test.tsx:278` / `:280`, and
  `packages/schema/src/zero/metrics/page.test.ts:856-865`. They guard the promise this change keeps.
- **No e2e spec is affected.** A grep of `apps/web/e2e` for `counted over`, `workspace-scoped`,
  `won't guess`, `per-person`, `composed =`, `yours =` and `A retro opens when a cycle closes`
  returns exactly one hit — a comment at `apps/web/e2e/retro.spec.ts:457`. The exposure is
  unit-only, which is most of why this change is cheap.
- No dependency, env var, container, table, migration, named query or mutator is added or changed.
  `packages/ui` is not edited, so `packages/ui/src/styles/contrast.test.ts` gains no pairs — every
  token in play is already asserted. `ROADMAP.md` is **not** edited by this change: other proposals
  in this family are authored in parallel and that file is the guaranteed conflict, so the row is
  taken once by whoever integrates (`SCOPE-legibility.md:190-192`). That has happened — **row 47
  `explanation-at-rest`** is in `ROADMAP.md`, added by the integrator alongside row 46 `front-door`.

Docs: `apps/docs/src/content/docs/features/reality-vocabulary.md` (the generalised rule and the
boundary — what folds, what never does, and why); `features/team-home.md` (`:35`, `:109`, `:139` all
describe the two mono lines as visible); `features/projects.md:26` (which quotes the footline
verbatim as a rendered string); `features/retrospectives.md:263` (the quiet line is the empty state).
