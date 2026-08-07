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
annotation text is retro content this change does not mine). Band folds when the team has
no deployment rows at all. Onward: "Delivery ›" to the existing Delivery view.

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
- **Visual language**: Warm token block + the three daylight extensions (D11); drawn
  elements as small inline-SVG React components, app-local (D12), reusing existing
  status/priority/track components first.
- **The attention number is a distinct-issue count over four disjoint classes** (D2),
  because the mock's arithmetic is not reproducible and one number must be one number.
- **The "No reviews owed" reciprocal renders only under the team-level zero-open-reviews
  predicate** (D5), because no reviewer↔user identity mapping exists and the line must
  never claim what it cannot verify.
- **NEXT shows no times** (D3): `retro` has no scheduled-time field, so the ritual row
  carries state, not an invented clock time.
