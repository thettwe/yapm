# one-reality-vocabulary — design

## Context

### The two vocabularies, verified

**(a) The icon strip** — `packages/ui/src/components/issue-row.tsx`:

- `REALITY_STRIP_WIDTH = 'w-[86px]'`, a fixed four-slot span.
- `PR_GLYPH: Record<PrGlyphState, {icon: LucideIcon; label; tone}>` — five lucide git icons
  (`GitPullRequestDraftIcon`, `GitPullRequestIcon`, `GitPullRequestArrowIcon`, `GitMergeIcon`,
  `GitPullRequestClosedIcon`).
- `CI_GLYPH: Record<CiHealthState, …>` — `CheckIcon` / `XIcon` / `LoaderIcon`.
- `RocketIcon` on `--signal-sync` for deployed; `formatReviewAge(ms)` as a mono suffix.
- `DivergenceFlag` — a `TriangleAlertIcon` on `--status-urgent`.
- `RealityStripPlaceholder` — four hollow dots at the same reserved width.
- Props: `RealityStripProps { pr, ci, reviewAgeMs, deployedAt }`.

Consumers: `apps/web/src/issues/issue-list.tsx:546,548`;
`apps/web/src/issues/issue-detail.tsx:786,796,799`; `packages/ui/src/components/board-card.tsx:108`
(placeholder); `apps/web/src/routes/showcase.tsx:133`;
`packages/ui/src/components/issue-row.{stories,test}.tsx`.

**(b) The track** — `apps/web/src/home/drawn.tsx`:

- `w-[118px]`, four stations (PR, CI, review, deploy).
- Private: `type TrackNode = 'done'|'open'|'rev-wait'|'fail'|'empty'|'empty-urgent'`,
  `type TrackSegment = 'solid'|'review'|'dotted'`, `interface TrackShape`, `trackShape()`,
  `segmentBefore()`, `NODE_CLASS`, `SEGMENT_CLASS`.
- `RealityTrackProps { strip: TeamHomeStrip | null; broken?: boolean; label; className }` —
  `broken` short-circuits the whole shape to a hardcoded
  `{ nodes: ['done','done','done','empty-urgent'], breakBefore: 3 }`.

Consumers: `apps/web/src/home/team-home.tsx:432` (broken form on the divergence attention row),
`:772` (the YOURS row).

**The duplication that proves the split**: `RealityStripProps` (ui) and `TeamHomeStrip`
(`packages/schema/src/zero/team-home.ts:135`) are field-for-field identical and independently
declared. `CI_GLYPH` (`issue-row.tsx:92`) and `CI_HEALTH_GLYPH` (`issue-detail.tsx:744`) are
identical maps with identical semantics and identical WCAG-1.4.1 comments above them.

### The northstar's ruling

Four mocks draw reality; none draws an icon strip.

- `issues.html` §`.track` — `width:188px`, `.tn` nodes 7px (`.rev-wait` 8px with a 1.6px ring,
  `.fail` a 1.5px-radius square), `.tseg` 2px segments (`solid`/`review`/`dotted` as a 3px/3px
  repeating gradient at 1.5px), `.tbreak` = `//` in mono on `--status-urgent`, and a mono `.t-age`
  in a 26px right-aligned column beside it.
- `issue.html` §`.metro` — the **vertical rail**: `.stop` blocks with a 2px vertical connector,
  a 13px `.node` per station, a 13.5px semibold `.say` line and a mono 11px `.git` fact line, and
  `.break-mark` = `//` drawn over a dashed vertical connector. Six stations, not four
  (idea → designed → change opened → reviewed → merged → live). Today's `RealityTrack` cannot draw
  a single one of these.
- `delivery.html` — the same node grammar inside the one open peek.
- `home-digest-2.html` — the same track on attention rows and YOURS rows.

`issues.html` `<defs>` is the geometry reference for the arcs and ticks: `viewBox="0 0 20 20"`,
`stroke-width="1.6"`, `stroke-linecap="round"`; `g-backlog` a dashed ring, `g-todo` an open ring,
`g-progress` a half arc over a `.28`-opacity ring, `g-review` a three-quarter arc over the same
ring, `g-done` a filled `r=7.6` disc. Priority ticks live on a 14-grid: `p-1`/`p-2`/`p-3` are three
tick positions with the unfilled ones at `.35` opacity, `p-urgent` is one standing tick plus a dot.

`ia.html` §"Two patterns, drawn once" and §"Provenance" are the rulebook for the peek, the how and
the brand mark. Both sections are quoted verbatim in the spec deltas.

## Goals / Non-Goals

**Goals**

1. One track implementation that composes into three shapes: dense-row horizontal, wide-row
   horizontal, and the detail's vertical labelled rail.
2. One shared strip/shape type replacing `RealityStripProps` vs `TeamHomeStrip`.
3. Arcs and ticks reconciled to the mock geometry in place.
4. One shared drawn-primitive module; `apps/web/src/home/drawn.tsx` ceases to be a second home.
5. The peek, the how and the provenance mark, each drawn once, each keyboard-operable and
   screen-reader honest.
6. Every existing consumer migrated with its **layout unchanged**.

**Non-Goals**

- Any page rebuild. Issues list, issue detail and delivery are the next three changes.
- Any new fact, table, query, mutator, migration, container or dependency.
- Any change to divergence kinds or their sentences.
- Any new provider.

## Decisions

### D1 — The track's model: stations are data, not a hardcoded array

`trackShape()` today takes `(strip, broken)` and returns four nodes; `broken` throws the strip away
entirely. The generalized model:

```
type TrackNodeKind   = 'done' | 'open' | 'rev-wait' | 'fail' | 'empty' | 'empty-urgent'
type TrackSegmentKind = 'solid' | 'review' | 'dotted' | 'broken'
interface TrackStation { readonly id: string; readonly node: TrackNodeKind
                         readonly label?: string; readonly fact?: string }
interface TrackShape   { readonly stations: readonly TrackStation[]
                         readonly segments: readonly TrackSegmentKind[] }   // length = stations-1
```

`segments[i]` is the connector **between** station `i` and `i+1`, so the `//` break stops being a
special index (`breakBefore`) and becomes a segment kind. That is the single change that lets the
break appear anywhere in a rail of six stations as easily as in a track of four.

`buildRealityShape(strip, options)` is the exported builder over the four synced facts. Divergence
is passed in as the existing `DivergenceKind | null` rather than a boolean `broken`, so the break's
position is **derived from which divergence fired** rather than hardcoded:

- `status_behind_merge` — PR merged, board behind: break on the last segment (reality ran ahead).
- `done_but_ci_failing` — break on the CI segment (the board claims done past a red check).
- `status_ahead_of_pr` — break on the first segment (the board ran ahead of git).

This is the one place the change makes a judgement the old code did not: `broken` drew one shape
for all three kinds. Deriving the position from the kind costs nothing and is strictly more honest.

### D2 — Orientation is a prop; the vertical rail is the same component

`<RealityTrack orientation="horizontal" | "vertical">`. Horizontal keeps the flex row of
node/segment spans and takes `width` (the row's 118px, the mock's 188px) as a token-free layout
prop. Vertical renders the `issue.html` metro: each station a block with a left-gutter node, a 2px
connector drawn as the block's `::before`-equivalent span, an optional `label` line and an optional
`fact` mono line. Same `TrackShape`, same node/segment class maps, same `//` mark — only the axis
and the per-station text differ. The `broken` segment in vertical form is the dashed vertical
gradient plus the `//` glyph, exactly as `issue.html` draws it.

### D3 — One strip type, owned by `packages/schema`

`RealityStripProps` is deleted from `packages/ui`. `TeamHomeStrip` is renamed to the neutral
`DeliveryStrip` and exported from `packages/schema` as the one shape; `TeamHomeStrip` remains as a
deprecated type alias only if something outside this change still needs it (nothing does — it is
removed). `packages/ui` already depends on `@yapm/schema`, so importing the *type* costs nothing;
but the track component keeps taking a plain structural props object so `issue-row.tsx`'s
deliberate schema-freedom (its own comment: "mirrored from the schema delivery seam as plain string
unions so this design-system primitive stays free of a schema dependency") is preserved. The union
members (`PrState`, `CiHealth`) stay mirrored string unions in the UI package; a unit test asserts
the two unions are assignable both ways so a schema-side addition cannot silently diverge.

### D4 — Where the shared module lives: `packages/ui`

`drawn.tsx`'s primitives are pure drawings over plain props. `DayBand` takes
`readonly DayBandSegment[]`, `ScopeBand` takes `readonly ('landed'|'open'|'added')[]`, `TickBar`
takes `readonly boolean[]`, `TriageDots` takes a number. None touches a Zero query or an app route.
`CadenceChart` is checked the same way; if it reads a schema type it takes the plain structural
shape instead. So they go to `packages/ui/src/components/`, following `issue-row.tsx`'s precedent
(schema-free by construction), not to a shared app module.

`DayBandSegment` is currently a schema type. The UI component takes the structural
`'past'|'today'|'future'` union; the same assignability test as D3 guards it.

`apps/web/src/home/drawn.tsx` is **deleted**, not left as a re-export shim: a shim is a second name
for the same thing and the whole point of this change is that there is one.

### D5 — Arcs and ticks: reconcile, do not add

`status-glyph.tsx` today draws on a 14-grid with `strokeWidth="1.5"`, a `Pie` built from a
`strokeDasharray` on a fat `r=3` stroke, `in-progress` at `0.4` and `in-review` at `0.7`, and
`done` as a filled disc **with a check mark** inside it. The mock draws on the 20-grid with 1.6px
round-capped **arc paths** (`M10 3 A7 7 0 0 1 10 17` for the half, `M10 3 A7 7 0 1 1 3 10` for the
three-quarter) over a `.28`-opacity ring, and `done` as a plain filled disc, no check. The
component is rewritten to the mock geometry, keeping its exported API (`StatusKind`, `STATUS`,
the `role="img"` + `<title>` labelling) byte-identical so no consumer changes.

`canceled` has no mock symbol — the northstar's status set is five, the product's is six. It keeps
its current X-in-ring drawing, redrawn on the 20-grid at 1.6px round caps so it belongs to the same
family. Recorded as a decision because the mock cannot rule on it.

`priority-mark.tsx` today draws three filled `<rect>` bars and, for urgent, a rounded-square
exclamation badge. The mock draws round-capped **tick strokes** with unfilled ticks at `.35`
opacity, and urgent as one standing tick plus a dot — not a badge. Rewritten to the mock geometry,
API unchanged. `no-priority` (not in the mock, which starts at `p-1`) renders all three ticks at
`.35` — the weight-zero reading of the same drawing.

### D6 — The peek: one open per page, enforced in state

A `PeekProvider` context owns `openPeekId: string | null`. `usePeek(id)` returns
`{ open, openPeek, closePeek, triggerProps, peekProps }`. Opening peek B sets the id to B, which
closes A by construction — a second peek cannot be open, because the state cannot hold two values.
That is the enforcement the brief asks for, and it is not a convention.

Trigger: `onPointerEnter` / `onFocus` open; `onPointerLeave` / `onBlur` close, with the standard
hover-intent guard so moving the pointer from trigger into the panel does not close it. Keyboard:
`Enter` navigates to the thing (the trigger is the link/button, so this is its native activation),
`Escape` closes and returns focus to the trigger. The panel is `role="dialog"` with
`aria-modal={false}` and an `aria-label` naming the thing; the trigger carries `aria-expanded` and
`aria-describedby`. It is **not** a focus trap: `ia.html`'s contract is "⏎ goes; esc stays", which
means the page keeps its focus order.

Elevation is permitted here and only here: `--bg-elevated` plus the mock's
`box-shadow: 0 10px 26px rgba(43,38,32,.14)`, expressed as a token so the dark themes are not
handed a light-theme shadow.

The dotted affordance is `ia.html`'s `.door`: `border-bottom: 1px dotted var(--border-strong)`,
accent-colored when hot. Shipped as a `Door` wrapper so "anything dotted opens something" is a
component rule rather than a class convention.

### D7 — The how: a footnote that folds

`<How label="OPEN TO MERGED">…derivation…</How>` renders, at rest, only the mono `how ·` on
`--text-3`. Activation (click or `Enter`/`Space` on the focusable trigger) opens a small panel
carrying the mock's structure: a mono uppercase kicker, the derivation sentence, and an optional
mono constraint line. `Escape` closes and restores focus. The trigger is a real `<button>` with
`aria-expanded`; the panel is `aria-labelledby` the kicker. The how is deliberately **not** a peek:
it is click-to-open, not hover-to-open, because a derivation is read, not glanced at, and because a
hover-opened derivation over a dense metric row would fire constantly. Recorded as a decision —
`ia.html` draws them side by side and does not say whether they share a trigger model.

The number itself keeps the `Door` dotted underline (the mock's `.num .door`), so the pattern the
eye learns — dotted means openable — holds for both.

### D8 — The provenance mark

```
<ProvenanceMark provider="github" | "figma" />
```

Renders inline-SVG at 12–14px in `currentColor` inside a `text-text-3` wrapper, `aria-hidden` when
the adjacent text already names the source and labelled otherwise. The component enforces the rule
structurally: no `color` prop, no `size` prop beyond the 12/13/14 triple, and it is a
`<span class="inline-flex align-…">` placed by the caller **after** the fact — a lint-visible shape,
not a comment. A `provider` union of `'github' | 'figma'` with a record of path data is how a second
provider stays additive. Uploads pass no mark at all — there is no `provider="upload"` member, so
the type system says the rule.

### D9 — What the track may show, and what it may never say

Exactly four facts, all already synced and already derived by `computeDeliverySignal`:

| Fact | Source | Limit respected |
|---|---|---|
| PR state | `pull_request.state` + synthesized `approved` from the newest review | — |
| CI health | `ci_check.conclusion` via `ciHealthFromConclusion` | `ci_check` has **no** start/finish time — only `updatedAt`. "red for 41m" is computable; "checks took 4m" is not, and is never drawn. |
| Review age | newest review's `submittedAt`, else PR `openedAt` | There is **no** review-requested event. "waiting on a reviewer since X" is indistinguishable from "PR open since X", so no station or fact line says "waiting on a reviewer". |
| Deployed | `repo + mergeCommitSha == deployment.sha`, earliest successful `deployedAt` | No `headSha` fallback; no environment claimed. |

No fifth axis is added, and no station may be drawn from a fact not in this table.

### D10 — Migration of current consumers is a swap, not a rebuild

- `issue-list.tsx:546` — `realityStrip={<RealityStrip …/>}` becomes
  `realityTrack={<RealityTrack …/>}`; `divergenceFlag` is dropped from the row entirely (the break
  carries it, and the sentence is already available to the row's title column for the next change).
  Column widths are re-reserved once, at the track's width, so alignment still cannot shift.
- `issue-detail.tsx` `DeliveryDetail` — the strip is replaced by the horizontal track; the PR list,
  deploy list and review lines below it are untouched except that `CiHealthMark`/`CI_HEALTH_GLYPH`
  are deleted and the CI fact is expressed through the shared vocabulary. The vertical rail is
  **built and exercised in stories**, but the detail page keeps its `DetailField` layout — the
  issue-detail rebuild that follows is what places it.
- `board-card.tsx:108` — the placeholder becomes the track's empty shape at the card's width.
- `showcase.tsx:133` — renders the new vocabulary; the divergence triangle row is replaced by a
  broken-track row.

### D11 — Accessibility and contrast

The track keeps `role="img"` + a truthful `aria-label` — the existing `RealityStrip` label
composition ("PR merged, CI passing, Deployed, reviewed 3d ago") is the precedent and is preserved,
extended with the divergence sentence when the break is drawn. In the vertical rail the per-station
`label`/`fact` lines are real text, so the rail is `role="list"` with `role="listitem"` stations
rather than one opaque image — a rail that reads its stations aloud is strictly better than one that
summarizes them.

`packages/ui/src/styles/contrast.test.ts` is extended: every node color and the `//` break ink are
asserted against the surfaces they sit on (`--bg`, `--bg-hover`, `--accent-soft`, `--urgent-soft`)
in **all six** theme blocks, at the 3:1 non-text bar for the drawn nodes and the 4.5:1 text bar for
the `//` mark and any mono fact line — the split PR #31 already established with
`--status-urgent-ink`.

### D12 — Speed and keyboard

Nothing here reads the network. The track is a pure function of already-synced rows; the peek and
the how render from props already in memory. The peek and the how are the only new interactive
surfaces and both are fully operable and escapable from the keyboard.

## Risks / Trade-offs

- **The e2e selector churn is real.** `connectors.spec.ts` asserts `[data-slot="reality-strip"]` in
  four places, including the three-preset light/dark loop. The slot is renamed, not removed, and
  every assertion is rewritten to assert the same fact about the same row. If any assertion cannot
  be preserved verbatim in meaning, that is a signal the vocabulary lost a fact — and the fix is the
  vocabulary, not the test.
- **Rewriting `status-glyph`/`priority-mark` geometry changes pixels on surfaces this change does
  not otherwise touch** (board cards, search results, the palette). The API is unchanged, so nothing
  breaks; but every surface's glyphs shift shape at once. That is the point — a third set would be
  worse — and it is why the reconcile is in this change and not smeared across the three page
  rebuilds.
- **`done` loses its check mark.** The mock's `g-done` is a plain filled disc. A filled disc alone
  distinguishes done from in-review by *fill*, not by hue, so 1.4.1 still holds; but a reviewer may
  read the loss as a regression. Recorded rather than quietly taken.
- **The peek is new interaction surface in a change whose job is vocabulary.** It is here because
  the three page rebuilds all need it and each would otherwise build its own, which is the exact
  failure this change exists to end.

## Decisions made during implementation

Pre-seeded scoping decisions (settled at proposal time; revise only with evidence):

- **No new tables, no new named queries, no mutators, no migration.** This is presentation over
  facts that already sync.
- **The facts the track may show are exactly the four in §D9 and no others**, with the two honest
  limits stated there never papered over.
- **Divergence keeps its three kinds and their existing sentences**; only the drawing changes — the
  `//` break, never a warning triangle.
- **Keyboard-first and sub-100ms hold**: no interaction newly waits on the network.
- **Accessibility is part of done**: the track is `role="img"` with a truthful label (or a
  `role="list"` rail), the peek and the how are focus-reachable and escapable, and theme contrast is
  asserted in every theme block.
- **The track wins over the icon strip**, on the evidence of all four northstar mocks; the icon
  strip, the lucide git glyph set and the `DivergenceFlag` triangle are deleted rather than
  deprecated.

### Recorded while building groups 2–5

- **`DeliveryStrip` lives in `packages/schema/src/zero/delivery.ts`, not in `team-home.ts`.** The
  shape is the delivery seam's, not the home page's; `TeamHomeStrip` was deleted outright and
  `team-home.ts` now imports the neutral name. `packages/schema/src/index.ts` exports it beside
  `DeliverySignal`.
- **The CI segment is index 1 — the segment *leaving* the checks station.** `done_but_ci_failing`
  means the board claimed done past a red check, so the break belongs after the check, not before
  it. That also gives the three kinds three distinct indices on a four-station track (0, 1, 2),
  which is what makes the builder's honesty testable.
- **The station after a break is promoted from `empty` to `empty-urgent`.** It is the station
  reality has not reached; the urgent ring makes the break read as a stop rather than a gap. This
  reproduces the old hardcoded broken shape exactly for `status_behind_merge` without hardcoding
  anything.
- **Team home's divergence-attention row passes a strip, not a boolean.** The class summarises N
  issues and has no single strip, so it passes the shape those issues share — merged, green,
  nothing live carrying it — and the divergence kind. The rendered result is byte-for-byte the old
  `['done','done','done','empty-urgent']` with the break before the last node, so the page is
  unchanged.
- **The YOURS row now breaks for all three divergence kinds, not only `status_behind_merge`.**
  The old call site passed `broken={row.divergence === 'status_behind_merge'}` because the boolean
  could only draw one shape. With the position derived from the kind, suppressing the other two
  would be hiding a fact the row already carries in its phrase. This is the one intentional visual
  difference on team home.
- **`formatReviewAge` moved from `issue-row.tsx` to `reality-track.tsx`** — one implementation, one
  name, no re-export shim. Its two callers (`inbox-view.tsx`, `issue-detail.tsx`) import from the
  new home.
- **`CiHealthMark` is replaced by `TrackNodeMark` + `ciNodeKind` + `ciPhrase`.** The issue detail's
  per-PR CI fact is now drawn in the track's own node vocabulary: filled disc / square / hollow
  ring, three distinct SHAPES, so 1.4.1 still holds without a second glyph family.
- **The issue-detail header's divergence flag became the `//` mark**, `role="img"` with the same
  `DIVERGENCE_LABEL` sentence, so the header keeps the fact and loses the triangle. Inside
  `DeliveryDetail` the sentence is visible text beside the track, so the track's label deliberately
  omits it there — a screen reader announces the divergence once, not twice.
- **The board card places the same shape at 86px**, its own measure, rather than the list row's
  118px: composable width, one implementation.
- **Two `rg` hits survive the repo guard, and neither is a reality drawing.** `GitPullRequestIcon`
  ("Link a pull request", a command-palette action) and `RocketIcon` ("Projects", a nav lens, and
  "Move to project…") are chrome, not facts. No reality surface — `issue-row`, `issue-list`,
  `issue-detail`, `board-card`, `showcase`'s row mockup, `team-home` — imports a lucide glyph any
  more. Renaming nav iconography belongs to the app-frame change, not this one.
- **`priority-mark` gains a `text-text-2` default colour class.** The old drawing hardcoded
  `fill="var(--text-2)"`, which a caller's className could not override; the mock's ticks are
  `currentColor`, so the component now carries its own token and a caller may re-tone it.

### Recorded while building group 6 — the three shared patterns

- **The elevation is one token per preset, `--elevation-transient`, surfaced as Tailwind's
  `--shadow-elevated`.** The mock's `0 10px 26px rgba(43,38,32,.14)` is a *warm-light* shadow; a
  dark preset given that value gets a grey haze rather than a lift. So each of the six theme blocks
  states its own — the lights their own warm/cool ink at 12–14% and the darks black at 52–60% — and
  the utility is generated once from the `--shadow-*` namespace. Verified against the installed
  `tailwindcss@4.3.3` compiler (`shadow-elevated` → `--tw-shadow: var(--elevation-transient)`)
  rather than assumed, since Tailwind 4's theme namespaces postdate the model's training data.
- **`usePeek` throws outside a `PeekProvider`.** A silent local fallback would let a page mount two
  independent peeks and quietly lose the one-open invariant — the exact failure the provider exists
  to make impossible. Failing loudly at the call site is the enforcement.
- **The peek opens immediately on pointer enter; only the *close* is delayed.** The brief asks for
  a hover-intent grace corridor so the pointer can cross the gap from trigger into panel (140ms,
  cancelled by the panel's own pointer enter). An *open* delay is the other half of hover intent and
  a dense list will want it, but no dense consumer exists yet, and guessing its duration now would
  bake a number into the vocabulary that the issues-list change should measure. Left out
  deliberately, not forgotten.
- **`Escape` is only swallowed while a peek or a how is actually open.** Both handlers return early
  otherwise, so `esc` still reaches the palette, the dialog or the row editor that owns it. This is
  what "esc stays" means in a page that has other escapable things in it.
- **The how folds on focus leaving it, as well as on `Escape`.** Tabbing past a derivation should
  not leave a panel hanging over the next row. The handlers sit on the button and on the panel (not
  on a wrapper span) because an interaction handler on a static element is a lint error here, and
  the two elements between them see every focusout that matters.
- **`PeekPanel` positions itself absolutely and the caller supplies the anchor.** No portal, no
  floating-ui: the panel is a sibling of its trigger inside a `relative` box, which keeps it in the
  DOM order a screen reader reads and keeps `Escape`/focus handling local. If a later page needs
  collision-aware placement it can pass its own className; nothing here has to change.
- **`PeekTitle` and `PeekFact` ship with the panel.** The mock's peek is a title, a state row, an
  optional divergence line and exactly one bi-fact (bold phrase + mono derivation line). The two
  that are pure structure are components so three pages cannot each invent their own; the state and
  divergence rows are composed from the vocabulary the pages already import.
- **`ProvenanceMark` is labelled by default and decorative on request (`label={null}`).** The mock
  places the mark after text that usually already names the source, but a default of `aria-hidden`
  would make the honest case the one somebody has to remember. Defaulting to the provider's name and
  opting *out* where the sentence already says "GitHub" is the screen-reader-honest ordering.
- **No `color` prop, no numeric `size` prop, no `upload` member.** `ProvenanceSize` is the literal
  union `12 | 13 | 14`, the mark inherits `currentColor` through a `text-text-3` wrapper the caller
  can re-tone but not re-hue per-mark, and there is no union member an upload could pass. The rules
  from `ia.html` §Provenance are enforced by the type, not by a comment.
- **`Door` is a `<span>` wrapper, not a polymorphic element.** The trigger stays the link or button
  it already was — that is what makes `⏎ goes` native — and the door decorates the *words* inside
  it. `hot` is a state of the one door, not a second kind.
- **No consumer wired in this change.** The three patterns land as vocabulary with stories and
  component tests; the issues list, issue detail and delivery rebuilds are what mount them. Wiring a
  peek into today's list layout would be work the very next change deletes.

### Recorded while building groups 7–8 — tests and documentation

- **The contrast assertion found two real token failures, and both are fixed in the tokens rather
  than in the assertion.** Extending `contrast.test.ts` to the four surfaces the track is actually
  drawn on — a plain row, a hovered row, the **selected** row (`--accent-soft`, `issue-row.tsx`) and
  the digest's divergence class row (`--urgent-soft`, `team-home.tsx`) — measured focused light's
  `--status-in-review` at **2.88** over the selected row (under the 3:1 non-text bar; the track's
  `open` and `rev-wait` nodes carry that hue) and warm dark's `--status-urgent-ink` at **4.35** over
  the same wash (under the 4.5:1 text bar; the `//` break carries it). Focused light's in-review
  green is darkened to `#398e70`, and warm dark stops aliasing its urgent ink to `--status-urgent`
  and states `#e2765c`. Both failures were invisible in five of six presets and on every row state
  but one, which is exactly the class of bug this file exists to catch.
- **The rail's mono fact line is `--text-2`, not the mock's `--text-3`.** `issue.html` inks
  `.stop .git` at `--text-3`, which measures **2.80–3.70** on these surfaces. That line carries a
  commit sha and a check count at 11px — a fact the reader must actually read — so the AA bar wins
  over the mock's exact ink. The mock's `--text-3` remains correct for the `.t-age` suffix and the
  peek's derivation line, which are secondary to a fact stated elsewhere.
- **The empty station is deliberately below the non-text bar, and the test records why.**
  `--border-strong` measures ~1.4 against every surface, and raising it to 3:1 would make "no pull
  request yet" the loudest mark in a dense row. It is scaffolding, not a fact: the facts are the
  filled nodes, and the absence is stated *in words* by the track's `role="img"` label ("No delivery
  signal yet"), which `reality-track.test.tsx` asserts. What the contrast file pins instead is that
  an empty ring can never be mistaken for a fact node (≥ 2.5 against all three status hues) — a bar
  the old focused-light green failed, so the assertion is falsifiable rather than decorative.
- **No new integration test and no new e2e spec (task 7.9).** PROCESS.md §3's big-feature rule needs
  ≥ 2 of {synced entity/schema, mutator, permission surface, signature UI}; this change touches
  exactly one — signature UI. `git diff origin/main` over `packages/schema/src/zero/` shows no table,
  no named query, no mutator and no permission change, and the query registry is byte-unchanged, so
  there is nothing for a pg integration suite to scope. The e2e work is therefore selector renames
  only: `connectors.spec.ts` (four `[data-slot="reality-strip"]` assertions, including the
  three-preset light/dark loop) and `issues.spec.ts` now name `reality-track`, and every assertion
  still asserts the same fact about the same row.
- **The showcase route gains the vocabulary section the stories cover.** The three patterns and the
  vertical rail had stories but no in-app surface, so nothing rendered them against a real theme
  toggle. `/showcase` now draws the rail, one peek, one `how` and a provenance mark beside the
  existing glyph sets — the app-level proof that the tokens hold in all six presets, which a
  Storybook-only artifact cannot give.
- **"Reality strip" and "divergence flag" are renamed across the docs to "reality track" and the
  "`//` break", and the `#the-divergence-flag` anchor becomes `#divergence`.** Every inbound link
  (`auto-status.md` ×2, `github-connector.md`) is updated with it. Historical ROADMAP rows keep the
  words they shipped with — a row describing what change 3 built is a record, not a description of
  today — but every present-tense sentence in README, DESIGN, VISION and ROADMAP is corrected.
