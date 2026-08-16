## Why

`openspec/SCOPE-legibility.md:27-28` states the finding: *"On the issue list, nine consecutive rows
read `Built — not live yet` beside a track that draws the same thing."* The row states delivery
reality twice — once as a phrase from the shared dictionary, once as the drawn track — and
`DESIGN.md:34` already forbids the second copy in principle: *"an ornament repeated on sixty of
sixty-nine rows is noise in either modality."*

The maintainer answered the question this raised (`SCOPE-legibility.md:42-46`): **phrase only when
it is news.** Ordinary rows go silent and carry the drawn track alone; exception rows keep their
words. Two alternatives — a peek instead of a phrase, and keeping both columns — were declined.

`apps/docs/src/content/docs/features/issue-list.md:44-46` already tells readers this is how the
product works: *"A row with no linked pull request, **or one whose delivery state adds nothing the
track has not already drawn**, stays genuinely blank."* No code implements the second clause. This
change makes the documented rule true.

## The gate this change owes, and how it is answered

`openspec/specs/reality-vocabulary/spec.md:361-362`:

> A phrase SHALL be real text, never an icon-only signal, so it is readable by assistive
> technology and by a reader who cannot distinguish the drawing's hues.

Silencing the phrase makes an ordinary row's delivery signal **drawing-only**, which that sentence
forbids — for the two readers least able to absorb the loss. The maintainer's answer
(`SCOPE-legibility.md:57-62`): **the accessible name on the reality track carries the phrase.**
Visually silent, fully present in the accessibility tree, nothing to press. The peek-carries-it and
visible-but-demoted options were both declined.

So this change owes two testable requirements, and it owes them **together**:

1. A silenced row's track exposes the phrase as its accessible name, in the same words the visible
   register would have used.
2. The track's stations stay separable **by shape**, so a hue-blind reader loses nothing either.

This is a **register definition plus an accessible-name contract, not a new mechanism.**
`reality-vocabulary/spec.md:355-359` already lets a register *"resolve a key to silence"* and
already requires every register to be total over the key set. `packages/schema/src/zero/phrases.ts`
already holds the register tables, the urgency flag and the provenance flag as properties of the
**entry**, so no surface re-decides them (`:4-8`). Nothing here invents a pattern.

## What reading the code added that the scope could not

Three findings, each read rather than remembered, and each one changes the shape of the work.

**1. The drawing is lossier than the phrase, so silence is not currently safe.**
`packages/ui/src/components/reality-track.tsx:45-50` maps **both** `approved` and `merged` onto the
change station's `done` node. An approved-but-unmerged change and a merged-but-undeployed one
therefore draw an **identical track** — `[done][ci][done][empty]` — and the phrase (`Approved` versus
`Built — not live yet`) is the only thing telling them apart. Silencing both would erase a real
distinction rather than a repetition. It would also be a false claim on its own terms: a station
reading "reached" for a change that has not landed says the change landed.

**2. Four of the six node kinds — two pairs — are told apart by hue or by nothing a reader can
measure.** `reality-track.tsx:229-236`: `done` is `size-[7px] rounded-full bg-status-done`; `open`
is `size-[7px] rounded-full bg-status-in-review` — the same 7px filled disc, differing in the token
and in **nothing else**. `empty` and `empty-urgent` are both `size-[7px] rounded-full` hollow rings
differing in the token and in 0.2px of border (`border-[1.4px]` versus `border-[1.6px]`,
`:234-235`), which is not a channel anybody reads. Today both pairs are survivable because the
phrase says in text what the hue says in colour. The moment the phrase goes quiet, the drawing is the only visual
channel and it separates by hue — exactly what `DESIGN.md:12` rules out: *"anything that must be
told apart is told apart by shape too."* `reality-track.tsx:247-249` already applies the rule to
the three CI kinds and calls WCAG 1.4.1 by name; it was never applied across the whole node set.

**3. The Roadmap's accessible name already contradicts its own drawing.**
`apps/web/src/projects/roadmap-view.tsx:647` draws `Scheduled outside this window` for a project
whose issues sit in cycles beyond the drawn window. `:668` composes that same row's **one**
accessible name (`:455`, `rowLabel`) and says `no issues scheduled in a cycle` — which is false for
that row by construction, because it reached `:647` only by having `scheduledCount > 0`. A sighted
reader is told the work is scheduled elsewhere; a screen-reader user is told nobody scheduled it.
This change fixes it, and the fix is what lets the visible note go quiet.

## What Changes

**A third register, `news`.** `packages/schema/src/zero/phrases.ts:52` declares
`PhraseRegister = 'neutral' | 'personal'`. A third joins them, total over the same fourteen keys,
and every register entry resolves to one of **three** states rather than two:

| resolution | drawn | spoken | today's example |
|---|---|---|---|
| **text** | yes | as itself | `Checks failing` |
| **quiet** | no | by the drawing's accessible name | `Approved` on a list row |
| **silence** | no | not at all | `in_progress` in `neutral` (`phrases.ts:118`) |

`neutral` and `personal` gain no quiet entries — every key they resolve is drawn or silent, exactly
as today. `news` speaks five keys and quiets four:

| key | `news` | why |
|---|---|---|
| `diverged_behind_merge`, `diverged_ahead_of_pr`, `diverged_done_ci_failing`, `checks_failing` | **text** | the four keys `phrases.ts:79-84` already marks urgent — the exception set the maintainer named, not a list invented here |
| `review_returned` | **text** | the drawing has no node for *a review came back*: `reality-track.tsx:59-63` draws `rev-wait` for every open PR, and the age column draws the number without naming the clock. Silencing it would erase the distinction `reality-vocabulary/spec.md:127-130` exists to protect |
| `merged_not_deployed`, `pr_approved`, `pr_draft`, `review_unreviewed` | **quiet** | the track draws the same fact, once the change station stops conflating approved with merged |
| `deployed`, `in_review`, `in_progress`, `not_started`, `in_backlog` | **silence** | already silent in `neutral` (`phrases.ts:102`, `:117-120`); unchanged |

**The change station stops claiming an approved change landed.** `prNode` maps `approved` to the
`open` node instead of `done`. The review station already reads `done` for an approved PR
(`reality-track.tsx:59-63`), so approved draws `[open][ci][done][empty]` and merged draws
`[done][ci][done][empty]` — distinguishable, and each truthful. **This is the precondition for the
silence, not a tidy-up beside it**, and the spec states it as one: a key may be resolved to quiet
only where the drawing distinguishes it from every other quiet or silent key.

**The six node kinds become separable without hue.** A non-colour channel — filled versus outlined,
or the drawn form — separates every pair. Colour reinforces; it never carries a distinction alone.
The **vertical rail is excluded**: its stations carry a label line and a fact line in text
(`reality-vocabulary/spec.md:423-436`), so no reader tells its nodes apart by eye.

**The accessible name carries what the eye no longer reads.** `realityTrackLabel`
(`reality-track.tsx:198-210`) composes the track's `role="img"` name from the facts it draws; it
gains the quiet words at the head. Where a phrase **is** drawn, the name does **not** repeat it —
`apps/web/src/home/team-home.tsx:791-793` already keeps that discipline for the divergence sentence
(*"a screen reader should hear it once"*), and this change makes it a rule instead of a comment.
Where an explicit accessible name suppresses the track's own — the board card,
`apps/web/src/board/board.tsx:959` — the card's name carries the words instead.

**One shipped surface already breaks that rule, and this change fixes it rather than shipping a
requirement it violates.** Delivery's divergence peek passes the phrase itself into the track's name
— `realityTrackLabel(peek.strip, peek.phrase)` (`apps/web/src/delivery/delivery-view.tsx:284`) —
while drawing that same string in visible bold one line below (`:286`). A screen-reader user hears
`Done in git, not on the board` twice in one panel. Every other surface passes a different sentence
(`DIVERGENCE_LABEL`, `apps/web/src/issues/delivery.ts:35-39`) or none, so this is a one-line
correction, not a new mechanism; the peek's register stays `neutral`. Found by reading the rule
against the code (design D3), which is what a requirement that already had a violation deserves.

**Three surfaces speak `news`; three keep `neutral`.**

| surface | register | why |
|---|---|---|
| the issue list row (`apps/web/src/issues/issue-list.tsx:609`) | `news` | draws the track and its age column beside the phrase |
| a board card (`apps/web/src/board/board.tsx:769`) | `news` | `openspec/specs/board/spec.md:18` requires a card to carry *"the same facts as a list row in a different shape"* |
| one project's issue rows (`apps/web/src/projects/project-page.tsx:602`) | `news` | the same `IssueRow` primitive and the same track |
| the Cycles carried-in band (`apps/web/src/cycles/cycles-view.tsx:530`) | `neutral` | draws **no** reality track — a `CarryChain` beside it draws carry depth, a different fact. The phrase is that row's only statement of delivery reality, and `openspec/specs/cycles/spec.md:250` mandates it |
| the issue detail (`apps/web/src/issues/issue-detail.tsx:1014`, `:1069`) | `neutral` | B3 `one-timeline` owns that page's triple statement (`SCOPE-legibility.md:154`) |
| Delivery's divergence peek (`packages/schema/src/zero/metrics/page.ts:1176`) | `neutral` | classifies `status_behind_merge` only, which speaks in every register. Its register does not move, but its track's accessible name repeats the phrase drawn beside it (`apps/web/src/delivery/delivery-view.tsx:284` versus `:286`) — the one shipped breach of the rule below, corrected here (design D3) |

**The board card gains the track's age column.** `board-card.tsx:10` reserves 86px and passes no
`age`, so the review age lives only in the phrase there. Quieting `review_unreviewed` without the
column would drop a fact from the drawing rather than deduplicate it.

**Roadmap's `Scheduled outside this window` goes quiet and its label stops lying.** The note fires
on every project whose cycles fall outside the drawn window — on the maintainer's walk, 10 of 10
rows (`SCOPE-legibility.md:153`). `Nothing scheduled` and `No issues yet` stay drawn: both are news,
and `openspec/specs/projects/spec.md:186-189` requires the first by name.

### Explicitly NOT built, and why

- **Home's YOURS band is out of scope, and that is a departure from this change's own scope line.**
  `SCOPE-legibility.md:153` says *"the list/digest register resolves non-exception keys to
  silence"* — sweeping the digest in by a table cell. The decision it records
  (`:42-46`) was taken against screenshots of **the issue row**. Three facts argue the digest is a
  different case, and they are in design D6. The `personal` register is not edited.

- **The `neutral` register is not edited.** Every existing assertion over it stays green unchanged —
  `packages/ui/src/components/rest-phrase.test.tsx` in full, `packages/schema/src/zero/phrases.test.ts:61-72`,
  `apps/web/src/issues/timeline-view.test.ts:167-198`. A change that silenced `neutral` in place
  would have taken the Cycles carried-in band's only delivery statement with it, invisibly.

- **No phrase string is rewritten, added or deleted.** The dictionary's words are unchanged; only
  where they are rendered moves. `phrases.test.ts:220-266`'s one-file guard keeps passing on the
  same eight strings.

- **The vertical rail's node drawing is unchanged** (`reality-track.tsx:280-287`). Its stations
  carry text.

- **No peek, no tooltip, no legend, no hover.** Those are what the maintainer declined
  (`SCOPE-legibility.md:44-46`, `:60-62`) and what E1 `notation-legend` exists to place.

- **Delivery's `CYCLE FLOW` / `REVIEW RHYTHM`, the refusals, and the metrics promise are untouched.**
  Those belong to B1's boundary requirement, which shipped in PR #59.

Non-goals folded deliberately: no destination is added or removed (`destination-budget`); no
surface is re-registered to the settled vocabulary (`register-seam`); no `how ·` moves
(`explanation-at-rest`, merged). No new table, migration, named query, mutator, dependency, env var
or container.

## What this change AMENDS

`ROADMAP.md:94` §Differentiation commitments commits the row to both notations:

> a row with a linked change both **draws** its delivery signal (PR/CI/deploy/review) as a reality
> track, with a `//` break where the board and git disagree, and **says** it, in words from one
> shared phrase dictionary (`Checks failing`, `Done in git, not on the board`, `Built — not live
> yet`)

This change narrows that commitment: the row draws its signal always and **says** it when the signal
is news, and says it in the accessible name otherwise. Two of the three phrases the sentence quotes
survive as drawn text; `Built — not live yet` becomes one the drawing carries. The argument is in
design D1 and D7. **`ROADMAP.md` is not edited here** — sibling proposals in this family are
authored in parallel and that file is the guaranteed conflict, so the row and the amendment are
taken once by whoever integrates (`SCOPE-legibility.md:190-192`).

## Capabilities

### New Capabilities

<!-- none: this change defines a register in a dictionary that already supports registers -->

### Modified Capabilities

- `reality-vocabulary`: a register entry resolves to text, **quiet** or silence; the `news` register
  is named and its admission rule stated; a key may be quiet only where the drawing distinguishes
  it; the change station stops reading "reached" for an approved-but-unmerged change; the track's
  accessible name carries a quiet phrase and never repeats a drawn one; the six node kinds are
  separable without hue.
- `issue-list`: the row speaks the `news` register, its phrase slot keeps its reserved measure, and
  the words a quiet row no longer draws are carried by its track's accessible name; the provenance
  mark rides drawn text, so a quiet check or deploy phrase draws none.
- `board`: a card speaks the same register as the row it mirrors, its explicit accessible name
  carries a quiet phrase, and its track reserves the age column so the review age stays drawn.
- `projects`: the roadmap row's out-of-window note goes quiet and the row's one label states the
  schedule truthfully; a project page's issue rows speak the list's register.

## Impact

- `packages/schema/src/zero/phrases.ts`: `PhraseRegister` (`:52`) gains `news`; `RestPhrase`
  (`:54-63`) gains `spoken`; a `NEWS` table beside `NEUTRAL` (`:96-121`) and `PERSONAL` (`:123-138`);
  `restPhrase` (`:182-195`) resolves the third state. `URGENT` (`:79-84`) and `SOURCED` (`:73-77`)
  are unchanged and `classifyRestPhrase` (`:150-180`) is not touched.
- `packages/schema/src/index.ts:683-688`: the type re-export block, where `PhraseRegister` (`:684`)
  and `RestPhrase` (`:685`) are the two names this change widens. The value re-exports (`:689-694`)
  are unchanged.
- `packages/ui/src/components/reality-track.tsx`: `prNode` (`:45-50`); `NODE_CLASS` (`:229-236`) and
  a shape descriptor beside it; `realityTrackLabel` (`:198-210`) takes the quiet words.
  `RAIL_NODE_CLASS` (`:280-287`) is untouched.
- `packages/ui/src/components/board-card.tsx:10`: `CARD_TRACK_WIDTH` widens to carry the age column.
- `packages/ui/src/components/rest-phrase.tsx:17`: unchanged — a quiet entry has `text === null` and
  already renders nothing.
- `apps/web/src/issues/delivery.ts:55-75`: `deliveryView` takes a register, defaulting to `neutral`,
  so every caller not listed below is unchanged by construction.
- `apps/web/src/issues/issue-list.tsx:609-620`, `apps/web/src/projects/project-page.tsx:602-616`,
  `apps/web/src/board/board.tsx:751-771` and `:959`: the three `news` speakers.
- `apps/web/src/projects/roadmap-view.tsx:644-649`, `:658-671`.
- `apps/web/src/delivery/delivery-view.tsx:284`: the peek's track takes the divergence sentence
  instead of the phrase `PeekFact` already draws at `:286`. Register unchanged.
- Tests updated: `apps/web/src/issues/issue-list.test.tsx:202-214`, `:230-252`;
  `packages/schema/src/zero/phrases.test.ts:31-59`, `:220-266`;
  `apps/web/src/board/board.test.tsx:225`, `:252`;
  `apps/web/src/projects/project-page.test.tsx:278`;
  `packages/ui/src/components/reality-track.test.tsx:63-82`;
  `apps/web/src/projects/roadmap-view.test.tsx:177`;
  `apps/web/src/delivery/delivery-view.test.tsx:388-410` (the peek test gains the second half; its
  `getByRole('img', { name: /PR merged/ })` at `:401` matches the facts and stays green).
- Tests deliberately **not** edited, and asserted to still pass:
  `packages/ui/src/components/rest-phrase.test.tsx` (all four),
  `apps/web/src/issues/timeline-view.test.ts:167-198`,
  `apps/web/src/issues/issue-list.test.tsx:217-228` and `:253-259`,
  `packages/schema/src/zero/team-home.test.ts:453` and `:502`.
- **One e2e spec is in range and needs no edit.** `apps/web/e2e/connectors.spec.ts:10` pins
  `Done in git, not on the board` and asserts it at `:104` and `:155` on the issue detail's
  `divergence-pill` — a `neutral` surface, and an exception key that speaks in every register.
- No dependency, env var, container, table, migration, named query or mutator. `packages/ui`'s
  drawn tokens are unchanged in hue; the node forms change, so
  `packages/ui/src/styles/contrast.test.ts` is re-run over the same pairs rather than given new ones.
  `ROADMAP.md` is not edited (see above).

Docs: `apps/docs/src/content/docs/features/issue-list.md:44-60` (the phrase table gains a *drawn /
spoken* column and `:44-46`'s claim becomes true) and `:70-73` (two registers become three);
`features/reality-vocabulary.md:244-262` (the register table and the silence paragraph);
`features/board.md:52-59` (the card's phrase and its accessible name);
`features/projects.md:141-142` (which of the three roadmap notes is drawn);
`features/delivery-signals.md:130-137` (the phrase column is the neutral register's).
