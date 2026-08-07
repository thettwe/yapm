# team-home-digest

## Why

`/teams/{teamId}` — the page every team link lands on — is still the workspace-auth-era
members list: a heading, four nav buttons, join/leave, rename/archive. Meanwhile every fact
the product's wedge promises to compose — issue ↔ PR ↔ CI ↔ review ↔ deployment, cycle
facts, carryover, divergence, delivery cadence — is already synced to the client and already
has a tested pure-function derivation somewhere in `packages/schema`. The one thing missing
is the surface that composes them into the team's morning: what shipped, what needs
attention, what's yours, what's ready to start.

The northstar design exploration settled what that surface looks like:
`design-explorations/overhaul-2026-08/northstar/home-digest-2.html` (the composed morning),
with `home-digest-2-quiet.html` proving the adaptive folding on a quiet day. This change
builds that page as the real team Home.

Why now: the last entity the page needed (the durable deploy fact and the PR→deployment
edge) landed in `deploy-history-edge`, and the metric formulas got their shared home in
`team-delivery-view`. Nothing new has to be synced — the page is pure composition.

Vision principles served: **the work-graph wedge** (VISION — PM + engineering quality in one
graph; this is the first surface where the whole graph is readable in one glance);
**team-level metrics only** (CLAUDE.md #8 — the personal bands show only the signed-in
user's OWN work and say so on-surface: "your work only — never compared"); **sub-100ms**
(#9 — every band reads from Zero local queries; no network wait); **keyboard-first** (#10 —
every doorway row is focusable and Enter-activates).

## What Changes

- **`/teams/{teamId}` becomes the team Home digest**, replacing the thin members-list
  `TeamDetail`. Bands in order, each a distinct drawn form per the mock: HERO spread (cycle
  name, day band, status words, narrative, artifact chips; drawn vitals: scope band, NEXT,
  days left) → NEEDS ATTENTION (the four exception classes with drawn evidence) → SINCE
  YESTERDAY (cards over a literal trailing ~24h window) → YOURS (the signed-in user's
  in-flight issues) → READY FOR YOU (Runway lane only) → SHIP CADENCE (weekly deployment
  dot chart) → SHIPPED THIS CYCLE (Live / Built-not-live) → composed mono footline + onward
  footer.
- **Adaptive rules are the feature**: every band renders only when it has content; empty
  bands fold away with no apology; the attention count is one number everywhere it appears;
  the footline states only rules the code actually executes.
- **No new table, no new named query, no mutator change.** Every band composes from the
  existing synced queries (`issues.byTeam`, `cycles.byTeam`, `triage.inbox`,
  `deployments.byTeam`, `digests.byCycle`, `retros.byTeam`, `notifications.mine`,
  `teams.all`). All new derivations are pure functions in `packages/schema`
  (the `delivery.ts` / `cycle-facts.ts` pattern), imported by the client.
- **Three daylight token extensions** (`--row-hairline`, `--statusline-bg`,
  `--urgent-soft`) added to the theme blocks in `packages/ui/src/styles/globals.css`;
  drawn elements (day band, scope band, tick-bar, triage dots, cadence chart, broken
  reality track) become small inline-SVG React components with no motion.
- **Team members management stays reachable**: the existing management UI moves behind a
  Members doorway at `/teams/{teamId}/members`, byte-preserving its controls.
- **Deferred, folding away per the adaptive rules** (no invented data, ever): the decision
  entity (DECIDED band), Crit/Verify handoff lanes, and "you left Tue 6:40p" last-seen
  anchoring.

## Non-goals

- No decision entity, no Crit/Verify lane entities, no last-seen tracking — follow-up
  changes; their bands/affordances fold away.
- No rebuild of the AppShell/global nav; the digest replaces only the page content of
  `teams.$teamId.index`.
- No AI call anywhere on this page: the hero narrative reuses a stored cycle-digest
  narrative when one exists and otherwise falls back to a *computed*, deterministic
  two-sentence summary — never filler, never a model call.
- No per-person metric of any kind; personal bands render exclusively the signed-in user's
  own work.

## Capabilities

### New Capabilities

- `team-home`: the adaptive team Home digest — band anatomy, derivation predicates, the
  one-attention-number rule, adaptive folding, personal-lens boundaries, keyboard
  operability.

### Modified Capabilities

_None._ The `teams` capability's entity/membership/sync requirements are untouched, and no
existing spec pins the members-management UI to the team index route; relocating it is an
implementation move, not a requirement change.

## Impact

- **Code**: `apps/web/src/routes/teams.$teamId.index.tsx` (content swap), new
  `apps/web/src/routes/teams.$teamId.members.tsx`, new `apps/web/src/home/` components,
  new derivation module `packages/schema/src/zero/team-home.ts` (+ exports),
  `packages/ui/src/styles/globals.css` token extensions. No server code, no migrations,
  no env vars.
- **Sync reads**: unchanged query surface; the compose smoke test must stay green.
- **Existing e2e**: `issues.spec.ts` reaches the issue list through a link named "Issues"
  on the team page — the digest's onward footer keeps that accessible name.
- Docs: new `apps/docs/src/content/docs/features/team-home.md`; README feature list
  (team Home digest) and ROADMAP change row; no configuration-reference impact (no env
  vars).
