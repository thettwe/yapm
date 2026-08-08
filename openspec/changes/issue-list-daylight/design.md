## Context

The northstar for this change is one file: `design-explorations/overhaul-2026-08/northstar/issues.html`
(render: `issues.png`). Its rulebook is `ia.html` (word diet, provenance, the peek and the
how) and `NORTHSTAR.md`'s consistency check.

What is already built and must be **used, not rebuilt**:

- **PR #32 — the drawn vocabulary** (`packages/ui/src/components/`): `reality-track.tsx`
  (stations, segments, the `//` break, `buildRealityShape`, `realityTrackLabel`,
  `formatReviewAge`, `REALITY_TRACK_WIDTH`), `status-glyph.tsx`, `priority-mark.tsx`,
  `provenance-mark.tsx`, `peek.tsx`, `how.tsx`, `drawn.tsx`. The list row already renders the
  track through `IssueRow`'s `realityTrack` slot.
- **PR #33 — the three-band frame** (`apps/web/src/frame/`): `AppFrame` owns bands 1 and 3;
  `Masthead` exposes `title` / `count` / `lens` / `meta` / `actions`; the Issues masthead
  already carries the `List | Board` lens (`issues-lens.tsx`); ⌘K is owned globally by
  `frame/command-registry.tsx` and surfaces *register* rather than bind a listener.

What is shipped and wrong for this change: the row has no phrase slot; the phrase dictionary
is private to `team-home.ts`; the toolbar is outline buttons + native selects; group headers
are close but not the mock's; there is no fold.

Constraints inherited and not negotiable here: three containers; all ZQL and mutators in
`packages/schema`; tokens only, AA in every theme, light and dark; keyboard-first; sub-100ms;
team-level metrics only; no TS-Compiler-API tooling.

## Goals / Non-Goals

**Goals**

- The rendered list is the mock, row for row and band for band.
- Exactly one phrase dictionary exists in the repo, consumed by both Home and the list.
- Every capability the shipped filter bar has today still works after it is re-registered.
- The fold states the true remaining count and is operable from the keyboard.
- 120+ rows stay cheap: one deployment-index pass, per-row work O(links).

**Non-Goals**

- Gallery (no backing entity — folds away, does not ship disabled).
- Any restructuring of the issue detail sheet (next change).
- New filter axes, sort keys, groupings, bulk-edit surfaces, or virtualization.
- Any new synced entity, query, mutator, migration or container.

## Decisions

### D1 — One dictionary, one classifier, two registers

The mock's list strings and Home's YOURS strings are **not identical**, and pretending they
are would be the wrong fix:

| Predicate | list (`neutral`) | Home YOURS (`personal`) |
|---|---|---|
| `status_behind_merge` | `Done in git, not on the board` | `Done in git — update the board` |
| CI failing | `Checks failing` | `Checks failing — the fix is yours` |
| merged, no deploy | `Built — not live yet` | `Merged — not live yet` |
| PR approved | `Approved` | `Approved — merge when ready` |

Both mocks are canonical (`issues.html` and `home-digest-2.html`), so the shared thing is the
**dictionary**, not one string set: one classifier over the real predicates producing a
`RestPhraseKey`, and two total register tables over that key set.

```
packages/schema/src/zero/phrases.ts
  export type RestPhraseKey =
    | 'diverged_behind_merge' | 'diverged_ahead_of_pr' | 'diverged_done_ci_failing'
    | 'checks_failing' | 'merged_not_deployed' | 'deployed'
    | 'pr_approved' | 'pr_draft'
    | 'review_unreviewed' | 'review_returned'
    | 'in_progress' | 'not_started' | 'in_backlog'
  export type PhraseRegister = 'neutral' | 'personal'
  export interface RestPhrase {
    readonly key: RestPhraseKey
    readonly text: string | null      // null = say nothing on this surface
    readonly urgent: boolean
    readonly source: 'github' | null  // provenance suffix, D3
  }
  export function classifyRestPhrase(status, signal, divergence): RestPhraseKey
  export function restPhrase(key, register, context?): RestPhrase
```

`team-home.ts`'s private `sayPhrase` is **deleted** and re-expressed as
`restPhrase(classifyRestPhrase(...), 'personal')`, with its four current strings reproduced
byte-for-byte so `team-home.test.ts` stays green unchanged. `gitLine` stays where it is: it is
a mono *derivation* line, not a phrase at rest, and only the detail register uses it.

A unit test asserts both registers are total over `RestPhraseKey` and that a key present in
one is present in the other — that is what makes a second vocabulary impossible to add
quietly. A source-level test asserts the four dictionary strings appear in exactly one file.

### D2 — Quiet means silent, and that is a register property

The mock's quiet rows are genuinely blank right of the title. So in the `neutral` register the
three "nothing has happened yet" keys (`in_progress`, `not_started`, `in_backlog`) and
`deployed` map to `text: null` and the row renders nothing. In the `personal` register they
map to real strings, because Home's YOURS is a *personal digest* where "In progress" is the
answer to a question the band asked. Same key set, different registers — which is exactly what
D1's structure is for.

`deployed` is `null` in the neutral register on purpose: the track's deployment station already
says it, and a phrase repeating a drawn fact is a word the diet does not pay for.

### D3 — Provenance rides on the dictionary entry, not on the caller

`RestPhrase.source` is `'github'` for exactly `checks_failing`, `diverged_done_ci_failing` and
`merged_not_deployed` — the check facts and the deploy fact, which are the only ones GitHub
sourced. `diverged_behind_merge` and the review keys carry `null`; the mock confirms it (line
316 has no mark, 291 and 329 do). Rendering is the shared `ProvenanceMark` at 12px, after the
text, `label={null}` because the phrase beside it does not name GitHub.

This is deliberately not a per-surface decision: a surface that wanted to add a mark would have
to change the dictionary, where the rule is written once.

### D4 — Review-age phrasing must not claim a reviewer waited

`reality-track.tsx` already records the shipped honesty rule: there is no review-requested
event, so `reviewAgeMs` may fall back to the PR's open time, and *nothing drawn from it may
claim a reviewer has been waiting*. The mock's `In review — waiting 16h` is therefore split by
`reviewAgeFrom`:

- `reviewAgeFrom === 'pr-open'` (nobody has reviewed yet) → **`In review — waiting {age}`**.
  The thing waiting is the pull request, which is true.
- `reviewAgeFrom === 'review'` (a review came back and did not approve) →
  **`In review — reviewed {age} ago`**. Saying "waiting" here would invert the fact.

`{age}` is `formatReviewAge`, the same formatter the track's age column uses, so the phrase and
the column can never disagree.

### D5 — The reserved phrase slot

`IssueRow` gains `phrase?: ReactNode`, rendered between the title's spring and the reality
track in a slot of fixed measure (`PHRASE_SLOT_WIDTH`, right-aligned, `flex-none`,
`whitespace-nowrap`, truncating). Reserved unconditionally, exactly as the track's empty state
already is: a row whose CI goes red must not shove its neighbours' tracks left. Below the
track's own breakpoint the slot folds with the track rather than wrapping — the row's height is
a rule.

`issues.html`'s own self-critique is the known cost: at 1280px a long title and a long phrase
fight for the same breath. The title truncates; the phrase does not. The phrase is the shorter
string and the one the reader came for.

### D6 — The filter bar is re-registered, not rebuilt

Every control keeps its behaviour, its state and — where a test or a screen reader depends on
it — its accessible name. What changes is the drawn register:

| Control | Today | After |
|---|---|---|
| filter glyph | absent | a drawn glyph, `aria-hidden` |
| 7 axes | `Button variant="outline"` + `ListFilterIcon` | plain text trigger, `text-text-2`, count suffix in accent mono. **`aria-label="Filter by <axis>"` preserved verbatim** — four e2e specs drive it |
| search | `Input` + `SearchIcon`, w-48 | quiet input, no icon, `aria-label="Search issues"` preserved |
| Group | native `<select aria-label="Group by">` | `Group **Status**` menu; **the `<select>` is kept as the control** (see D7) |
| Sort | native `<select aria-label="Sort by">` + chevron button | `Sort **Priority**` menu with the direction pair inside it |
| Saved views | `<select>` in masthead actions | quiet `Save view` text button + a saved-views menu |

The menus are the same Base UI `Menu` the filter axes already use, so keyboard behaviour
(open, arrow, Enter, Escape, focus return) is the one already proven in e2e.

### D7 — `Group by` stays a native `<select>`, restyled

`cycles.spec.ts:212` drives grouping with `selectOption('cycle')`. Rewriting it as a menu means
rewriting a passing keyboard assertion to prove the same thing a different way — churn with no
gain, on the exact control the mock renders as one word. Instead the `<select>` is styled to the
mock's register (transparent, no border, bold current value, `text-text-2`) with its
`aria-label="Group by"` intact. Sort's direction is the case that *cannot* stay a `<select>` —
it is a toggle — so it folds into the sort menu as an explicit `Ascending` / `Descending` pair
with the accessible names preserved.

### D8 — The fold: a bounded page, a true count, a real button

`VISIBLE_ROW_CAP = 50`. `ordered` remains the full filtered set (the masthead count, the
selection targets and the palette context are unchanged); a derived `visible = ordered.slice(0,
cap)` is what renders. The fold renders only when `ordered.length > cap`, as a real
`<button>` reading `↓ {ordered.length - cap} more` — the count is a subtraction over the true
filtered length, never a constant and never a guess.

Keyboard: the button is in the tab order after the last row; `j`/`ArrowDown` on the last visible
row moves focus to it; Enter or Space raises the cap by one page and focus lands on the first
newly revealed row. Collapsing is not offered — a list that re-hides rows under the cursor is a
worse lie than a long list.

Chosen over virtualization on purpose: virtualization is a rendering optimisation that would
hide nothing and say nothing, and the mock's `↓ 109 more` is a *statement*, not a scroll
optimisation. 50 rows of already-synced data render inside the interaction budget with room.

### D9 — Word diet: three strings become labels

`issues.html` carries zero sentences (196 visible words for 120 issues). The three sentences
this page renders today are replaced by labels: `No issues match the current filters.` →
`No matches`; `Loading team…` → `Loading…`; `This team no longer exists.` → `Team not found`.
Each keeps its `role="status"`. Nothing else on the surface may be a sentence — the phrases at
rest are dictionary entries, and the track's `aria-label` is not visible text.

### D10 — Masthead title becomes `Issues`

The mock's masthead reads `Issues 120`; the deck one band above already reads
`Acme / Engineering`. `<team> · Issues` repeats the team in adjacent bands, and Board's masthead
(shipped in PR #33) already reads `Issues`. The two Issues lenses agreeing is worth the one e2e
selector update in `issues.spec.ts:49`. The status glyph currently prefixed to the title goes
with it — the mock's masthead carries no glyph.

## Risks / Trade-offs

- **The dictionary refactor touches Home.** Mitigated by reproducing the four `personal`
  strings byte-for-byte and leaving `team-home.test.ts` unedited: if the extraction changed a
  rendered string, that suite goes red without anyone having to notice.
- **Adding `merged_not_deployed` to the classifier changes precedence.** Placed after
  `checks_failing` and before `pr_approved`. In YOURS it is unreachable (an unfinished issue
  with a merged PR fires `status_behind_merge` first, and YOURS lists only unfinished issues),
  so Home's output is provably unchanged — asserted by a unit case rather than by reasoning.
- **The cap can hide a row a member just created.** Creation sorts by priority-then-recency
  within the focused group, so a new row is near the top; and the fold states exactly how many
  are hidden. Accepted, and the e2e fixtures are far under 50.
- **Row cost at 120 rows.** The phrase is derived from the *same* `deliveryView` result the
  track already computes for that row — one `computeDeliverySignal` per row, not two — and the
  deployment index stays a single pass. No new query, so nothing new syncs.
- **Contrast.** The urgent phrase ink on `--bg-selected` / `--accent-soft` is a pair no theme
  block has been checked against; `contrast.test.ts` gains it in all six blocks. Precedent
  (`app-frame` DI-2) says: if a pair fails AA, the ink changes and the mock loses, not the user.

## Migration Plan

Nothing to migrate. No schema, no data, no env, no container. The change is additive within
`packages/schema` (a new module + a re-export), additive on `IssueRow` (an optional prop), and a
re-registering inside `issue-list.tsx`.

## Open Questions

None blocking. The one judgement no test can settle is whether the rebuilt surface reads as
Linear-grade against `issues.png` — that is a human comparison of the rendered page to the mock,
and it is named as such rather than approximated by an assertion.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no new named queries, no mutators, no migration.** Everything derives from
  `issues.byTeam` (which already pulls the linked-delivery subtree) plus `deployments.byTeam`,
  indexed once through `buildDeploymentIndex` exactly as the list does today.
- **Gallery is deferred** — no design-artifact entity backs it. It folds away; it does not
  ship disabled.
- **The `?open=<issueId>` detail sheet keeps working unchanged.** The issue detail page is the
  next change; nothing here restructures it.
- **Every keyboard behaviour survives:** `j`/`k` and arrows move, `x` selects, Enter/`→` opens,
  `c` creates, `s`/`a`/`l`/`p` open their palettes, Space toggles selection, and the row is
  fully operable without a pointer. ⌘K is owned globally by the frame — this surface
  *registers* commands and binds no listener of its own.
- **Sub-100ms:** everything renders from already-synced Zero rows; no interaction newly waits
  on the network. Per-row work stays cheap and the deployment index stays one pass.
- **Accessibility:** the track keeps its truthful `role="img"` label, the phrase is real text
  (never an icon-only signal), and theme contrast holds in every theme block via
  `packages/ui/src/styles/contrast.test.ts`.
- **No e2e spec is added** (PROCESS.md §3: this change touches one of the four big-feature
  axes — signature UI). Existing specs are *updated* where the row vocabulary moved, and no
  assertion is weakened to make a gate pass.
- **Two hard-won CI lessons carried forward:** no test hard-codes a magic budget that encodes
  fixture size (e2e fixtures accumulate across specs — derive bounds from the page), and no
  test's premise is "this environment lacks X" (CI is Node 24, dev machines may be Node 26 —
  stub the environment explicitly).

Taken during the build:

- **DI-1 — the key set gained `in_review`, and `diverged_ahead_of_pr` sits BELOW `pr_draft`.**
  D1's sketch had no plain in-review key, but an issue whose status is `in_review` with a null
  signal reaches no other branch, and totality is the property the whole structure rests on. The
  ordering matters more: `sayPhrase` used to resolve a draft PR under an in-review issue to
  `Draft open — not in review yet`, and `computeDivergence` returns `status_ahead_of_pr` for that
  case. Classifying divergence first would therefore have replaced one of Home's rendered strings
  — a byte change in YOURS. The draft branch runs first because a draft PR is the more specific
  fact about the same disagreement.

  Corrected after review: `computeDivergence` also names `status_ahead_of_pr` for the PR-**less**
  in-review case, and DI-1's first draft claimed both halves reach the classifier. They do not.
  `assembleLinkedEntities` derives CI runs only from a linked pull request, so
  `computeDeliverySignal` returns `null` when there is no PR — and a null signal yields no
  divergence at all. A PR-less in-review row therefore classifies as `in_review`, which the
  neutral register leaves **silent**. `diverged_ahead_of_pr` is consequently unreachable through
  `sayRestPhrase` today: it is kept as an explicitly-marked totality placeholder (commented as
  such in `phrases.ts`), and the docs table no longer promises its string, because a phrase no
  code path can render is a documented lie. It becomes reachable the day CI runs are sourced
  independently of a pull request.

- **DI-2 — the mock's accent-inked selected key could not ship.** `issues.html` draws the
  selected row's mono key in `--accent-strong`. On `--bg-selected` that measures **4.38** in one
  preset and **3.84** in another — under AA for normal text. Following `app-frame` DI-2's
  precedent, the ink steps up to `--text-1` and the rail plus the tinted ground carry the
  selection state. `contrast.test.ts` keeps the measurement as a >=3.0 bound with the reason
  written beside it, so a later token edit that fixes the pair does not fail the file and a
  later change reaching for the accent finds the number rather than re-deriving it.

- **DI-3 — `formatReviewAge` moved from `packages/ui` down into `packages/schema`.** D4 requires
  the phrase and the track's age column to read the same formatter, and the phrase is built in
  `packages/schema`, which cannot import UI. `reality-track.tsx` re-exports it, so every existing
  importer is unchanged.

- **DI-4 — the source-level guard matches whole entries, and it found a real second copy on its
  first run.** `apps/web/src/routes/showcase.tsx` had hard-coded `Done in git, not on the board`
  and `Built — not live yet` in its peek demo; both now resolve through `restPhrase`. The guard's
  first draft also matched `Checks failing on 3 issues` — the attention band counting a class, not
  the dictionary speaking — so it asserts complete entries rather than fragments.

- **DI-5 — the search field stays, off-mock.** `issues.html` draws no search input; ⌘K carries
  search in band 1. Cutting the field would cut a capability the spec forbids losing, so it stays
  in the bar at the mock's register — borderless, iconless, 128px — placed after the seven axes so
  the plain-text run from the filter mark reads uninterrupted.

- **DI-6 — the phrase slot folds below `lg`, it does not wrap.** `issues.html`'s own
  self-critique names the 1280px collision between a long title and a long phrase. The row's
  height is a rule, so below the breakpoint the phrase folds away exactly as the label column
  already does, rather than wrapping the row onto two lines.

- **DI-7 — the fold re-closes on a new query, not on a new result.** Raising the cap is a
  statement about the result the member is looking at. It resets when the filter, grouping, sort
  or the cycle/project selections change; a row arriving over sync does not collapse a page they
  opened.

- **DI-8 — `IssueGroup` gained an optional `color`.** The spec asks for a label dot on
  label-grouped headers and the group model carried no colour. One optional field, populated in
  the label branch of `groupBy`.

- **DI-9 — the e2e heading assertion moved rather than weakened.** `issues.spec.ts` asserted
  `<team> · Issues`; it now asserts the masthead reads `Issues` **and** that the deck states the
  team name. What the old selector proved — that the reader can see which team they are on — is
  still asserted, one band up, where D10 moved it.

- **DI-10 — the rendered page against `issues.png`, and the two places it differs.** Captured at
  1440x900 over a seeded team carrying the mock's four phrase cases plus quiet rows. Row anatomy,
  slot order, the phrase column, the `//` break, the GitHub suffix on the check phrase, the group
  band and the `Group X · Sort Y` trailing edge all read as the mock draws them; the selected row
  measures `#f6e6da` ground and a full-height accent rail, exactly `--bg-selected` and `--accent`.
  Two deliberate differences:

  1. **The `Group by` control keeps a chevron.** The mock draws `Group **Status**` as bare text.
     Per D7 the control stays a native `<select>`, and stripping its only affordance would leave
     a control nothing announces as operable. The chevron stays, quiet, at `--text-3`.
  2. **A focused-and-selected row shows the focus ring over the rail.** The mock draws ENG-116
     selected but not focused, so it has no ring to reconcile. Both states are correct
     separately; the ring wins where they overlap, because focus is the more urgent fact.

- **DI-11 — the list's component assertions live in one file, not two.** The plan named a separate
  `issue-list.phrases.test.tsx` for the phrase assertions. They sit in `issue-list.test.tsx`
  instead, alongside the fold, the re-registered bar and the keyboard model, because all of them
  mount the same `IssueList` over the same Zero harness and splitting the mount across two files
  would duplicate ~120 lines of mocking for no added coverage. Every assertion the plan named is
  present: the mock's four phrase strings, the empty slot on a quiet row, and
  `[data-slot="provenance-mark"][data-provider="github"]` on exactly the check and deploy phrases.

- **DI-12 — the seven-axis sweep is a component test; the six sort keys are a unit test.** Task 6.6
  asks one test to prove "every axis toggles its predicate, every sort key sorts". Those two halves
  want different tiers. The axes are proven in `issue-list.test.tsx` over a fixture where **Alpha
  carries a value on every axis and Beta on none**, so a toggle on any axis has exactly one right
  answer and an axis wired to the wrong predicate leaves both rows or neither — that has to be a
  component test, because what is under test is the control's wiring, not `matchesFilter`, which
  `packages/schema/src/zero/filter.test.ts` already covers. The sort keys are proven in
  `model.test.ts` instead: driving six keys × two directions through the menu would be twelve
  mounts to re-test a pure comparator, so `buildGroups` is called directly over a fixture whose six
  ascending orders are **six distinct permutations** — which is what makes a comparator case that
  fell through to the default (`updated`) fail rather than accidentally agree. The menu itself is
  still asserted in the component test: all six keys offered, both directions named, and the
  direction toggle actually reversing the rendered order.
  One incidental fact worth writing down: a `Status` or `Priority` option's accessible name is the
  drawn mark's `role="img"` label **concatenated with** the option text and no separator
  (`"TodoTodo"`), so those two queries anchor on the tail rather than matching the whole string.
