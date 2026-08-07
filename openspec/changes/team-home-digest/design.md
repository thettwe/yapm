# team-home-digest — design

## Context

The approved mock is `design-explorations/overhaul-2026-08/northstar/home-digest-2.html`
(rendered: `home-digest-2-full.png`), with `home-digest-2-quiet.html` as the proof that the
page folds honestly on a quiet day. This design maps every band of that mock onto entities
that exist today, names the exact predicate behind every drawn fact, and records what folds
away because its entity does not exist yet.

Three constraints shape everything:

1. **Zero has no aggregates** (`reference/zero.md`). Every count, window, and bucket is a
   pure client-side function over rows already synced — the `delivery-view` precedent.
2. **All ZQL and derivations live in `packages/schema`** (CLAUDE.md #2). The client imports
   the model; the page file contains rendering, not computation.
3. **Never invented.** Every phrase, count, and drawn mark on the page must be the output of
   a predicate over real rows. A fact that cannot be derived is not rendered — the band or
   line folds instead.

## Goals / Non-Goals

**Goals**

- The team Home is the digest, matching the mock's band anatomy, spacing, and tone.
- One derivation module produces the whole page model; the attention number is computed
  once and rendered everywhere from that one value.
- The adaptive rules are real code paths with the quiet state as a first-class rendering,
  not an error state.
- Sub-100ms: no new query, no network wait; derivations memoized over synced rows.
- Correct in all three themes, light and dark, AA contrast.

**Non-Goals**

- Decision entity, Crit/Verify lanes, last-seen anchoring (deferred; they fold away).
- AppShell/global-nav rebuild; the mock's gbar/statusline chrome is NOT part of this change
  — the digest is the page content inside the existing shell.
- Any AI call, any new table, any new named query, any mutator change.

## Decisions

### D1 — One page model, computed in `packages/schema`, zero new sync surface

A single entry point `buildTeamHome(input): TeamHomeModel` in
`packages/schema/src/zero/team-home.ts` (flat file beside `delivery.ts` — the
`metrics/scope.ts` precedent showed a `delivery/` directory would be ambiguous; same
reasoning here for `home/`). Input is structural rows from the existing named queries:

| Query | Feeds |
|---|---|
| `cycles.byTeam` | active cycle (via `currentCycle` ordering), day band, days left |
| `issues.byTeam` (with `withLinkedDelivery` subtree) | attention classes, YOURS, Runway, scope band, SHIPPED |
| `triage.inbox` | the "new in triage" exception class |
| `deployments.byTeam` | OVERNIGHT card, SHIP CADENCE, Live badges (via `buildDeploymentIndex`) |
| `digests.byCycle` | hero narrative when present, Cycle-report chip |
| `retros.byTeam` | NEXT ritual row, Wrapped chip, cadence retro ticks |
| `notifications.mine` | SINCE YESTERDAY notification facts (already self-scoped) |
| `teams.all` | team name/key |

The model reuses existing pure functions rather than restating them:
`computeDeliverySignal` / `computeDivergence` / `assembleLinkedEntities` /
`buildDeploymentIndex` (`delivery.ts`), `currentCycle` / `compareCycles` / `isUnfinished`
(`cycles.ts`, `apps/web/src/cycles/model.ts` — the ordering helpers that are already in
schema), and the added-mid-cycle semantics of `metrics/scope.ts`
(`cycleAssignedAt > cycle start`). `buildTeamHome` takes `now` and `viewerId` as explicit
arguments so it is deterministic and testable.

**No per-person dimension exists in the model's types.** Personal fields are only ever
"the viewer's own" (`yours`, `sinceYesterday.yourReview`); there is nowhere to put a
teammate's name next to a number, which makes CLAUDE.md #8 structural — the
`blameless` walker from `packages/schema/testing` asserts it over the assembled model.

### D2 — The one attention number: four disjoint classes, one distinct-issue count

The mock's arithmetic is not reproducible (rows 1+2+1+4 under a header of 4), so the rule
is defined here and applied everywhere: **each issue belongs to at most one exception
class**, assigned by precedence, and the attention count is the sum of the four class
counts — which is then, by construction, a distinct-issue count:

1. **Done in git, not on the board** — `computeDivergence(...) === 'status_behind_merge'`
   (the existing work-graph divergence flag). Evidence: broken reality track with the `//`
   mark, issue key.
2. **Checks failing** — `signal.ciHealth === 'failing'` (any non-canceled status; this also
   absorbs `done_but_ci_failing`). Evidence: tick-bar with red ticks, "red \<age\>" from the
   newest failing check's `updatedAt`.
3. **Waiting on review over a day** — `signal.pr === 'open'` (not draft, not approved,
   not merged) and `signal.reviewAgeMs > 24h`. Evidence: the ages, mono (`31h · 26h`).
4. **New in triage** — every row of `triage.inbox` (untriaged work is by definition
   unattended; disjoint from the others because `issues.byTeam` excludes `needsTriage`).
   Evidence: hollow dots, capped visually (e.g. at 8) with the true number in the text.

The header count, the hero's "N need attention" status word, and any other occurrence all
render `model.attention.count` — one value, one code path. Count 0 ⇒ the band and the hero
word both fold (proven by the quiet mock).

### D3 — Hero: document left, drawn vitals right

- **Title**: the active cycle's human key (`Cycle N` via the existing `cycleKey` logic —
  moved into schema alongside the model if needed) or its name when named.
  **No active cycle** ⇒ the hero degrades to the team name with a quiet line and a Cycles
  doorway; cycle-dependent bands (scope, day band, SHIPPED) fold.
- **Day band**: one segment per UTC day of the cycle; past days filled, today tall, future
  hollow. "Day N of M · ends \<weekday\>" from `startDate`/`endDate` with the same UTC
  handling as `formatCycleRange`.
- **Status words**: shipped = done issues in the active cycle; in review = `in_review`
  issues; need attention = `attention.count` (folds at 0).
- **Narrative**: if `digests.byCycle(activeCycle)` has ready content, its headline/prose is
  the narrative (evidence chips intact). Otherwise a **computed fallback**: at most two
  deterministic sentences assembled from real counts (shipped/live so far, days left, the
  single most severe attention fact). On a quiet day it degrades to shorter, quieter
  sentences — never filler, never invented, never a model call. The fallback templates are
  pure functions with unit-tested wording.
- **Artifact chips**: "Cycle report" only when a digest row with content exists for the
  active cycle; "Wrapped" only when a closed retro is linked to it. No chip renders
  without its artifact.
- **Vitals**: scope numbers and band from the active cycle's issues — committed = in the
  cycle and not added mid-cycle (carry-ins included, `metrics/scope.ts` semantics), landed
  = done, added = `cycleAssignedAt > startDate`. NEXT lists only derivable rituals: an
  open (unclosed) retro for the team (there is **no scheduled-time field** on `retro`, so
  the row shows the retro's title/state, never an invented "Friday 4:00"); "N days left"
  from `endDate`.

### D4 — SINCE YESTERDAY: a literal trailing 24h window, cards that fold independently

Window = `[now − 24h, now]` (the last-seen anchor is deferred; the header omits the mock's
"you left Tue 6:40p" line entirely rather than faking one).

- **OVERNIGHT** — deployments with `deployedAt` in the window. Lines are the titles of done
  issues whose linked merged PR's `mergeCommitSha` matches the deployment `sha` (the exact
  same-repo join `delivery.ts` already implements); a deployment matching no issue renders
  its repo/environment fact instead. Provenance: "N releases went live · \<repo or deploy
  refs\>".
- **YOUR REVIEW** — review rows with `submittedAt` in the window on PRs linked to issues
  **assigned to the viewer** (the schema has no PR-author identity mapping, so "your PRs"
  is honestly approximated by "PRs on your issues" — recorded on-surface by the provenance
  line naming the issue key). Outcome word from `review.state`.
- **INBOX** — the viewer's unread notifications for this team in the window, summarized
  with kind + subject; the card is a doorway to `/inbox`.

Each card renders only with content; the band folds when all three are empty. Every card
is a doorway (Inbox or the subject).

### D5 — YOURS: the viewer's in-flight issues in this team, and only derivable reciprocals

Rows: `assigneeId === viewer`, `needsTriage === false`, status unfinished (`isUnfinished`),
this team, ordered by `updatedAt` desc ("last movement"). Anatomy per the mock: status arc
(existing status glyph), reality track (existing strip vocabulary), two-line bifact — the
"say" line is a phrase from a fixed dictionary keyed on (status, signal) predicates; the
mono "git" line renders only facts the signal carries (check state + age, PR open-since,
approved-since).

- **Collapsed "waiting on others"**: the viewer's rows whose signal shows an open PR
  awaiting review (`signal.pr === 'open'`) collapse out of the main list into the one-line
  row with their waiting ages.
- **"No reviews owed" reciprocal**: yapm has **no reviewer↔user identity mapping** (a
  `review.author` is a provider login, and it is radioactive under CLAUDE.md #8), so "you
  owe no reviews" is not derivable per-person. The line renders only under the weaker,
  honest, team-level predicate: **no open PR linked to this team's issues is awaiting
  review at all** — then nobody is waiting on anyone, including the viewer. Otherwise the
  line folds (it never renders an unverifiable claim).
- **Footnote** (mono): `yours = assignee you · status < done · ordered by last movement ·
  your work only — never compared` — every clause true of the code above it.
- **Empty**: the single warmth line with a Runway doorway (quiet mock), no empty table.

### D6 — READY FOR YOU: Runway only; phrases are predicate outputs

Runway = the active cycle's issues with `assigneeId === null`, `needsTriage === false`,
status `todo` or `backlog`, ordered urgent-first then priority. Each row: priority tick
glyph (existing priority mark), issue key, title, and a why-it's-clear phrase drawn from a
fixed dictionary where **every phrase is the output of a real predicate**: urgent priority
⇒ "Urgent — nothing blocks a start"; `rolledOverFromCycleId` set ⇒ "Carried in — pick it
back up"; `cycleAssignedAt > startDate` ⇒ "Added mid-cycle"; else ⇒ "Committed at
planning". No phrase exists in the dictionary without a predicate.

Crit and Verify lanes fold away entirely (their entities do not exist), so the band is a
single unlabeled list with the Runway header and count; it folds when no active cycle
exists or the list is empty.

### D7 — SHIP CADENCE: weekly deployment dots, derived once, drawn small

`cadenceWeeks(deployments, now, weekCount = 12)`: UTC week buckets of deployments with a
non-null `deployedAt`, newest week last, one dot per deployment (failed-state deployments
never carry `deployedAt`, so every dot is a real release). Today caret at the right edge;
month labels derived from the bucket starts; a dashed "retro" tick at each closed retro
whose `closedAt` falls inside the window (labeled just `retro` — the mock's "smaller PRs"
annotation text is retro content this change does not mine). Band folds when no deployment
carries a production timestamp (`deployedAt`) — pending/failed rows alone must not keep an
all-zero chart alive. Onward: "Delivery ›" to the existing Delivery view.

### D8 — SHIPPED THIS CYCLE: Live is the deploy fact, not a guess

Done issues in the active cycle, two-column grid. Badge: **Live** when the issue's signal
`deployedAt !== null` (the exact merge-commit join via `buildDeploymentIndex`), else
**Built — not live**. Folds when the cycle has no done issues.

### D9 — The footline states only executed rules; the footer keeps the e2e contract

The composed mono footline is assembled from the rules the renderer actually applied this
render: always "empty bands fold away" plus, when applicable, "attention first" (band
present) and "your lens — your work only" (YOURS present). The mock's "crit unfolds as
2:00 nears" clause does not appear because no such code runs. Onward footer: `Issues ·
Delivery · Retro · Roadmap` links (accessible name **"Issues"** preserved —
`issues.spec.ts` clicks it) + the ⌘K hint.

### D10 — Members management moves to `/teams/{teamId}/members`

The smallest honest home: a new route rendering the existing `TeamDetail` management
surface (roster, join/leave, admin add/remove, rename, archive) essentially unchanged; the
team Home carries a quiet "Members ›" doorway. `auth.spec.ts`'s `members-list` assertions
target the workspace home panel and are unaffected.

### D11 — Daylight tokens exist in every theme, derived from theme tokens

`--row-hairline`, `--statusline-bg`, `--urgent-soft` join the semantic token set in
`globals.css`. Warm-light gets the mock's literal values (`#efe9dd`, `#f4efe5`,
`rgba(204,90,64,.08)`); every other theme block (focused/editorial, and all three darks)
derives them from its own existing tokens (hairline just inside `--border`, statusline just
off `--bg`, urgent-soft = the theme's urgent/destructive hue at low alpha, e.g. via
`color-mix`) so the tokens can never be missing in a theme and AA contrast is judged per
theme. Every color and font on the page goes through tokens — no literal hex in
components.

### D12 — Drawn components are app-local; existing glyphs are reused, not redrawn

Search-first reuse: the status glyph, priority mark, and reality-strip components the issue
list already renders are used as-is for YOURS/Runway rows. The new drawn forms — day band,
scope band, tick-bar, triage dots, cadence chart, the broken track with `//` — are small
inline-SVG React components (no motion) in `apps/web/src/home/`, because none has a
UI-dependency-free consumer outside the app today; promotion to `packages/ui` waits for a
real second consumer.

### D13 — Keyboard and speed

Every doorway row is a real `Link` (or button) — focusable in DOM order, Enter-activates,
visible focus ring from existing tokens. All data comes from `useQuery` local reads;
`buildTeamHome` runs in one `useMemo` keyed on the row arrays, `viewerId`, and a
minute-granular `now` so ages tick without re-render storms.

## Risks / Trade-offs

- **The fallback narrative can read robotic.** Mitigated by keeping it to two short
  templated sentences over real counts, with the quiet-day degradation explicitly
  designed; whether it reads *well* is a human judgement the review must make against the
  mock's tone.
- **"New in triage" keeps the attention band alive for teams that ignore triage.** That is
  the honest reading — untriaged work is unattended — and matches the canonical set's
  stated exception classes.
- **The 24h window is literal**, so a Monday morning shows less than a last-seen anchor
  would. Accepted; the anchor is a named deferral.

## Decisions made during implementation

Pre-seeded scoping decisions (made at proposal time; refine only with evidence):

- **Build only on entities that exist** — issue, cycle, pull_request, ci_check, review,
  deployment, notification, cycle_digest, cycle facts, delivery metrics, work-graph
  divergence. No new tables, no new named queries in this change.
- **Decision entity, Crit/Verify lanes, and last-seen anchoring are deferred** to follow-up
  changes; their bands/affordances fold away per the adaptive rules (DECIDED band absent,
  READY FOR YOU is Runway-only, SINCE YESTERDAY uses a literal trailing ~24h window with no
  "you left …" line).
- **The AppShell/global nav is not rebuilt**; the digest replaces only the page content of
  `teams.$teamId.index`. The members management UI moves behind `/teams/{teamId}/members`
  (D10) — the smallest honest home that keeps every control reachable.
- **All derivations live in `packages/schema`**; no metric with a per-person dimension;
  personal bands show only the signed-in user's own work.
- **Visual language**: Warm token block + the four daylight extensions (D11); drawn
  elements as small inline-SVG React components, app-local (D12), reusing existing
  status/priority/track components first.
- **The attention number is a distinct-issue count over four disjoint classes** (D2),
  because the mock's arithmetic is not reproducible and one number must be one number.
- **The "No reviews owed" reciprocal renders only under the team-level zero-open-reviews
  predicate** (D5), because no reviewer↔user identity mapping exists and the line must
  never claim what it cannot verify.
- **NEXT shows no times** (D3): `retro` has no scheduled-time field, so the ritual row
  carries state, not an invented clock time.

Decisions made while building pass 1 (model + primitives):

- **"Active cycle" means `status === 'active'` only** (earliest by `compareCycles`), NOT the
  `currentCycle` fallback to an upcoming cycle. A cycle that has not started has no day band, no
  "Day N of M" and no scope-against-plan, so featuring it would force every hero fact to be
  invented; the degraded no-active-cycle form (D3) is the honest rendering until it starts.
- **`computeDeliverySignal` gained an optional third `now` parameter** (default `Date.now()`, so
  every existing caller is byte-identical in behavior). `reviewAgeMs` was the one wall-clock read
  inside the reused seam, and `buildTeamHome` must be deterministic under an explicit `now`;
  recomputing the age outside the seam would have duplicated its review-vs-opened rule.
- **Scope band arithmetic**: each in-cycle issue draws exactly one block — done → `landed`,
  else added-mid-cycle (`cycleAssignedAt > startDate`, the `metrics/scope.ts` predicate) →
  `added`, else `open`. The displayed numbers are committed = in-cycle minus added (carry-ins
  included), landed = all done, added = all added-mid-cycle. The mock's 12/8/3 over a 15-block
  band is exactly this shape.
- **The mono age vocabulary is `formatHomeAge`** in the model ("41m", "31h" up to 48h, then
  "3d") — the mock renders waiting ages in hours past one day, which the issue list's
  `formatReviewAge` ("1d") cannot say; the two coexist because they annotate different drawings.
- **Reuse pass findings (task 2.2)**: `StatusGlyph` (status arcs), `PriorityMark` (priority
  ticks) and `RealityStrip` (icon-based PR/CI/deploy/age summary) are reused as-is where the mock
  shows them. What the mock's track vocabulary ADDS — node-and-segment tracks, the `//` break,
  the `empty-urgent` node, day band, scope band, tick-bar, triage dots, cadence chart — is not a
  variant of any of those components, so they are new app-local drawings in `apps/web/src/home/`
  (D12) rather than forks: `drawn.tsx` (DayBand, ScopeBand, TickBar, TriageDots, RealityTrack
  with the break) and `cadence-chart.tsx`. DayBand/ScopeBand render as flex spans exactly like
  the mock's own drawing (the segments must stretch to the column); the tick-bar, dots, track and
  chart are static inline SVG/spans. No motion anywhere.
- **Derived daylight tokens**: warm-light carries the mock's literal values; every other theme
  block computes the same three tokens from its own palette — hairline =
  `color-mix(in oklch, var(--border), var(--bg) 50%)`, statusline =
  `color-mix(in oklch, var(--bg), var(--bg-sidebar) 60%)`, urgent-soft =
  `color-mix(in srgb, var(--status-urgent) 8%, transparent)` — so the tokens can never be missing
  in a theme (D11).
- **The overnight card's provenance names environments** (falling back to the repo when a
  deployment carries none): the mock's "deploy #142 #143" numbers do not exist on the deployment
  row (`externalId` is an opaque provider id), so the provenance states the fact yapm has —
  "N releases went live · production".

Decisions made while building pass 2 (page + routes):

- **`AppShell` gained an additive `wide` prop** (default false, only the team Home passes it):
  the digest's editorial column is 960px in the mock and the shell's default measure is
  `max-w-3xl`. Widening one page via an opt-in prop is the smallest change that honors both "the
  AppShell is not rebuilt" and "match the mock's spacing"; every other page renders byte-identical.
- **The onward footer carries `Issues` AND `Board`** (mock: Issues · Delivery · Retro · Roadmap).
  The e2e suites' one navigation contract with the team page is exactly those two links
  (`issues.spec.ts` et al. click "Issues"; `board.spec.ts` clicks "Board" straight from the team
  page), and the digest may not regress them. "Delivery in full", "Retro" and "Roadmap" complete
  the mock's row; the ⌘K hint closes it.
- **Attention class rows render one row per class**, exactly as the mock draws them, with the
  bold class count and the first issue's drawn evidence. The row's doorway is the issue itself
  when the class holds exactly one issue (mock: `ENG-116 ›`) and the board when it holds several —
  every flagged issue stays reachable, and no row pretends N issues are one.
- **The mock's "you left Tue 6:40p" line, DECIDED card, Crit/Verify lanes and statusline/gbar
  chrome do not render** — deferred entities and out-of-scope chrome fold away per the proposal;
  the composed footline names only the rules that ran (§D9).
- **The YOURS warmth line's Runway doorway is an in-page anchor** to the READY FOR YOU band and
  renders only while that band does; when the runway itself is folded there is nothing to open,
  so the doorway folds with it rather than pointing somewhere that cannot show a runway.
- **NEXT rows and artifact chips are doorways** (retro detail, Cycles, Retros): the mock draws
  them inert, but keyboard-first makes every stated fact reachable without a pointer.
- **`digests.byCycle` is the eighth read and waits for the cycles read** via Zero's documented
  `useQuery(cond ? request : undefined)` form — no active cycle, no digest query at all.
- **Verification split per the build instructions**: lint, typecheck, the schema + web unit
  suites (including the new `team-home.test.tsx` falsifiable renders) ran locally and are green;
  `turbo build`, Playwright e2e and the compose smoke test run in CI on the already-open PR.

Decisions made in the tests-and-docs pass:

- **No new integration or e2e test** (task 5.3/5.4): the change adds no query, no mutator and no
  permission surface (the query registry is byte-unchanged vs `main`), so the pg integration
  suites have nothing new to scope and PROCESS.md §3's big-feature rule does not trigger. The
  audit for tests whose subject moved found none — no unit/component test referenced
  `team-detail.tsx` or `members-panel.tsx`, `auth.spec.ts`'s `members-list` testid lives on the
  workspace home (`members-panel.tsx`, untouched), and the e2e team-page contract
  ("Issues"/"Board" links) is carried by the digest's onward footer, so every existing suite
  runs unmodified.
- **Docs sidebar placement**: `Team Home` sits first in the Features group — it is the surface a
  team lands on, and every other feature page is one of its doorways.
- **A sweep for docs describing the team page as a members list found none to fix**: the only
  members-list references in `apps/docs` are the workspace-home Members list (`sso.md`), which
  did not move. README gained the Home-digest entry at the end of "What works today"; ROADMAP
  gained row 29 with status "built, in review" — the row is honest about not being merged, and
  archiving flips it.

Decisions made during the review fix pass:

- **YOURS applies checks-before-waiting, mirroring §D2's class precedence**: a viewer row whose
  open PR has failing checks keeps its own "Checks failing — the fix is yours" row instead of
  collapsing into "waiting on others". The waiting collapse exists because the next move is a
  reviewer's; red checks mean the next move is the viewer's, and the same rows must not be read
  with the opposite precedence the attention band applies to them.
- **Urgent text carries `--status-urgent-ink`**, a fourth daylight token: `--status-urgent`
  clears the 3:1 non-text bar for the digest's dots/ticks/borders but not AA 4.5:1 for
  body-size text in the light presets. Text-sized urgent occurrences (hero status word,
  divergence class row, urgent say/phrase lines, the `//` break) use the ink, tuned per light
  preset over both `--bg` and the `--urgent-soft` composite and aliased to `--status-urgent`
  in the darks, all asserted in `styles/contrast.test.ts`. Editorial light's urgent orange was
  additionally darkened (`#d9741c` → `#cc6b13`): it measured 2.91:1 against its own wash,
  under even the non-text bar.
- **The warmth line's "nothing owed" clause is gated on `yours.noReviewsOwed`** — the model
  computes that predicate precisely so the claim is never rendered unverified, and the empty
  branch now consumes it: "Nothing held, nothing owed — …" only when true, "Nothing held — …"
  otherwise.
- **OVERNIGHT matches deployments by repo+sha key, not row identity**, so two window
  deployments of the same matched commit both count as matched and neither renders the bare
  repo/environment fallback line.
