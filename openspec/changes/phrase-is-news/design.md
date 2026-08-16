# Design — phrase-is-news

## Context

The mission input is `openspec/SCOPE-legibility.md`, change **B2**. Its row (`:153`) states the
work: *"the list/digest register resolves non-exception keys to silence, exceptions keep their
words, and the accessible name carries what the eye no longer reads. Also fixes Roadmap's
`Scheduled outside this window`."*

What already exists and must be **used, not rebuilt**:

- `packages/schema/src/zero/phrases.ts` — THE dictionary. `RestPhraseKey` (`:10-31`), fourteen keys;
  `REST_PHRASE_KEYS` (`:33-48`); `PhraseRegister = 'neutral' | 'personal'` (`:52`); `RestPhrase`
  (`:54-63`); `SOURCED` (`:73-77`); `URGENT` (`:79-84`); the two register tables (`:96-121`,
  `:123-138`); `classifyRestPhrase` (`:150-180`); `restPhrase` (`:182-195`); `sayRestPhrase`
  (`:200-208`). Its header comment (`:4-8`) states the architecture this change must not break:
  *"register tables that are total over its key set … a source-level test fails if these strings
  appear in a second file."*
- `packages/ui/src/components/reality-track.tsx` — the drawing. `prNode` (`:45-50`), `ciNode`
  (`:52-57`), `reviewNode` (`:59-63`), `buildRealityShape` (`:140-160`), `realityTrackLabel`
  (`:198-210`), `isQuietTrack` (`:221-227`), `NODE_CLASS` (`:229-236`),
  `REALITY_TRACK_WIDTH = 118` (`:328`), `AGE_COLUMN_WIDTH = 26` (`:332`), the quiet branch
  (`:365-384`) and the `role="img"` branch (`:386-392`).
- `packages/ui/src/components/rest-phrase.tsx:17` — `if (!phrase || phrase.text === null) return null`.
  A quiet entry already renders nothing; the component needs no edit.
- `apps/web/src/issues/delivery.ts:55-75` — `deliveryView`, the one place a row's strip, divergence
  and phrase are derived together, hardcoding `'neutral'` at `:61`.

Constraints inherited and not negotiable here: **no product code in this change** (the maintainer's
process choice, `SCOPE-legibility.md:47`); tokens only; keyboard-first; sub-100ms; all ZQL and
derivations in `packages/schema`.

## Goals / Non-Goals

**Goals**

- A row says something only when there is something worth saying, and the rule is a property of the
  dictionary rather than a decision each surface makes.
- Visual silence is not accessibility silence, and the proof is a requirement rather than a hope.
- Visual silence is not colour-blind silence either — the second half of the same gate.
- The drawing is made able to carry what the words carried, **before** the words are taken away.
- Nothing that survives is repeated: a drawn phrase is not also spoken by the drawing.

**Non-Goals**

- Editing the `neutral` or `personal` register tables (D5, D6).
- Rewriting, adding or deleting any phrase string.
- The issue detail's threefold statement — B3 `one-timeline` (`SCOPE-legibility.md:154`).
- Any peek, tooltip, legend, hover or first-run teaching — E1 `notation-legend`.
- Any change to the deck, the `how ·`, the frame, or a synced entity.

## Decisions

### D1 — The admission rule: a phrase earns its ink by being news, and news has two sources

The failure this change could create is a list that is quieter and less true. So the rule that
decides which keys speak is written as a requirement with two admissions, and neither is a list
somebody chose:

**Admission 1 — the key is an exception.** `phrases.ts:79-84` already declares a set:

```
const URGENT = new Set([
  'diverged_behind_merge', 'diverged_ahead_of_pr', 'diverged_done_ci_failing', 'checks_failing',
])
```

Those are exactly the classes the maintainer named — *"exception rows (divergence, failing checks)
keep their words"* (`SCOPE-legibility.md:44`). The set is not invented here; it already inks the
phrase (`rest-phrase.tsx:24`) and it already mirrors `buildAttention`'s classes
(`packages/schema/src/zero/team-home.ts:583-609`). Words survive exactly where something is wrong.

**Admission 2 — the drawing beside it cannot carry the fact.** This is the admission the scope did
not anticipate, and it is what keeps the change from deleting information. Applied honestly it
saves exactly one key:

| key | what the words say | what the track draws | verdict |
|---|---|---|---|
| `merged_not_deployed` | merged, nothing shipped it | `[done][ci][done][empty]` — live station empty | carried → **quiet** |
| `pr_approved` | approved, waiting to merge | `[open][ci][done][empty]` after D2 | carried → **quiet** |
| `pr_draft` | a draft is open | `[rev-wait][ci][empty][empty]` | carried → **quiet** |
| `review_unreviewed` | open PR, nobody has reviewed, 16h | `[open][ci][rev-wait][empty]` + `16h` in the age column | carried → **quiet** |
| `review_returned` | a review **came back**, 16h ago | `[open][ci][rev-wait][empty]` + `16h` — **identical** | not carried → **text** |

`reviewNode` (`reality-track.tsx:59-63`) draws `rev-wait` for every open pull request and consults
`reviewAgeFrom` nowhere. The age column draws the number and names no clock. So the drawing cannot
say whether anybody has looked at the change — and `reality-vocabulary/spec.md:127-130` is emphatic
that the two must not be conflated: *"'waiting on a reviewer since X' is indistinguishable from
'the PR has been open since X'"*, with `phrases.ts:89-91` adding *"Saying 'waiting' of the second
would invert the fact."* `review_returned` keeps its words because it is the one key whose fact has
no drawing.

Considered and rejected: **drawing the clock**, either as a seventh node kind or as a mark in the
age column. A seventh kind reopens `reality-vocabulary/spec.md:23-25` (*"The node kinds SHALL be
exactly …"*), and a mark in the age column adds a notation to the product whose complaint is that
there are too many notations. Left open for whoever gives the review station a way to name its
clock; on that day `review_returned` joins the quiet set with no change to this rule.

### D2 — The change station stops saying an approved change landed, and that is a precondition

`reality-track.tsx:45-50`:

```
function prNode(strip) {
  if (strip?.pr === 'merged' || strip?.pr === 'approved') return 'done'
  …
}
```

Approved and merged draw the same node, so `pr_approved` and `merged_not_deployed` draw the same
track. Quieting both would erase the difference rather than deduplicate it. Quieting neither leaves
the change with almost nothing to do — those are two of the four keys the complaint is about.

So the node moves: **`approved` draws `open`.** The review station already reads `done` for an
approved PR, so the two separate:

```
                 change   checks   review   live
approved          ◍────────●────────●╌╌╌╌╌╌╌◌       "Approved"        → quiet
merged, not live  ●────────●────────●╌╌╌╌╌╌╌◌       "Built — not live yet" → quiet
                  ^ the only difference, and it is a station's state
```

This is also a correctness fix on its own terms: `done` at the change station means the change
landed, and an approved pull request has not landed. `reality-track.test.tsx:63-82` asserts the
mapping for `pr: 'open'` and does not pin `approved`, so nothing existing contradicts it.

The requirement states the general form rather than this instance: **a key may be resolved to quiet
only where the drawing distinguishes it from every other key the register resolves to quiet or
silence.** That makes the precondition testable over the whole quiet set instead of remembered for
one pair. Enumerated, the quiet and silent keys draw:

| key | change | checks | review | live | age |
|---|---|---|---|---|---|
| `pr_draft` | rev-wait | · | empty | empty | — |
| `pr_approved` | open | · | done | empty | — |
| `review_unreviewed` | open | · | rev-wait | empty | `16h` |
| `merged_not_deployed` | done | · | done | empty | — |
| `deployed` | done | · | done | **done** | — |
| `in_review` / `in_progress` / `not_started` / `in_backlog` | *(inkless track — no linked change)* |

Pairwise distinct. Without D2, rows two and four collide and the property fails — which is the
point of writing it as a property.

### D3 — Where the words go, and where they must not be repeated

`reality-track.tsx:386-392` already exposes a populated horizontal track as one `role="img"` with
`aria-label={label}`, and `realityTrackLabel` (`:198-210`) composes that label from the facts drawn
plus the divergence sentence. Two changes, both small:

1. **A quiet phrase's words lead the label.** `Built — not live yet. PR merged, CI passing.` The
   words are the register's own, identical to what it would have drawn — the maintainer's
   requirement, *"in the same words the visible register would have used"*
   (`SCOPE-legibility.md:133-134`).
2. **A drawn phrase is not repeated in the label.** `apps/web/src/home/team-home.tsx:791-793`
   already does this by hand: *"The divergence sentence is omitted because `row.say` states it in
   visible text beside this, and a screen reader should hear it once."* This change promotes that
   comment to a rule, so no reader hears a register's own words twice.

**Rule 2 is about the register's words, and one shipped surface already breaks it.** Audited rather
than assumed: every call site that composes a track label beside a visible register phrase was read.
Four pass a **different** sentence or none — `DIVERGENCE_LABEL` (`apps/web/src/issues/delivery.ts:35-39`,
*"PR merged but this issue is not marked done"*) at `issue-list.tsx:618-621`,
`project-page.tsx:611-614` and `board.tsx:761`, and nothing at all at `team-home.tsx:796`. The
fifth, Delivery's divergence peek, passes the **phrase itself**:
`realityTrackLabel(peek.strip, peek.phrase)` (`apps/web/src/delivery/delivery-view.tsx:284`), while
`PeekFact` draws that same string in visible bold one line below (`:286`) — `peek.phrase` being the
neutral register's words for `diverged_behind_merge` (`packages/schema/src/zero/metrics/page.ts:1176`).
A screen-reader user hears `Done in git, not on the board` twice in one panel **today**. Tasks 3.5
and 6.10 correct it: the peek passes the divergence sentence every other surface passes, its
register stays `neutral` (D5), and its visible phrase is untouched. Writing a requirement whose
violation already ships, unnamed, is the failure this family exists to stop.
(`team-home.tsx:443`'s class-row evidence track passes a hand-written sentence beside a **count**
line rather than a register phrase, so it is outside this rule and unchanged.)

**The fact-level reading of rule 2 was considered and not taken.** Read as *no fact is announced
twice*, it would also forbid `CI failing` in a label beside a drawn `Checks failing`, and the
divergence sentence beside a drawn `Done in git, not on the board` — on three surfaces this change
otherwise leaves alone, and on the issue detail, which is B3 `one-timeline`'s subject
(`SCOPE-legibility.md:154`). That is a real question and a wider audit than a change about a
register can carry honestly. So the requirement says *the register's words*, says so explicitly, and
leaves the break's own sentence in the label where `reality-vocabulary/spec.md:318` already puts it.

**The inkless track needs no exception.** `reality-vocabulary/spec.md:39-41` requires a track that
draws no ink to state nothing to assistive technology, and `reality-track.tsx:365-384` renders it
`aria-hidden`. Every key `news` quiets has words in `neutral`, and every one of those keys requires
`signal.pr` to be non-null (`classifyRestPhrase`, `phrases.ts:158-169`), which makes
`isFactless` (`reality-track.tsx:131-136`) false and the track inked. **There is no row whose phrase
is quiet and whose track is silent.** That is asserted rather than assumed — it is the single point where visual
silence could become total silence.

**The board card is the one surface where the track's name is unreachable.**
`apps/web/src/board/board.tsx:747-750` says why: *"the card is a `role="button"` carrying an
EXPLICIT `aria-label`, and an explicit name suppresses everything inside it — the phrase and the
track's own `role="img"` label included."* `:764` composes `spoken` from `view.phrase.text` and the
divergence sentence; it reads the quiet words instead. `openspec/specs/board/spec.md:18` already
requires the card's name to *"carry the delivery register too"*, so this is that sentence applied to
a register that can now be quiet — not a new obligation.

Found and **not taken**: `spoken` carries the register and not the track's facts, so a screen-reader
user on the board has never heard the CI state. That gap predates this change and is unchanged by
it — before, the name said `Built — not live yet`; after, it says the same words. Taking it would
rewrite every board card's accessible name and every assertion over it, for a defect this change did
not introduce. Named here so it is reviewable rather than absorbed.

### D4 — Shape separability, and why the rail is excluded

`reality-track.tsx:229-236`, read as a table:

| kind | fill | form | separated from |
|---|---|---|---|
| `done` | filled | 7px disc | — |
| `open` | filled | 7px disc | **`done` by hue alone** |
| `rev-wait` | outline | 8px ring | `empty` by hue and 1px |
| `fail` | filled | 7px square | everything, by form |
| `empty` | outline | 7px ring | — |
| `empty-urgent` | outline | 7px ring | **`empty` by hue and 0.2px of border** (`border-[1.6px]` versus `border-[1.4px]`) |

`done` versus `open` is the clean case: one token apart and identical in every other property.
`empty` versus `empty-urgent` differs in a token and in 0.2px of border, which is not a channel a
reader resolves at 7px — the same failure with a rounding error on top. `DESIGN.md:12` rules both
out: *"Hue separation, not contrast, is what keeps amber, green and urgent apart … anything that
must be told apart is told apart by shape too."*
`reality-track.tsx:247-249` already states the rule for the three CI kinds and cites WCAG 1.4.1; it
was simply never carried across the whole set. Today the phrase covers for it. After D2 it becomes
load-bearing: `done` versus `open` at the change station **is** merged versus approved, the exact
distinction D2 made the drawing responsible for.

The spec states the property — *no two node kinds are told apart by hue alone* — and leaves the
drawing to the build. One assignment that satisfies it, offered as a starting point rather than a
mandate:

```
 done          ●     filled disc          the station was reached
 open          ◍     half-filled disc     reality is at this station now
 rev-wait      ○     outline ring         waiting here
 fail          ■     filled square        it broke here
 empty         ◌     dashed outline ring  not reached — the dotted segment's grammar
 empty-urgent  □     outline square       not reached, and something is wrong (fail's family)
```

Every pair differs in fill, in form, or in stroke style. `empty-urgent` borrows `fail`'s square
deliberately: the two are the only kinds that mean *something is wrong here*, and an outline square
after a `//` break reads as the stop it is.

**The vertical rail is excluded, and the exclusion is principled, not budgetary.**
`reality-vocabulary/spec.md:319-321` requires the rail to be *"exposed as a list of stations rather
than one opaque image, so a screen reader reads the stations rather than a summary of them"*, and
`reality-track.tsx:470-481` draws a label line and a mono fact line beside every station. Nobody
tells a rail's nodes apart by eye — the words are next to them. `RAIL_NODE_CLASS` (`:280-287`)
carries the same `done`/`open` collision and it costs nothing.

Contrast: the hues do not move, so `packages/ui/src/styles/contrast.test.ts` gains no pairs. A
dashed or half-filled 7px mark is *thinner ink* against the same ground, so the file is re-run and
its measurements re-read rather than assumed — recorded in tasks.md as a check, not a formality.

### D5 — The `neutral` register is not edited, and the Cycles band is why

The obvious implementation is to silence `neutral` in place. It would be wrong, and the reason is a
requirement in another capability — PROCESS.md §1's third delta hazard, met in the wild:

> `openspec/specs/cycles/spec.md:250` — the carried-in band SHALL state *"the issue's status glyph,
> its key, its title, **its rest phrase**, the number of times it has been carried, and the cycle it
> last left"*

`apps/web/src/cycles/cycles-view.tsx:529-531` renders that phrase, and beside it at `:532-534` is a
`CarryChain` — a drawing of **carry depth**, not of delivery reality. There is no reality track on
that row. Silencing `neutral` would take the band's only statement of delivery reality away and
leave nowhere for the accessible name to put it, and it would do so without a single failing test,
because `cycles-view.test.tsx` does not assert the phrase's text.

So the rule is structural and stated as one: **a surface speaks the quiet register only where it
draws, beside the phrase, the track carrying the same facts.** The Cycles band's exemption is a
consequence of the rule rather than an exception to it. `neutral` keeps three speakers — the Cycles
band, the issue detail (`issue-detail.tsx:1014`, `:1069`), and Delivery's divergence peek
(`packages/schema/src/zero/metrics/page.ts:1176`, which classifies `status_behind_merge` only and
therefore speaks in every register).

`deliveryView` takes the register with `'neutral'` as its default (`delivery.ts:61`), so a caller
this change does not name is unchanged **by construction** rather than by review.

### D6 — Home's YOURS band is out of scope, and that is a departure from the scope line

`SCOPE-legibility.md:153` says *"the **list/digest** register resolves non-exception keys to
silence"*. Read literally that sweeps in `personal`, spoken only by Home's YOURS band
(`packages/schema/src/zero/team-home.ts:882`). The decision the scope records was taken against a
screenshot of **the issue row** — question 2 is titled *"The issue row — how does the double
encoding resolve?"* (`:42`). Three facts say the digest is a different case.

**1. The personal register says whose move it is, which the track cannot draw.** The two registers
are not two spellings of one fact:

| key | `neutral` | `personal` |
|---|---|---|
| `pr_approved` | `Approved` | `Approved — merge when ready` |
| `pr_draft` | `Draft open` | `Draft open — not in review yet` |
| `checks_failing` | `Checks failing` | `Checks failing — the fix is yours` |

`Approved` restates the drawing. `Approved — merge when ready` is a next action addressed to the
reader, and no station carries it. Under D1's second admission the personal register's words are
**not carried by the drawing**, so they stay — the rule decides this, not appetite.

**2. Silencing them would break a discipline the file already keeps.**
`apps/web/src/home/team-home.tsx:791-793` omits the divergence sentence from the row's track label
*"because `row.say` states it in visible text beside this, and a screen reader should hear it
once."* Take `row.say` away and the divergence sentence is spoken by nobody.

**3. The band is a digest, not a list.** `buildYours` (`team-home.ts:864-903`) lists the viewer's
own unfinished issues and collapses every row awaiting review into a single waiting line
(`:874-878`). It is a handful of rows the reader owns, not fifty-four rows they are scanning. The
ornament rule (`DESIGN.md:34`) is a rule about repetition, and there is no repetition here.

Recorded as a **deliberate departure from the scope line, with the reason** — the treatment B1 gave
its own two departures (`explanation-at-rest/design.md` §D6, §D10). A departure named is reviewable;
a departure dressed as compliance is how a scope stops meaning anything. A consequence worth
noting but not a reason: `team-home` is already restated by three in-flight changes
(`explanation-at-rest`, `destination-budget`, `decision-record` — PROCESS.md §1's first hazard), and
staying out of it avoids a fourth union.

### D7 — What the row actually looks like, and what the amendment costs

The list at rest, seeded Engineering team, default lens:

```
before                                                          after
──────────────────────────────────────────────────────────      ──────────────────────────────────────────────────────────
 ▎ ◐ ENG-144  Apple Pay in the payment sheet                     ▎ ◐ ENG-144  Apple Pay in the payment sheet
        Done in git, not on the board  ●──●──●//◌  22h                  Done in git, not on the board  ●──●──●//◌  22h
 ▎ ◑ ENG-141  Address autocomplete on shipping step              ▎ ◑ ENG-141  Address autocomplete on shipping step
        Checks failing            GH   ●──■──○╌╌◌   4h                  Checks failing            GH   ●──■──○╌╌◌   4h
 ▎ ◑ ENG-139  Refund flow for partial orders                     ▎ ◑ ENG-139  Refund flow for partial orders
        In review — waiting 16h        ◍──●──○╌╌◌  16h                                                 ◍──●──○╌╌◌  16h
 ▎ ◑ ENG-137  Coupon stacking on the cart                        ▎ ◑ ENG-137  Coupon stacking on the cart
        Approved                       ◍──●──●╌╌◌   3h                                                 ◍──●──●╌╌◌   3h
 ▎ ○ ENG-132  Saved addresses in checkout                        ▎ ○ ENG-132  Saved addresses in checkout
        Draft open                     ○──●──◌╌╌◌   —                                                  ○──●──◌╌╌◌   —
 ▎ ● ENG-118  Persist cart across sessions                       ▎ ● ENG-118  Persist cart across sessions
        Built — not live yet      GH   ●──●──●╌╌◌   —                                                  ●──●──●╌╌◌   —
 ▎ ◔ ENG-101  Focus lost after closing the palette               ▎ ◔ ENG-101  Focus lost after closing the palette
        (blank)                        (no ink)     —                   (blank)                        (no ink)     —
                                                                 ^ the 178px slot is reserved on every row, drawn on two
```

The phrase slot keeps its measure. `packages/ui/src/components/issue-row.tsx:51` sets
`PHRASE_SLOT_WIDTH = 178` — *"wide enough for the longest entry in the shared dictionary's neutral
register"* — and the longest surviving entry is still `Done in git, not on the board`, so the
constant does not move. Collapsing the column when a page happens to have no exception row would
reflow every track the moment a check went red, which is the guarantee
`issue-list/spec.md:202-205` exists to make.

**What the amendment costs.** `ROADMAP.md:94` promises the row both draws its signal *"and says
it"*. After this change the row says it on two rows of seven above, and says it to a screen reader
on five. The commitment that survives is the one that was doing the work: **the row shows reality,
not intention** — the differentiator `DESIGN.md:62` states. The one that narrows is *always in
words*, and it narrows because `DESIGN.md:33-34` — the word diet and the ornament rule — are the
older commitments and they were being broken to keep it.

`Built — not live yet` is the phrase the commitment quotes and the phrase the complaint named, and
it is worth being precise about what has already happened to it. `front-door` (merged, PR #62)
changed the default lens to exclude the terminal statuses, and `computeDivergence`
(`packages/schema/src/zero/delivery.ts:247-249`) only reaches `merged_not_deployed` when the issue
**is** done or canceled — a merged PR under an unfinished issue classifies as
`diverged_behind_merge` first. **So the nine rows the scope observed are already behind the archive
lens.** This change does not deliver that relief; front-door did. What it delivers on the default
lens is the three keys that dominate live work — approved, draft, unreviewed — which is a smaller
claim than the scope's and the true one.

### D8 — Roadmap: the note goes quiet because the label was already wrong

`apps/web/src/projects/roadmap-view.tsx:644-649`:

```
function emptyNote(row) {
  if (row.total === 0) return { text: 'No issues yet', quiet: true }
  if (row.scheduledCount === 0) return { text: 'Nothing scheduled', quiet: false }
  if (row.marks.length === 0) return { text: 'Scheduled outside this window', quiet: true }
  return null
}
```

Three notes, and they are not three of a kind. `No issues yet` and `Nothing scheduled` are news —
nobody broke this project down; nobody scheduled its work — and `projects/spec.md:186-189` requires
the second by name (*"the first states that nothing of its is scheduled"*). `Scheduled outside this
window` is the drawing read aloud: the row's axis drew no issue mark, its meter drew a `done/total`,
and the window is simply narrower than the team's cycle history. It fires on every such project —
10 of 10 on the maintainer's walk (`SCOPE-legibility.md:153`) — and a note that fires on every row
carries no information, which is `DESIGN.md:34` again.

The row is a `<button aria-label={rowLabel(row)}>` (`:455`) whose drawing is `aria-hidden`
(`:499-503`, *"a control's children are presentational, so a label nested inside it is announced to
nobody"*), so the label is the only other channel — and it is currently **wrong**:

```
:658  function schedulePhrase(row) {
:665    if (perCycle.length > 0) return `scheduled ${…}`
:668    return row.total > 0 ? 'no issues scheduled in a cycle' : null
:671  }
```

A row reaches `:647` only by having `scheduledCount > 0`, and `:668` then tells a screen-reader user
`no issues scheduled in a cycle`. Two readers, two contradictory facts, and the one who cannot see
the drawing gets the false one. `projects/spec.md:157-160` already forbids it — *"A row that draws
no mark SHALL claim no schedule in that label rather than inventing one"* — and inventing the
**absence** of a schedule is the same offence.

```
before                                                    after
────────────────────────────────────────────────────      ────────────────────────────────────────────────────
 ◑ Checkout revamp    ▮▮▮▯▯ 3/5   │   ◆ 12 Sep             ◑ Checkout revamp    ▮▮▮▯▯ 3/5   │   ◆ 12 Sep
                                    Scheduled outside
                                    this window
 ◑ Search relevance   ▮▯▯▯▯ 1/6   │   ◆ 30 Sep             ◑ Search relevance   ▮▯▯▯▯ 1/6   │   ◆ 30 Sep
                                    Nothing scheduled                                         Nothing scheduled
 ○ Design tokens      (no meter)  │   ◆ 14 Oct             ○ Design tokens      (no meter)  │   ◆ 14 Oct
                                    No issues yet                                             No issues yet

 label: "…, 3 of 5 issues done,                            label: "…, 3 of 5 issues done,
         no issues scheduled in a cycle"   ← false                 scheduled outside the drawn window"
```

After this, the presence of a note on a roadmap row means unscheduled work. Its absence means the
work is scheduled, just not here — and the row's own name says so.

### D9 — Provenance: the mark rides drawn text, and one mark leaves the list

`restPhrase` (`phrases.ts:189-194`) already computes `source: text === null ? null : …`, and
`rest-phrase.tsx:29-36` draws the mark after the phrase text. A quiet phrase draws no text, so it
draws no mark — no code change and no contradiction with
`reality-vocabulary/spec.md:390-402` (*"A phrase **at rest** SHALL carry a provenance mark only
when…"*).

The consequence is real and belongs in the open: `merged_not_deployed` is one of the three sourced
keys (`phrases.ts:73-77`), so the GitHub mark stops appearing on list rows for it.
`checks_failing` and `diverged_done_ci_failing` speak in `news`, so the mark still appears wherever
a check fact is stated — which is where a reader most needs to know whose fact it is.
`apps/web/src/issues/issue-list.test.tsx:230-252` asserts exactly this pairing today and is
rewritten rather than deleted: the check phrase keeps its mark, and the deploy phrase now has no
text for one to follow.

**The spoken form names the fact, not the provider.** A provenance mark is a drawing
(`reality-vocabulary/spec.md:272-286`), and there is nothing drawn to attribute. Adding "from
GitHub" to an accessible name would be inventing a second provenance vocabulary in the change whose
thesis is that one fact should have one notation.

### D10 — What the tests must prove, and the three that must not move

Three kinds of assertion, and one property that is the whole change:

1. **The words are gone from the drawing and present in the tree.** For each quiet key, the row's
   phrase slot renders empty **and** the track's accessible name contains the register's exact
   words. Both halves in one test, because either alone is the failure mode.
2. **No row is quiet and inkless at once.** Over `REST_PHRASE_KEYS`, every key `news` resolves to
   quiet builds a strip whose `isQuietTrack` is false. This is the assertion the gate reduces to; if
   it ever fails, a row has gone silent in both channels.
3. **The quiet set is pairwise distinguishable.** Build the representative strip for each quiet or
   silent key and assert no two produce the same station sequence. Without D2 this fails on
   `pr_approved` versus `merged_not_deployed`, which is why it is written as a property rather than
   as a test of one pair.

Plus the shape property: over the six node kinds, no two are separated by colour alone — asserted
over the exported form descriptors, not over rendered pixels.

**Three suites are run unedited, as the proof that `neutral` did not move:**
`packages/ui/src/components/rest-phrase.test.tsx` (all four tests, every one calling
`restPhrase(…, 'neutral')`), `apps/web/src/issues/timeline-view.test.ts:167-198` (which reads
`deliveryView`'s default register and pins `In review — waiting`), and
`packages/schema/src/zero/team-home.test.ts:453` / `:502` (the personal register's strings). If this
change had drifted into editing `neutral` or `personal`, those are what would say so.

One assertion is **strengthened rather than updated**: `phrases.test.ts:53-58` currently reads

```
const silent = REST_PHRASE_KEYS.filter((key) => restPhrase(key, 'neutral').text === null)
expect(silent.sort()).toEqual(['deployed', 'in_backlog', 'in_progress', 'in_review', 'not_started'].sort())
```

It stays exactly as written for `neutral` — proving the register did not move — and gains a sibling
over `news` that pins the drawn, quiet and silent sets separately, so a key drifting from quiet to
silent (words lost entirely) fails rather than passing as "still not drawn".

## Risks / Trade-offs

- **A hue-blind reader now depends on the node forms.** That is why D4 is a requirement in this
  change rather than a follow-up. The residual risk is legibility of a dashed or half-filled mark at
  7px, which is a measurement the build takes at the dense row's real size — named in tasks.md as an
  eyeball, not approximated by an assertion.
- **`review_unreviewed` goes quiet while `review_returned` stays.** Two rows that look nearly alike
  will speak differently, and a reader may read that as inconsistency before they read it as
  meaning. The alternative — quieting both — loses a fact; the other alternative — keeping both —
  keeps the phrase on most in-flight rows and guts the change. Recorded as the judgement it is.
- **The board card's measure grows.** `CARD_TRACK_WIDTH` (`board-card.tsx:10`) goes from 86 to carry
  the 26px age column, on a card that is one sixth of the page's measure at 1440. `board/spec.md`
  promises all six columns readable at 1440 with no horizontal scrolling; the card's labels row is
  what yields, and the build measures it rather than assuming.
- **A future surface may adopt `news` without drawing a track.** Mitigated by writing the structural
  precondition as a requirement with its own scenario rather than as a note in this file.
- **The scope line's "list/digest" wording is not executed** (D6). If the maintainer meant the
  digest literally, this change is the place that says so out loud and the decision is one edit away.

## Migration Plan

Nothing to migrate. No schema, no data, no env, no container, no route, no stored value. One exported
union gains a member and one exported interface gains a field; every consumer is in this repo and is
listed in tasks.md.

## Open Questions

None blocking. Two judgements no assertion settles, both named as eyeballs in tasks.md: whether the
six node forms read as six at 7px on a dense row, and whether a list whose phrase column is drawn on
two rows of seven reads as **calm** or as **broken** — the second being the one the whole family is
ultimately judged on.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **A key speaks if it is an exception or if the drawing cannot carry it** (D1). Both admissions are
  in the spec; neither is a hand-list. `review_returned` survives on the second.
- **The change station stops conflating approved with merged** (D2), as the precondition for the
  silence rather than a cleanup beside it.
- **The words go to the accessible name of the drawing that carries the same facts**, and a drawn
  phrase is never repeated there (D3). The rule is about the **register's own words**, not about
  facts in general; the fact-level version is named and declined in D3.
- **Delivery's divergence peek is corrected rather than exempted** (D3). It is the one shipped
  surface that repeats a drawn phrase in its track's name, and a requirement whose violation already
  ships is worse than no requirement. Its register does not move.
- **The six node kinds become separable without hue; the vertical rail does not change** (D4),
  because its stations carry text.
- **`neutral` and `personal` are not edited** (D5, D6). The Cycles carried-in band and Home's YOURS
  band both keep every word they have today.
- **Home's YOURS is out of scope** (D6) — a deliberate departure from the scope line's
  "list/digest", with the reason recorded.
- **The GitHub mark leaves the list's deploy phrase** (D9), because a mark follows text and there is
  no text.
- **`ROADMAP.md` is not edited by this change** — parallel proposals in this family make it the
  guaranteed conflict, so the row and the §Differentiation amendment are taken once by whoever
  integrates (`SCOPE-legibility.md:190-192`). The amendment's wording is drafted in tasks.md so the
  integrator is not left to invent it.
- **No requirement this change restates is restated by any in-flight change.** Verified by
  `grep -rl "Requirement: <name>" openspec/changes/*/specs/` over all eight names this change restates
(board 1, projects 2, issue-list 2, reality-vocabulary 3), against
  `explanation-at-rest`, `front-door`, `destination-budget`, `decision-record`, and the two changes
  authored alongside this one — `config-wait` (`self-host-deploy`) and `delivery-legibility`
  (`delivery-metrics`), neither of which touches any of this change's four capabilities. Archive
  order is therefore unconstrained by this change; the family's existing order
  (`explanation-at-rest` → `destination-budget` → `decision-record`, `SCOPE-legibility.md:203-204`)
  is unaffected either way. **Re-run the grep before archiving** — `openspec validate --all` passes
  on a set of changes that destroy each other (PROCESS.md §1), and this family is being authored in
  parallel.

<!-- Build-time decisions are appended below this line, each with what was ambiguous, what was
     chosen, and why. -->

### The six forms, chosen at 7px rather than at the table

**Ambiguous:** D4 offers an assignment and says the measure at 7px on a dense row decides it. Two of
its six were not obviously safe at that size — a *half-filled* disc has roughly 3.5px of ink to
carry the distinction, and a *dashed* ring at 7px with a 1.4px stroke resolves to about three
dashes.

**Chosen:** D4's assignment as written, after rendering the six at their real measure with the Warm
light tokens and again at 14×. Both survived, and the reason each does is worth recording:

- The **half-filled disc** keeps a full ring in the same token, so the silhouette is still a 7px
  circle and the leading half is solid. That is a strong read — the background is clipped to the
  border box, so `open` draws as a solid semicircle joined to a thin arc, and it is neither `done`'s
  filled disc nor `rev-wait`'s hollow ring at any hue.
- The **dashed ring** has house precedent at almost this scale: `status-glyph.tsx`'s backlog ring is
  a dashed circle of radius 4.9 CSS px at a 14px glyph, and it reads. The dashes are also the dotted
  segment's own grammar, so the node and the connector leaving it say the same thing.

**Why it matters that the descriptor is a value.** `NODE_CLASS` is now *composed from*
`TRACK_NODE_DRAWING` — the form decides `rounded-full` versus `rounded-[1.5px]`, the stroke decides
`border-solid` versus `border-dashed` — with only the hue and the measure left per kind. So the
separability test is not a statement about a table nothing reads: a kind whose drawn form drifted
from its declared one would have to drift in the hue map, and `the drawn node classes are composed
from the declared forms` asserts the two sharpest cases against the rendered DOM.

**What was NOT verified:** the six at 7px in dark, in Focused and Editorial, and under a colour
filter — tasks 10.3 and 10.4. What was rendered was the Warm light token set in a standalone page,
not the running application. It is a proxy for the eyeball, not the eyeball.

### The two gates live in `packages/ui`, not in `phrases.test.ts`

**Ambiguous:** tasks 2.7 and 2.8 put both gates in `packages/schema/src/zero/phrases.test.ts`. They
cannot go there. Both are assertions *about the drawing* — `isQuietTrack` and the station sequence —
and `packages/schema` may not import `packages/ui` (CLAUDE.md constraint 3, enforced by
`scripts/check-boundaries.mjs`, which scans test files too).

**Chosen:** a new file, `packages/ui/src/components/quiet-register.test.ts`, importing the
dictionary from `@yapm/schema` — the direction the boundary allows. It carries one representative
row per key as *real predicates*, and asserts `classifyRestPhrase` over that table first, so a
fixture that stopped producing its key fails loudly rather than quietly testing a different row.
**Why:** the property is a seam between two packages, and it belongs in the one that can see both.
Restating `isQuietTrack` inside `packages/schema` to keep the file location would have created a
second copy of the predicate the design spends a paragraph insisting there is only one of.

Both were confirmed to fail without task 1.1: reverting `prNode` to main's mapping and re-running
gives `AssertionError: expected 'merged_not_deployed vs pr_approved: t…' to be '… f…'`. That is the
precondition doing its job rather than being asserted about itself.

### `quietWords` states rule 3.2 once, so three surfaces cannot each get it wrong

**Ambiguous:** D3's rule 2 — pass the register's words only where the register quieted them — is a
contract on the *caller*, and three call sites now have to honour it. Written inline it is
`view.phrase.text === null ? view.phrase.spoken : null` three times, and the shipped violation this
change fixes (`delivery-view.tsx:284`) is exactly what a caller getting it wrong looks like.

**Chosen:** `quietWords(phrase)` in `apps/web/src/issues/delivery.ts`, beside `deliveryView` and
`DIVERGENCE_LABEL`. **Why:** the rule is one sentence and it now has one implementation. A fourth
surface adopting `news` gets it right by calling it rather than by reading D3.

### The quiet phrase leads with a full stop, not a comma

`realityTrackLabel` joins its facts with `, `. Leading the register's sentence into that list with
the same separator would run *Built — not live yet* into *PR merged* as one clause. The label is
`${phrase}. ${facts}` instead: two statements, and a screen reader pauses at the boundary. The
spec's requirement is that the words *lead*, and the assertions are written as `startsWith`, so the
separator is a build decision rather than a spec one.

### `AGE_COLUMN_MEASURE` is exported, and the gutter is a constant the class cannot read

Task 4.5 says `CARD_TRACK_WIDTH` grows by `AGE_COLUMN_WIDTH + 6`. Writing `118` would have been a
magic number in a second package; importing the width alone would have left the `+ 6` unexplained.
`reality-track.tsx` now exports `AGE_COLUMN_MEASURE = AGE_COLUMN_WIDTH + AGE_COLUMN_GUTTER`, and
`board-card.tsx` reads `86 + AGE_COLUMN_MEASURE`. The gutter is still drawn by a static `ml-[6px]` —
Tailwind reads class strings, not constants — so the file carries a comment saying the two move
together. That is a constraint the code cannot express, which is the one kind of comment the working
agreement allows.

### `packages/schema/src/index.ts` needed no edit, and task 2.10 is ticked as verified

`PhraseRegister` and `RestPhrase` are re-exported by name (`:684-685`); widening the union and the
interface at the source widens what those names mean. The task is a check that the two widened names
are in the block, and they are. No value export was added — `Voicing` and `NEWS` are internal,
because the three states are reachable through `text` and `spoken` and a surface that read the
policy table directly would be re-deciding the register for itself.

### Looked at, and what looking could and could not reach

The dev stack on this machine runs the API and Vite but the eyeball tasks in §10 want a signed-in
session against seeded data at 1440×900 in three presets, light and dark, plus a screen reader and a
colour filter. What was actually done, and nothing more:

- **10.3, partly.** The six node kinds rendered at their real 7px and at 14×, in the Warm **light**
  token set, on `--bg`, in a standalone page. Six forms, six silhouettes. The five quiet and silent
  tracks were drawn beside each other at 7px and `pr_approved` reads as a different track from
  `merged_not_deployed` at a glance. Dark, Focused, Editorial: **not done**.
- **10.1, 10.2, 10.4, 10.5, 10.6, 10.7: not done.** Whether a phrase column drawn on two rows of
  seven reads as calm or as broken is the judgement the whole family is measured on, and it needs
  the running application. So does the board's six-column measure after the card's track grew by
  32px, and so does the roadmap with the note gone from ten of ten rows. They are left for the
  integrator's pass rather than ticked.
